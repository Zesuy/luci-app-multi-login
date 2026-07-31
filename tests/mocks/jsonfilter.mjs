#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import process from 'node:process';

if (process.argv.length < 5) {
  process.stderr.write('usage: jsonfilter.mjs LENGTH_FILE HASH_FILE [JSONFILTER_ARGS...]\n');
  process.exit(2);
}

const lengthFile = process.argv[2];
const hashFile = process.argv[3];
const args = process.argv.slice(4);
const chunks = [];
let length = 0;
const hash = crypto.createHash('sha256');

for await (const chunk of process.stdin) {
  chunks.push(chunk);
  length += chunk.length;
  hash.update(chunk);
}

fs.writeFileSync(lengthFile, `${length}\n`, { mode: 0o600 });
fs.writeFileSync(hashFile, `${hash.digest('hex')}\n`, { mode: 0o600 });

let source = Buffer.concat(chunks).toString('utf8');
let expression = '';
for (let index = 0; index < args.length; index += 1) {
  switch (args[index]) {
    case '-s':
      source = args[++index] ?? '';
      break;
    case '-e':
      expression = args[++index] ?? '';
      break;
    case '-q':
      break;
    default:
      process.exit(2);
  }
}

if (!expression)
  process.exit(2);

let value;
try {
  value = JSON.parse(source);
} catch {
  process.exit(1);
}

function tokensFor(rawExpression) {
  let raw = rawExpression.trim();
  if (!raw.startsWith('@'))
    throw new Error('unsupported expression');
  raw = raw.slice(1);
  const tokens = [];
  while (raw.length > 0) {
    let match;
    if ((match = raw.match(/^\.([A-Za-z0-9_-]+)/))) {
      tokens.push(match[1]);
    } else if ((match = raw.match(/^\[['"]([^'"]+)['"]\]/))) {
      tokens.push(match[1]);
    } else if ((match = raw.match(/^\[(\d+)\]/))) {
      tokens.push(Number(match[1]));
    } else if ((match = raw.match(/^\[\*\]/))) {
      tokens.push('*');
    } else {
      throw new Error('unsupported expression');
    }
    raw = raw.slice(match[0].length);
  }
  return tokens;
}

function select(current, tokens) {
  if (tokens.length === 0)
    return [current];
  const [token, ...rest] = tokens;
  if (token === '*') {
    if (!Array.isArray(current))
      return [];
    return current.flatMap((item) => select(item, rest));
  }
  if (current === null || typeof current !== 'object' || !Object.hasOwn(current, token))
    return [];
  return select(current[token], rest);
}

let selected;
try {
  selected = select(value, tokensFor(expression));
} catch {
  process.exit(1);
}

if (selected.length === 0)
  process.exit(1);

for (const item of selected) {
  if (item !== null && typeof item === 'object')
    process.stdout.write(`${JSON.stringify(item)}\n`);
  else if (item === true)
    process.stdout.write('1\n');
  else if (item === false)
    process.stdout.write('0\n');
  else if (item !== null)
    process.stdout.write(`${item}\n`);
}

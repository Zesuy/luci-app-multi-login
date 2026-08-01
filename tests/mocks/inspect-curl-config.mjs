#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

if (process.argv.length !== 4) {
  process.stderr.write('usage: inspect-curl-config.mjs CONFIG REPORT\n');
  process.exit(2);
}

const configPath = process.argv[2];
const reportPath = process.argv[3];
const expectedSecretHash = process.env.MULTILOGIN_MOCK_SECRET_SHA256 ?? '';

function digest(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function decodeQuoted(value) {
  let output = '';
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] !== '\\') {
      output += value[index];
      continue;
    }
    index += 1;
    if (index >= value.length)
      throw new Error('trailing backslash');
    const escaped = value[index];
    const escapes = { n: '\n', r: '\r', t: '\t', v: '\v' };
    output += Object.hasOwn(escapes, escaped) ? escapes[escaped] : escaped;
  }
  return output;
}

const configStat = fs.statSync(configPath);
const directoryStat = fs.statSync(path.dirname(configPath));
const options = [];
for (const [index, line] of fs.readFileSync(configPath, 'utf8').split(/\r?\n/).entries()) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#'))
    continue;
  const quoted = trimmed.match(/^([A-Za-z0-9_-]+)\s*=\s*"((?:\\.|[^"\\])*)"\s*$/);
  const bare = trimmed.match(/^([A-Za-z0-9_-]+)(?:\s*=\s*([^\s]+))?\s*$/);
  if (quoted)
    options.push({ name: quoted[1], value: decodeQuoted(quoted[2]), line: index + 1 });
  else if (bare)
    options.push({ name: bare[1], value: bare[2] ?? true, line: index + 1 });
  else
    throw new Error(`unsupported curl config line ${index + 1}`);
}

const params = {};
let url = '';
let userAgent = '';
let accountOperator = null;
for (const option of options) {
  if (option.name === 'url')
    url = option.value;
  if (option.name === 'user-agent')
    userAgent = option.value;
  if (option.name !== 'data-urlencode')
    continue;
  const separator = option.value.indexOf('=');
  const name = separator < 0 ? option.value : option.value.slice(0, separator);
  const value = separator < 0 ? '' : option.value.slice(separator + 1);
  if (!Object.hasOwn(params, name))
    params[name] = [];
  if (name === 'user_password' || name === 'user_account') {
    if (name === 'user_account') {
      const operatorMatch = value.match(/^,([01]),/);
      accountOperator = operatorMatch?.[1] ?? null;
    }
    params[name].push({
      redacted: true,
      length: value.length,
      sha256: digest(value),
      matches_secret: name === 'user_password' && expectedSecretHash !== '' && digest(value) === expectedSecretHash,
    });
  } else {
    params[name].push(value);
  }
}

const report = {
  config_mode: (configStat.mode & 0o777).toString(8).padStart(4, '0'),
  directory_mode: (directoryStat.mode & 0o777).toString(8).padStart(4, '0'),
  config_name: path.basename(configPath),
  option_names: options.map((option) => option.name),
  url,
  user_agent: userAgent,
  term_ua: params.term_ua?.[0] ?? null,
  account_operator: accountOperator,
  params,
};

fs.writeFileSync(reportPath, `${JSON.stringify(report)}\n`, { mode: 0o600 });

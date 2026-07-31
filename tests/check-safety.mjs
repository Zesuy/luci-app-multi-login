#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));

function usage() {
  process.stderr.write('usage: check-safety.mjs [--root DIR] [--allowlist FILE] [--sentinel VALUE] [--print-findings]\n');
  process.exit(2);
}

const options = {
  root: path.resolve(currentDirectory, '..'),
  allowlist: path.resolve(currentDirectory, 'allowlists/legacy-unsafe-patterns.txt'),
  sentinel: '',
  printFindings: false,
};

for (let index = 2; index < process.argv.length; index += 1) {
  switch (process.argv[index]) {
    case '--root':
      options.root = path.resolve(process.argv[++index] ?? usage());
      break;
    case '--allowlist':
      options.allowlist = path.resolve(process.argv[++index] ?? usage());
      break;
    case '--sentinel':
      options.sentinel = process.argv[++index] ?? usage();
      break;
    case '--print-findings':
      options.printFindings = true;
      break;
    default:
      usage();
  }
}

const ignoredDirectories = new Set(['.git', '.codegraph', 'node_modules']);
const executableExtensions = new Set(['.sh', '.bash', '.js']);
const findings = [];

function hashLine(line) {
  return crypto.createHash('sha256').update(line.trim()).digest('hex');
}

function addFinding(category, relativePath, lineNumber, line) {
  findings.push({
    category,
    relativePath,
    lineNumber,
    key: `${category}\t${relativePath}\t${hashLine(line)}`,
  });
}

function walk(directory, output = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name))
      continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory())
      walk(fullPath, output);
    else if (entry.isFile())
      output.push(fullPath);
  }
  return output;
}

for (const file of walk(options.root).sort()) {
  let source;
  try {
    source = fs.readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  if (source.includes('\0')) {
    if (options.sentinel && source.includes(options.sentinel)) {
      const relativePath = path.relative(options.root, file) || path.basename(file);
      addFinding('secret_sentinel', relativePath, 1, source);
    }
    continue;
  }

  const relativePath = path.relative(options.root, file) || path.basename(file);
  const isExecutableSource = executableExtensions.has(path.extname(file)) || /^#!.*\b(?:ba)?sh\b/.test(source.split(/\r?\n/, 1)[0]);
  const lines = source.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (options.sentinel && line.includes(options.sentinel))
      addFinding('secret_sentinel', relativePath, index + 1, line);

    if (isExecutableSource) {
      if (/\beval\b/.test(line) && !relativePath.startsWith('tests/'))
        addFinding('shell_eval', relativePath, index + 1, line);
      if (/\/tmp\/[^\s'";]*(?:\$\{|\$[A-Za-z_])/.test(line))
        addFinding('predictable_temp', relativePath, index + 1, line);
      if (/--password[^\n]*\$\{?[A-Za-z0-9_]*password\}?/i.test(line))
        addFinding('secret_subprocess_argv', relativePath, index + 1, line);
    }
  }
}

if (options.printFindings) {
  for (const finding of findings)
    process.stdout.write(`${finding.key}\n`);
  process.exit(0);
}

const allowed = new Set();
if (fs.existsSync(options.allowlist)) {
  for (const rawLine of fs.readFileSync(options.allowlist, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line && !line.startsWith('#'))
      allowed.add(line);
  }
}

const unexpected = findings.filter((finding) => !allowed.has(finding.key));
for (const finding of unexpected)
  process.stderr.write(`safety check: new ${finding.category} finding at ${finding.relativePath}:${finding.lineNumber}\n`);

if (unexpected.length > 0)
  process.exitCode = 1;

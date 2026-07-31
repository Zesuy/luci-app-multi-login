#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import process from 'node:process';

if (process.argv.length !== 4) {
  process.stderr.write('usage: capture-stdin.mjs LENGTH_FILE HASH_FILE\n');
  process.exit(2);
}

const hash = crypto.createHash('sha256');
let length = 0;

for await (const chunk of process.stdin) {
  length += chunk.length;
  hash.update(chunk);
}

fs.writeFileSync(process.argv[2], `${length}\n`, { mode: 0o600 });
fs.writeFileSync(process.argv[3], `${hash.digest('hex')}\n`, { mode: 0o600 });

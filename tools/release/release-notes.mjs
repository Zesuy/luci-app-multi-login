#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const versionIndex = process.argv.indexOf('--version');
const outputIndex = process.argv.indexOf('--output');
if (versionIndex === -1 || outputIndex === -1 || !process.argv[versionIndex + 1] || !process.argv[outputIndex + 1]) {
	process.stderr.write('usage: tools/release/release-notes.mjs --version VERSION --output FILE\n');
	process.exit(1);
}

const requestedVersion = process.argv[versionIndex + 1];
const version = requestedVersion.startsWith('v') ? requestedVersion.slice(1) : requestedVersion;
const output = process.argv[outputIndex + 1];
const repository = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const changelog = fs.readFileSync(path.join(repository, 'CHANGELOG.md'), 'utf8');
const lines = changelog.split(/\r?\n/);
const heading = `## [${version}] - `;
const start = lines.findIndex((line) => line.startsWith(heading));
const end = start === -1
	? -1
	: lines.findIndex((line, index) => index > start && line.startsWith('## '));
const body = start === -1 ? '' : lines.slice(start + 1, end === -1 ? undefined : end).join('\n');
if (!body.trim()) {
	process.stderr.write(`release notes: CHANGELOG.md has no body for ${version}\n`);
	process.exit(1);
}
fs.writeFileSync(output, body.trimEnd() + '\n', { encoding: 'utf8', mode: 0o600 });

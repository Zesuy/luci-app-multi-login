#!/usr/bin/env node

/**
 * Classify changed repository paths without consulting git or the network.
 * Unknown paths deliberately require the full package gate.
 */
import fs from 'node:fs';

function fail(message) {
	process.stderr.write(`change scope: ${message}\n`);
	process.exit(2);
}

const paths = [];
let format = 'json';
let requiredScope = null;

function addPath(value, source) {
	if (value === '') fail(`${source} must not be empty`);
	if (value.startsWith('/') || value.includes('\\') || value.split('/').some((part) => part === '' || part === '.' || part === '..')) {
		fail(`${source} is not a normalized repository-relative path: ${JSON.stringify(value)}`);
	}
	paths.push(value);
}

for (let index = 2; index < process.argv.length; index += 1) {
	const argument = process.argv[index];
	if (argument === '--path') {
		if (index + 1 === process.argv.length) fail('--path requires a value');
		addPath(process.argv[++index], '--path');
	} else if (argument === '--paths-file') {
		if (index + 1 === process.argv.length) fail('--paths-file requires a value');
		const file = process.argv[++index];
		let lines;
		try {
			lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
		} catch (error) {
			fail(`cannot read paths file ${JSON.stringify(file)}: ${error.code ?? 'error'}`);
		}
		if (lines.at(-1) === '') lines.pop();
		for (const line of lines) addPath(line, `paths file ${JSON.stringify(file)}`);
	} else if (argument === '--format') {
		if (index + 1 === process.argv.length) fail('--format requires json or text');
		format = process.argv[++index];
		if (format !== 'json' && format !== 'text') fail('--format must be json or text');
	} else if (argument === '--require') {
		if (index + 1 === process.argv.length) fail('--require requires a scope');
		requiredScope = process.argv[++index];
		if (!['none', 'docs-only', 'shell-only', 'package'].includes(requiredScope)) {
			fail('--require must be none, docs-only, shell-only, or package');
		}
	} else {
		fail(`unknown argument ${JSON.stringify(argument)}`);
	}
}

const uniquePaths = [...new Set(paths)].sort();
const documentationPaths = new Set(['README.md', 'PROJECT_OVERVIEW.md', 'CHANGELOG.md']);
const portalPath = 'etc/multilogin/cqu-portal.sh';
const isDocumentation = (file) => documentationPaths.has(file) || file.startsWith('docs/');

let scope;
let reason;
if (uniquePaths.length === 0) {
	scope = 'none';
	reason = 'no_changed_paths';
} else if (uniquePaths.every(isDocumentation)) {
	scope = 'docs-only';
	reason = 'documentation_only';
} else if (uniquePaths.includes(portalPath) && uniquePaths.every((file) => file === portalPath || file === 'CHANGELOG.md')) {
	scope = 'shell-only';
	reason = 'portal_script_and_changelog_only';
} else {
	scope = 'package';
	reason = 'package_or_unknown_path';
}

const result = { scope, paths: uniquePaths, reason };
if (format === 'json') {
	process.stdout.write(JSON.stringify(result) + '\n');
} else {
	process.stdout.write(`${scope}\t${reason}\t${uniquePaths.join(',')}\n`);
}

if (requiredScope !== null && scope !== requiredScope) {
	process.stderr.write(`change scope: expected ${requiredScope}, got ${scope}\n`);
	process.exit(1);
}

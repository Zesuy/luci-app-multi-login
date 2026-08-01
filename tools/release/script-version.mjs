#!/usr/bin/env node

/** Pure shell-only release gate. The workflow supplies the prior script as an
 * ordinary file; this tool reads no git state and performs no network access. */
import fs from 'node:fs';
import path from 'node:path';

function fail(message) {
	process.stderr.write(`script version: ${message}\n`);
	process.exit(1);
}

function option(name) {
	const index = process.argv.indexOf(name);
	return index === -1 || !process.argv[index + 1] ? null : process.argv[index + 1];
}

function metadata(source, file) {
	const versionMatches = [...source.matchAll(/^MULTILOGIN_SCRIPT_VERSION=(['"])([^'"\r\n]+)\1$/gm)];
	const apiMatches = [...source.matchAll(/^MULTILOGIN_SCRIPT_API=([0-9]+)$/gm)];
	if (versionMatches.length !== 1) fail(`${file} must contain exactly one literal script version`);
	if (apiMatches.length !== 1) fail(`${file} must contain exactly one integer script API`);
	return { version: versionMatches[0][2], api: Number(apiMatches[0][1]) };
}

function parseSemver(value, label) {
	const match = value.match(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/);
	if (!match) fail(`${label} is not SemVer: ${JSON.stringify(value)}`);
	const prerelease = match[4] === undefined ? [] : match[4].split('.');
	for (const identifier of prerelease) {
		if (/^\d+$/.test(identifier) && identifier.length > 1 && identifier.startsWith('0')) {
			fail(`${label} has a leading-zero prerelease identifier: ${JSON.stringify(value)}`);
		}
	}
	return { core: match.slice(1, 4).map(Number), prerelease };
}

function compareSemver(leftValue, rightValue) {
	const left = parseSemver(leftValue, 'current version');
	const right = parseSemver(rightValue, 'base version');
	for (let index = 0; index < 3; index += 1) {
		if (left.core[index] !== right.core[index]) return Math.sign(left.core[index] - right.core[index]);
	}
	if (left.prerelease.length === 0 || right.prerelease.length === 0) {
		return left.prerelease.length === right.prerelease.length ? 0 : left.prerelease.length === 0 ? 1 : -1;
	}
	const length = Math.max(left.prerelease.length, right.prerelease.length);
	for (let index = 0; index < length; index += 1) {
		const a = left.prerelease[index];
		const b = right.prerelease[index];
		if (a === undefined || b === undefined) return a === b ? 0 : a === undefined ? -1 : 1;
		if (a === b) continue;
		const aNumeric = /^\d+$/.test(a);
		const bNumeric = /^\d+$/.test(b);
		if (aNumeric && bNumeric) return Math.sign(Number(a) - Number(b));
		if (aNumeric !== bNumeric) return aNumeric ? -1 : 1;
		return a < b ? -1 : 1;
	}
	return 0;
}

const baseScript = option('--base-script');
if (!baseScript) fail('usage: tools/release/script-version.mjs --base-script FILE');
const repository = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
let baseSource;
try {
	baseSource = fs.readFileSync(baseScript, 'utf8');
} catch (error) {
	fail(`cannot read base script: ${error.code ?? 'error'}`);
}
const current = metadata(fs.readFileSync(path.join(repository, 'etc/multilogin/cqu-portal.sh'), 'utf8'), 'current script');
const base = metadata(baseSource, 'base script');
if (current.api !== 3 || base.api !== current.api) {
	fail(`shell-only changes must preserve script API 3 (base ${base.api}, current ${current.api})`);
}
if (compareSemver(current.version, base.version) <= 0) {
	fail(`shell-only version must increase (base ${base.version}, current ${current.version})`);
}
process.stdout.write(JSON.stringify({
	base_version: base.version,
	version: current.version,
	script_api: current.api,
	relation: 'newer',
}) + '\n');

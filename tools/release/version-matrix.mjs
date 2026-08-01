#!/usr/bin/env node

/** Static release consistency gate: source reads only, with no network or mutations. */
import fs from 'node:fs';
import path from 'node:path';

function fail(message) {
	process.stderr.write(`release metadata: ${message}\n`);
	process.exit(1);
}

function option(name) {
	const index = process.argv.indexOf(name);
	return index === -1 || !process.argv[index + 1] ? null : process.argv[index + 1];
}

const repository = path.resolve(option('--repository') ?? path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..'));

function sourceFile(relative) {
	return fs.readFileSync(path.join(repository, relative), 'utf8');
}

function assignment(source, name, file) {
	const match = source.match(new RegExp(`^${name}:=([^\\r\\n]+)$`, 'm'));
	if (!match) fail(`${file} is missing ${name}:=`);
	return match[1].trim();
}

function literal(source, name, file) {
	const match = source.match(new RegExp(`^${name}=(['"])([^'"\\r\\n]+)\\1$`, 'm'));
	if (!match) fail(`${file} is missing literal ${name} metadata`);
	return match[2];
}

function integerLiteral(source, name, file) {
	const match = source.match(new RegExp(`^${name}=([0-9]+)$`, 'm'));
	if (!match) fail(`${file} is missing integer ${name} metadata`);
	return match[1];
}

function changelogEntry(source, version) {
	const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const match = source.match(new RegExp(`^## \\[${escaped}\\] - (\\d{4}-\\d{2}-\\d{2})$`, 'm'));
	if (!match) fail(`CHANGELOG.md is missing dated [${version}] entry`);
	return match[1];
}

const tag = option('--tag');
if (!tag) fail('usage: tools/release/version-matrix.mjs --tag vMAJOR.MINOR.PATCH[-PRERELEASE]');

const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
if (!tag.startsWith('v') || !semver.test(tag.slice(1))) {
	fail(`tag must be a v-prefixed SemVer value, got ${JSON.stringify(tag)}`);
}

const version = tag.slice(1);
const makefile = sourceFile('Makefile');
const portal = sourceFile('etc/multilogin/cqu-portal.sh');
// Source SemVer and APK's deterministic projection are distinct by design.
// Keep compatibility with the short-lived pre-APK metadata fixture.
const sourceVersion = /^PKG_SOURCE_VERSION:=/m.test(makefile)
	? assignment(makefile, 'PKG_SOURCE_VERSION', 'Makefile')
	: assignment(makefile, 'PKG_VERSION', 'Makefile');
const apkVersion = /^PKG_APK_VERSION:=/m.test(makefile)
	? assignment(makefile, 'PKG_APK_VERSION', 'Makefile')
	: sourceVersion.replace(/-([0-9A-Za-z]+(?:\.[0-9A-Za-z-]+)*)$/, (_, prerelease) => `_${prerelease.replace(/[.-]/g, '')}`);
const packageRelease = assignment(makefile, 'PKG_RELEASE', 'Makefile');
const scriptApi = integerLiteral(portal, 'MULTILOGIN_SCRIPT_API', 'etc/multilogin/cqu-portal.sh');
const scriptVersion = literal(portal, 'MULTILOGIN_SCRIPT_VERSION', 'etc/multilogin/cqu-portal.sh');

if (sourceVersion !== version) fail(`tag ${tag} disagrees with PKG_SOURCE_VERSION ${sourceVersion}`);
const expectedApkVersion = version.replace(/-([0-9A-Za-z]+(?:\.[0-9A-Za-z-]+)*)$/, (_, prerelease) => `_${prerelease.replace(/[.-]/g, '')}`);
if (apkVersion !== expectedApkVersion) fail(`PKG_APK_VERSION ${apkVersion} is not the deterministic APK projection ${expectedApkVersion}`);
if (!/^[1-9]\d*$/.test(packageRelease)) fail(`PKG_RELEASE must be a positive integer, got ${packageRelease}`);
if (scriptApi !== '3') fail(`script API must remain 3, got ${scriptApi}`);
if (scriptVersion !== version) fail(`tag ${tag} disagrees with script version ${scriptVersion}`);

const date = changelogEntry(sourceFile('CHANGELOG.md'), version);
const packageControlVersions = {
	plain: `${sourceVersion}-${packageRelease}`,
	r_prefixed: `${sourceVersion}-r${packageRelease}`,
};
const artifacts = Object.fromEntries(Object.entries(packageControlVersions)
	.map(([style, controlVersion]) => [style, `luci-app-multilogin_${controlVersion}_all.ipk`]));
artifacts.apk = `luci-app-multilogin-${apkVersion}-r${packageRelease}.apk`;
process.stdout.write(JSON.stringify({
	tag,
	version,
	package_version: sourceVersion,
	package_source_version: sourceVersion,
	package_apk_version: apkVersion,
	package_release: Number(packageRelease),
	package_control_versions: packageControlVersions,
	script_api: Number(scriptApi),
	changelog_date: date,
	artifacts,
}) + '\n');

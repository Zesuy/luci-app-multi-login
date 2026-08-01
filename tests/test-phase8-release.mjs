#!/usr/bin/env node
/* Phase 8 compile/release static and pure artifact checks. No package install,
 * OpenWrt root, service, network, device, or publication behavior is emulated. */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(testDir, '..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'multilogin-phase8.'));
const read = (relative) => fs.readFileSync(path.join(repository, relative), 'utf8');
const workflows = [
  '.github/workflows/ci.yml',
  '.github/workflows/release-check.yml',
  '.github/workflows/sdk-build.yml',
  '.github/workflows/release.yml',
];
const sources = Object.fromEntries(workflows.map((file) => [file, read(file)]));
let checks = 0;
process.on('exit', () => fs.rmSync(temporary, { recursive: true, force: true }));
const pass = (label) => { checks += 1; process.stdout.write(`PASS  phase8-release: ${label}\n`); };

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repository,
    env: { ...process.env, ...options.env },
    input: options.input,
    encoding: 'utf8',
    timeout: options.timeout ?? 5000,
  });
  if (result.error) throw result.error;
  return result;
}

function write(relative, content = '', mode = 0o644) {
  const target = path.join(temporary, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, { mode });
  fs.chmodSync(target, mode);
  return target;
}

function workflowPolicyTests() {
  for (const [file, source] of Object.entries(sources)) {
    for (const match of source.matchAll(/^\s*uses:\s*([^\s#]+)(?:\s+#.*)?$/gm)) {
      const reference = match[1];
      if (reference.startsWith('./')) continue;
      const pin = reference.split('@')[1] ?? '';
      assert.match(pin, /^[0-9a-f]{40}$/, `${file} action is not pinned by full commit: ${reference}`);
    }
    assert.match(source, /^permissions:\n\s+contents:\s+read\s*$/m, `${file} lacks read-only workflow permissions`);
    assert.doesNotMatch(source, /permissions:[\s\S]{0,100}packages:\s+write/, `${file} grants package write`);
  }

  const ci = sources['.github/workflows/ci.yml'];
  assert.match(ci, /timeout-minutes:\s*5/);
  assert.match(ci, /timeout 60s \.\/tests\/run\.sh/);
  assert.match(ci, /persist-credentials:\s*false/);
  assert.match(ci, /git diff --name-only[\s\S]{0,180}change-scope\.mjs --paths-file/);
  assert.doesNotMatch(ci, /uses:\s*\.\/\.github\/workflows\/sdk-build\.yml/, 'ordinary CI still compiles SDK packages');
  assert.doesNotMatch(ci, /sdk_url:|sdk_sha256:|package_format:/, 'ordinary CI still contains a release build matrix');
  assert.match(ci, /shell-only:[\s\S]{0,180}if: needs\.scope\.outputs\.scope == 'shell-only'/);
  assert.match(ci, /script-version\.mjs --base-script/);

  const releaseCheck = sources['.github/workflows/release-check.yml'];
  assert.match(releaseCheck, /^\s*workflow_dispatch:\s*$/m);
  assert.match(releaseCheck, /tag:[\s\S]{0,160}base_ref:/);
  assert.match(releaseCheck, /version-matrix\.mjs --tag/);
  assert.match(releaseCheck, /change-scope\.mjs[\s\S]{0,160}--require\s+package/);
  assert.match(releaseCheck, /timeout 60s \.\/tests\/run\.sh/);
  assert.match(releaseCheck, /uses:\s*\.\/\.github\/workflows\/sdk-build\.yml/);
  assert.doesNotMatch(releaseCheck, /^\s+(?:push|pull_request|release):\s*$/m);
  const sdk = sources['.github/workflows/sdk-build.yml'];
  assert.match(sdk, /timeout-minutes:\s*30/);
  for (const bound of ['timeout 180s ./scripts/feeds update', 'timeout 120s ./scripts/feeds install', 'timeout 900s make package/luci-app-multilogin/compile'])
    assert.ok(sdk.includes(bound), `SDK workflow misses bound: ${bound}`);
  assert.match(sdk, /umask 022[\s\S]{0,180}timeout 120s make defconfig[\s\S]{0,100}timeout 900s make package\/luci-app-multilogin\/compile/);
  assert.match(sdk, /--connect-timeout 15 --max-time 300/);

  const release = sources['.github/workflows/release.yml'];
  assert.match(release, /^\s*workflow_dispatch:\s*$/m);
  assert.match(release, /base_ref:/, 'manual release lacks an explicit comparison base');
  assert.match(release, /git diff[\s\S]{0,180}--name-only/, 'release does not derive changed paths from the selected base');
  assert.match(release, /change-scope\.mjs[\s\S]{0,160}--require\s+package/, 'SDK release does not require package change scope');
  assert.doesNotMatch(release, /^\s+(?:push|pull_request|release):\s*$/m, 'release workflow has an automatic publication trigger');
  assert.equal((release.match(/timeout-minutes:\s*10/g) ?? []).length, 2, 'release jobs are not both bounded');
  assert.match(release, /environment:\s*release/);
  assert.match(release, /create-draft:[\s\S]*permissions:\n\s+contents:\s+write/);
  assert.doesNotMatch(release.slice(0, release.indexOf('create-draft:')), /contents:\s+write/, 'verification job can write repository contents');
  assert.match(release, /--draft/);
  for (const provenance of [
    '.github/workflows/release-check.yml', '.event)" = workflow_dispatch', '.head_repository.full_name', '.head_branch',
  ]) assert.ok(release.includes(provenance), `release provenance check is missing ${provenance}`);
  pass('ordinary CI and protected release validation have pinned, bounded, least-privilege policy');
}

function sdkMatrixTests() {
  const releaseCheck = sources['.github/workflows/release-check.yml'];
  const versions = [...releaseCheck.matchAll(/sdk_version:\s*([0-9.]+)/g)].map((match) => match[1]);
  assert.equal(versions.length, 3, 'release validation must have exactly three SDK witnesses');
  assert.equal(versions.some((value) => value.startsWith('23.05.')), true);
  assert.equal(versions.some((value) => value.startsWith('24.10.')), true);
  assert.equal(versions.some((value) => value.startsWith('25.12.')), true);
  const urls = [...releaseCheck.matchAll(/sdk_url:\s*(https:\/\/\S+)/g)].map((match) => match[1]);
  assert.equal(urls.length, 3);
  assert.equal(urls.every((url) => /^https:\/\/downloads\.openwrt\.org\/releases\//.test(url)), true);
  const hashes = [...releaseCheck.matchAll(/sdk_sha256:\s*([0-9a-f]+)/g)].map((match) => match[1]);
  assert.equal(hashes.length, 3); assert.equal(hashes.every((hash) => hash.length === 64), true);
  assert.equal(new Set(hashes).size, 3);
  assert.match(releaseCheck, /artifact_name:\s*luci-app-multilogin-openwrt-23\.05\./);
  assert.match(releaseCheck, /artifact_name:\s*luci-app-multilogin-openwrt-24\.10\./);
  assert.match(releaseCheck, /artifact_name:\s*luci-app-multilogin-openwrt-25\.12\./);
  assert.deepEqual([...releaseCheck.matchAll(/package_format:\s*(ipk|apk)$/gm)].map((match) => match[1]), ['ipk', 'ipk', 'apk']);
  assert.deepEqual([...releaseCheck.matchAll(/release_style:\s*(plain|r)$/gm)].map((match) => match[1]), ['plain', 'r', 'r']);

  const sdk = sources['.github/workflows/sdk-build.yml'];
  assert.match(sdk, /sha256sum --check --status/);
  assert.match(sdk, /sha256sum "\$\(basename "\$1"\)" >sha256sums\.txt/);
  assert.match(sdk, /inspect-artifact\.sh[\s\S]{0,240}--release-style "\$RELEASE_STYLE"/);
  assert.match(sdk, /package_format:/);
  assert.match(sdk, /openwrt-25\.12/);
  assert.match(sdk, /staging_dir\/host\/bin\/apk/);
  assert.match(sdk, /artifact\/apk-tool/);
  assert.match(sdk, /if-no-files-found:\s*error/);
  const release = sources['.github/workflows/release.yml'];
  assert.match(release, /test "\$\(wc -l < ipks\.txt\)" -eq 2/);
  assert.match(release, /test "\$\(wc -l < apks\.txt\)" -eq 1/);
  assert.match(release, /inspect-artifact\.sh --ipk/);
  assert.match(release, /inspect-artifact\.sh --apk/);
  assert.match(release, /openwrt-23\.05\.[\s\S]{0,100}release_style=plain/);
  assert.match(release, /openwrt-24\.10\.[\s\S]{0,100}release_style=r/);
  assert.match(release, /openwrt-25\.12\.[\s\S]{0,100}release_style=r/);
  assert.match(release, /sort -u ipk-names\.txt \| wc -l/);
  assert.match(release, /luci-app-multilogin-\*\.apk/);
  pass('23.05/24.10 IPK and 25.12 APK witnesses use pinned official SDKs and deterministic artifacts');
}

function metadataTests() {
  const releaseRepository = path.join(temporary, 'release-repository');
  write('release-repository/Makefile', 'PKG_SOURCE_VERSION:=3.0.0-rc.1\nPKG_APK_VERSION:=3.0.0_rc1\nPKG_RELEASE:=1\n');
  write('release-repository/etc/multilogin/cqu-portal.sh', "MULTILOGIN_SCRIPT_VERSION='3.0.0-rc.1'\nMULTILOGIN_SCRIPT_API=3\n");
  write('release-repository/CHANGELOG.md', '## [3.0.0-rc.1] - 2026-08-01\n\n### Added\n\n- Candidate.\n');
  const matrixArgs = ['tools/release/version-matrix.mjs', '--repository', releaseRepository];
  const success = run('node', [...matrixArgs, '--tag', 'v3.0.0-rc.1']);
  assert.equal(success.status, 0, success.stderr);
  const metadata = JSON.parse(success.stdout);
  assert.deepEqual(Object.keys(metadata).sort(), ['artifacts', 'changelog_date', 'package_apk_version', 'package_control_versions', 'package_release', 'package_source_version', 'package_version', 'script_api', 'tag', 'version']);
  assert.deepEqual(metadata.package_control_versions, { plain: '3.0.0-rc.1-1', r_prefixed: '3.0.0-rc.1-r1' });
  assert.deepEqual(metadata.artifacts, {
    plain: 'luci-app-multilogin_3.0.0-rc.1-1_all.ipk',
    r_prefixed: 'luci-app-multilogin_3.0.0-rc.1-r1_all.ipk',
    apk: 'luci-app-multilogin-3.0.0_rc1-r1.apk',
  });
  assert.equal(metadata.package_source_version, '3.0.0-rc.1');
  assert.equal(metadata.package_apk_version, '3.0.0_rc1');
  assert.equal(metadata.script_api, 3);
  for (const bad of ['3.0.0-rc.1', 'v3.0.0', 'v03.0.0', 'v3.0']) {
    const rejected = run('node', [...matrixArgs, '--tag', bad]);
    assert.notEqual(rejected.status, 0, `metadata mismatch accepted ${bad}`);
  }
  const badApkProjection = path.join(temporary, 'bad-apk-projection');
  fs.cpSync(releaseRepository, badApkProjection, { recursive: true });
  fs.writeFileSync(path.join(badApkProjection, 'Makefile'), 'PKG_SOURCE_VERSION:=3.0.0-rc.1\nPKG_APK_VERSION:=3.0.0-rc.1\nPKG_RELEASE:=1\n');
  assert.notEqual(run('node', ['tools/release/version-matrix.mjs', '--repository', badApkProjection, '--tag', 'v3.0.0-rc.1']).status, 0);
  const notes = path.join(temporary, 'release-notes.md');
  const generated = run('node', ['tools/release/release-notes.mjs', '--version', '3.0.0-rc.1', '--output', notes]);
  assert.equal(generated.status, 0, generated.stderr);
  assert.match(fs.readFileSync(notes, 'utf8'), /### Added[\s\S]+### Security/);
  assert.equal(fs.statSync(notes).mode & 0o777, 0o600);
  const taggedNotes = path.join(temporary, 'release-notes-tagged.md');
  const generatedFromTag = run('node', ['tools/release/release-notes.mjs', '--version', 'v3.0.0-rc.1', '--output', taggedNotes]);
  assert.equal(generatedFromTag.status, 0, generatedFromTag.stderr);
  assert.equal(fs.readFileSync(taggedNotes, 'utf8'), fs.readFileSync(notes, 'utf8'));
  pass('tag, source/APK versions, script metadata, changelog, artifact names and notes agree');
}

function scriptVersionTests() {
  const current = read('etc/multilogin/cqu-portal.sh');
  const older = write('script-version/older.sh', current.replace(
    /^MULTILOGIN_SCRIPT_VERSION=(['"])[^'"\r\n]+\1$/m,
    "MULTILOGIN_SCRIPT_VERSION='0.0.0'",
  ));
  const accepted = run('node', ['tools/release/script-version.mjs', '--base-script', older]);
  assert.equal(accepted.status, 0, accepted.stderr);
  assert.deepEqual(Object.keys(JSON.parse(accepted.stdout)).sort(), ['base_version', 'relation', 'script_api', 'version']);
  const equal = write('script-version/equal.sh', current);
  assert.notEqual(run('node', ['tools/release/script-version.mjs', '--base-script', equal]).status, 0);
  const newer = write('script-version/newer.sh', current.replace(
    /^MULTILOGIN_SCRIPT_VERSION=(['"])[^'"\r\n]+\1$/m,
    "MULTILOGIN_SCRIPT_VERSION='999.0.0'",
  ));
  assert.notEqual(run('node', ['tools/release/script-version.mjs', '--base-script', newer]).status, 0);
  const apiMismatch = write('script-version/api-mismatch.sh', current.replace(/^MULTILOGIN_SCRIPT_API=3$/m, 'MULTILOGIN_SCRIPT_API=2'));
  assert.notEqual(run('node', ['tools/release/script-version.mjs', '--base-script', apiMismatch]).status, 0);
  pass('shell-only changes require a newer SemVer and preserve script API 3');
}

function changeScopeTests() {
  const tool = path.join(repository, 'tools/release/change-scope.mjs');
  assert.ok(fs.existsSync(tool), 'pure shell/package change-scope classifier is missing');
  const classify = (paths) => {
    const args = ['tools/release/change-scope.mjs'];
    for (const item of paths) args.push('--path', item);
    const result = run('node', args);
    assert.equal(result.status, 0, result.stderr);
    const parsed = JSON.parse(result.stdout);
    assert.deepEqual(Object.keys(parsed).sort(), ['paths', 'reason', 'scope']);
    assert.deepEqual(parsed.paths, [...new Set(paths)].sort());
    assert.equal(typeof parsed.reason, 'string'); assert.ok(parsed.reason.length > 0);
    return parsed.scope;
  };
  assert.equal(classify([]), 'none');
  assert.equal(classify(['etc/multilogin/cqu-portal.sh']), 'shell-only');
  assert.equal(classify(['README.md', 'docs/v3/contracts.md', 'CHANGELOG.md']), 'docs-only');
  for (const paths of [
    ['Makefile'], ['root/usr/libexec/rpcd/multilogin'], ['htdocs/luci-static/resources/view/multilogin/scripts.js'],
    ['etc/multilogin/cqu-portal.sh', 'README.md'], ['unrecognized/new-surface.txt'],
  ]) assert.equal(classify(paths), 'package', `unsafe scope for ${paths.join(',')}`);
  for (const invalid of ['/etc/passwd', '../outside', 'docs/../../outside'])
    assert.notEqual(run('node', ['tools/release/change-scope.mjs', '--path', invalid]).status, 0, `invalid path accepted: ${invalid}`);
  const pathsFile = write('changed-paths.txt', 'etc/multilogin/cqu-portal.sh\n');
  const fromFile = run('node', ['tools/release/change-scope.mjs', '--paths-file', pathsFile]);
  assert.equal(fromFile.status, 0, fromFile.stderr); assert.equal(JSON.parse(fromFile.stdout).scope, 'shell-only');
  pass('shell-only/docs/package/unknown change matrix is deterministic and fail-safe');
}

function createArtifactFixture(label = 'valid', options = {}) {
  const fixtureRoot = path.join(temporary, label);
  const fixture = path.join(fixtureRoot, 'members');
  const control = path.join(fixture, 'control');
  const data = path.join(fixture, 'data');
  fs.mkdirSync(control, { recursive: true }); fs.mkdirSync(data, { recursive: true });
  const controlVersion = options.releaseStyle === 'r' ? '3.0.0-rc.1-r1' : '3.0.0-rc.1-1';
  fs.writeFileSync(path.join(control, 'control'), [
    'Package: luci-app-multilogin', `Version: ${controlVersion}`, 'Architecture: all',
    `Depends: ${options.depends ?? 'libc, bash, curl, mwan3, jsonfilter, luci-base'}`, '',
  ].join('\n'));
  const migration = read('package/multilogin-migrate.sh');
  for (const [archiveHook, sourceHook] of [
    ['preinst', 'preinst'], ['postinst-pkg', 'postinst'], ['prerm-pkg', 'prerm'], ['postrm', 'postrm'],
  ]) {
    let body = `#!/bin/sh\nML_MIGRATION_EMBEDDED=1\n${migration}${read(`package/hooks/${sourceHook}.sh`)}`;
    if (options.markerOnlyHook === archiveHook) body = '#!/bin/sh\nML_MIGRATION_EMBEDDED=1\n';
    fs.writeFileSync(path.join(control, archiveHook), body);
    fs.chmodSync(path.join(control, archiveHook), 0o755);
  }
  const payloads = [
    ['0600', 'etc/config/multilogin'], ['0755', 'etc/init.d/multilogin'],
    ...['login_control.bash', 'login.sh', 'check_status.sh', 'logout.sh', 'quick_setup.sh'].map((name) => ['0755', `etc/multilogin/${name}`]),
    ['0755', 'usr/lib/multilogin/cqu-portal.factory.sh'], ['0644', 'usr/lib/multilogin/script-policy.sh'],
    ['0644', 'usr/lib/multilogin/config-policy.sh'], ['0755', 'usr/libexec/rpcd/multilogin'],
    ['0755', 'usr/libexec/multilogin-script'], ['0755', 'usr/libexec/multilogin-config'],
    ['0644', 'usr/share/luci/menu.d/luci-app-multi-login.json'], ['0644', 'usr/share/rpcd/acl.d/luci-app-multi-login.json'],
    ...['overview', 'configuration', 'network', 'script', 'diagnostics'].map((view) => ['0644', `www/luci-static/resources/view/multilogin/${view}.js`]),
  ];
  for (const [mode, relative] of payloads) {
    if (relative === options.omit) continue;
    const target = path.join(data, relative); fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, `${relative}\n`);
    fs.chmodSync(target, Number.parseInt(relative === options.badMode ? '0600' : mode, 8));
  }
  if (options.extraPayload) {
    const extra = path.join(data, 'usr/bin/unexpected-root-helper');
    fs.mkdirSync(path.dirname(extra), { recursive: true });
    fs.writeFileSync(extra, '#!/bin/sh\n');
    fs.chmodSync(extra, 0o755);
  }
  assert.equal(run('tar', ['-czf', path.join(fixture, 'control.tar.gz'), '-C', control, '.']).status, 0);
  assert.equal(run('tar', ['-czf', path.join(fixture, 'data.tar.gz'), '-C', data, '.']).status, 0);
  fs.writeFileSync(path.join(fixture, 'debian-binary'), '2.0\n');
  const ipk = path.join(fixtureRoot, `luci-app-multilogin_${controlVersion}_all.ipk`);
  const archived = options.outerFormat === 'ar'
    ? run('ar', ['r', ipk, 'debian-binary', 'control.tar.gz', 'data.tar.gz'], { cwd: fixture })
    : run('tar', ['-czf', ipk, 'debian-binary', 'control.tar.gz', 'data.tar.gz'], { cwd: fixture });
  assert.equal(archived.status, 0, archived.stderr);
  const digest = crypto.createHash('sha256').update(fs.readFileSync(ipk)).digest('hex');
  const sums = path.join(fixtureRoot, 'sha256sums.txt');
  fs.writeFileSync(sums, `${digest}  ${path.basename(ipk)}\n`);
  return { ipk, sums };
}

const packagePayloads = [
  ['0600', 'etc/config/multilogin'], ['0755', 'etc/init.d/multilogin'],
  ...['login_control.bash', 'login.sh', 'check_status.sh', 'logout.sh', 'quick_setup.sh'].map((name) => ['0755', `etc/multilogin/${name}`]),
  ['0755', 'usr/lib/multilogin/cqu-portal.factory.sh'], ['0644', 'usr/lib/multilogin/script-policy.sh'],
  ['0644', 'usr/lib/multilogin/config-policy.sh'], ['0755', 'usr/libexec/rpcd/multilogin'],
  ['0755', 'usr/libexec/multilogin-script'], ['0755', 'usr/libexec/multilogin-config'],
  ['0644', 'usr/share/luci/menu.d/luci-app-multi-login.json'], ['0644', 'usr/share/rpcd/acl.d/luci-app-multi-login.json'],
  ...['overview', 'configuration', 'network', 'script', 'diagnostics'].map((view) => ['0644', `www/luci-static/resources/view/multilogin/${view}.js`]),
];

function createApkArtifactFixture(label = 'valid-apk', options = {}) {
  const fixtureRoot = path.join(temporary, label);
  const payloadRoot = path.join(fixtureRoot, 'payload');
  for (const [mode, relative] of [
    ...packagePayloads,
    ['0644', 'lib/apk/packages/luci-app-multilogin.conffiles'],
    ['0644', 'lib/apk/packages/luci-app-multilogin.conffiles_static'],
    ['0644', 'lib/apk/packages/luci-app-multilogin.list'],
  ]) {
    if (relative === options.omit) continue;
    const target = path.join(payloadRoot, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, `${relative}\n`);
    fs.chmodSync(target, Number.parseInt(relative === options.badMode ? '0600' : mode, 8));
  }
  if (options.extraPayload) write(`${label}/payload/usr/bin/unexpected-root-helper`, '#!/bin/sh\n', 0o755);

  const depends = options.depends ?? ['bash', 'curl', 'jsonfilter', 'libc', 'luci-base', 'mwan3'];
  const migration = read('package/multilogin-migrate.sh');
  const apkHookMap = new Map([
    ['pre-install', 'preinst'], ['post-install', 'postinst'], ['pre-deinstall', 'prerm'], ['post-deinstall', 'postrm'],
  ]);
  const apkHookLines = [...apkHookMap].flatMap(([archiveHook, sourceHook]) => {
    let core = `ML_MIGRATION_EMBEDDED=1\n${migration}${read(`package/hooks/${sourceHook}.sh`)}`;
    if (options.missingMarker && archiveHook === 'pre-install') core = core.replace('ML_MIGRATION_EMBEDDED=1', 'echo migration-missing');
    if (options.literalHook && archiveHook === 'pre-install') core += '$(file <package/hooks/preinst.sh)\n';
    let lines = core.trimEnd().split('\n').filter((line) => line.length > 0);
    if (archiveHook === 'post-install' || archiveHook === 'pre-deinstall') lines = lines.filter((line) => line !== '#!/bin/sh');
    const wrapper = {
      'pre-install': ['#!/bin/sh'],
      'post-install': ['#!/bin/sh', '[ "${IPKG_NO_SCRIPT}" = "1" ] && exit 0', '[ -s ${IPKG_INSTROOT}/lib/functions.sh ] || exit 0', '. ${IPKG_INSTROOT}/lib/functions.sh', 'export root="${IPKG_INSTROOT}"', 'export pkgname="luci-app-multilogin"', 'add_group_and_user', 'default_postinst'],
      'pre-deinstall': ['#!/bin/sh', '[ -s ${IPKG_INSTROOT}/lib/functions.sh ] || exit 0', '. ${IPKG_INSTROOT}/lib/functions.sh', 'export root="${IPKG_INSTROOT}"', 'export pkgname="luci-app-multilogin"', 'default_prerm'],
      'post-deinstall': ['#!/bin/sh'],
    }[archiveHook];
    if (options.extraHookPrefix && archiveHook === 'pre-install') wrapper.push('echo unexpected-prefix');
    return [`  ${archiveHook}: |`, ...[...wrapper, ...lines].map((line) => `    ${line}`)];
  });
  const adb = [
    'info:',
    `  name: ${options.packageName ?? 'luci-app-multilogin'}`,
    `  version: ${options.version ?? '3.0.0_rc1-r1'}`,
    `  arch: ${options.arch ?? 'noarch'}`,
    `  depends: # ${depends.length} items`,
    ...depends.map((dependency) => `    - ${dependency}`),
    'paths:',
    'scripts:',
    ...apkHookLines,
    ...(options.duplicateHook ? ['  pre-install: |', '    #!/bin/sh', '    ML_MIGRATION_EMBEDDED=1'] : []),
    '',
  ].join('\n');
  const adbFile = write(`${label}/apk.adb`, adb);
  const fakeTool = write(`${label}/apk-tool`, `#!/bin/sh
set -eu
case \$1 in
adbdump) cat '${adbFile}' ;;
extract)
  shift
  destination=
  while [ \"\$#\" -gt 0 ]; do
    case \$1 in
      --destination) destination=\$2; shift 2 ;;
      --allow-untrusted|--no-chown) shift ;;
      *) shift ;;
    esac
  done
  [ -n \"\$destination\" ]
  cp -Rp '${payloadRoot}/.' \"\$destination/\"
  ;;
*) exit 2 ;;
esac
`, 0o755);
  const apk = write(`${label}/luci-app-multilogin-3.0.0_rc1-r1.apk`, `ADB fixture: ${label}\n`);
  const digest = crypto.createHash('sha256').update(fs.readFileSync(apk)).digest('hex');
  const sums = write(`${label}/sha256sums.txt`, `${digest}  ${path.basename(apk)}\n`);
  return { apk, sums, fakeTool };
}

function artifactInspectionTests() {
  const inspector = read('tools/release/inspect-artifact.sh');
  assert.doesNotMatch(inspector, /\bopkg\b(?! invocation)/, 'artifact inspector invokes opkg');
  assert.doesNotMatch(inspector, /chroot|procd|uci\s|service\s|\/etc\/init\.d\/[^'" ]+\s+(?:start|stop|restart)/, 'artifact inspector simulates installation/runtime');
  assert.match(inspector, /multilogin\/script\.js/);
  const { ipk, sums } = createArtifactFixture();
  const inspectArgs = (fixture, style = 'plain') => ['tools/release/inspect-artifact.sh', '--ipk', fixture.ipk, '--checksums', fixture.sums, '--tag', 'v3.0.0-rc.1', '--release-style', style];
  const accepted = run('sh', inspectArgs({ ipk, sums }), { timeout: 8000 });
  assert.equal(accepted.status, 0, `${accepted.stdout}\n${accepted.stderr}`);
  assert.match(accepted.stdout, /artifact inspection passed/);
  const arFixture = createArtifactFixture('valid-ar', { outerFormat: 'ar' });
  const acceptedAr = run('sh', inspectArgs(arFixture), { timeout: 8000 });
  assert.equal(acceptedAr.status, 0, `${acceptedAr.stdout}\n${acceptedAr.stderr}`);
  const releaseRFixture = createArtifactFixture('valid-release-r', { releaseStyle: 'r' });
  const acceptedReleaseR = run('sh', inspectArgs(releaseRFixture, 'r'), { timeout: 8000 });
  assert.equal(acceptedReleaseR.status, 0, `${acceptedReleaseR.stdout}\n${acceptedReleaseR.stderr}`);
  assert.notEqual(run('sh', inspectArgs(releaseRFixture, 'plain')).status, 0);
  const badSums = write('bad-sha256sums.txt', `${'0'.repeat(64)}  ${path.basename(ipk)}\n`);
  assert.notEqual(run('sh', ['tools/release/inspect-artifact.sh', '--ipk', ipk, '--checksums', badSums, '--tag', 'v3.0.0-rc.1', '--release-style', 'plain']).status, 0);
  const wrongName = path.join(temporary, 'wrong.ipk'); fs.copyFileSync(ipk, wrongName);
  assert.notEqual(run('sh', ['tools/release/inspect-artifact.sh', '--ipk', wrongName, '--checksums', sums, '--tag', 'v3.0.0-rc.1', '--release-style', 'plain']).status, 0);
  for (const fixture of [
    createArtifactFixture('bad-control', { depends: 'libc, bash, curl, mwan3, jsonfilter' }),
    createArtifactFixture('extra-dependency', { depends: 'libc, bash, curl, mwan3, jsonfilter, luci-base, busybox' }),
    createArtifactFixture('bad-file-list', { omit: 'usr/libexec/multilogin-config' }),
    createArtifactFixture('bad-mode', { badMode: 'etc/init.d/multilogin' }),
    createArtifactFixture('extra-payload', { extraPayload: true }),
    createArtifactFixture('marker-only-hook', { markerOnlyHook: 'preinst' }),
  ]) {
    const rejected = run('sh', inspectArgs(fixture), { timeout: 8000 });
    assert.notEqual(rejected.status, 0, `invalid prepared artifact passed: ${fixture.ipk}`);
  }
  pass('prepared IPK archive filename/control/files/modes/dependencies/checksum inspect read-only');
}

function apkArtifactInspectionTests() {
  const inspector = read('tools/release/inspect-artifact.sh');
  assert.match(inspector, /"\$APK_TOOL" adbdump/);
  assert.match(inspector, /"\$APK_TOOL" extract/);
  assert.doesNotMatch(inspector, /"\$APK_TOOL"\s+(?:add|del|fix|upgrade)|chroot|qemu/i, 'APK inspector installs or emulates package behavior');
  const inspectArgs = (fixture, style = 'r') => [
    'tools/release/inspect-artifact.sh', '--apk', fixture.apk, '--apk-tool', fixture.fakeTool,
    '--checksums', fixture.sums, '--tag', 'v3.0.0-rc.1', '--release-style', style,
  ];
  const valid = createApkArtifactFixture();
  const accepted = run('sh', inspectArgs(valid), { timeout: 8000 });
  assert.equal(accepted.status, 0, `${accepted.stdout}\n${accepted.stderr}`);
  assert.notEqual(run('sh', inspectArgs(valid, 'plain'), { timeout: 8000 }).status, 0);
  for (const fixture of [
    createApkArtifactFixture('apk-bad-version', { version: '3.0.0-rc.1-r1' }),
    createApkArtifactFixture('apk-extra-dependency', { depends: ['bash', 'curl', 'jsonfilter', 'libc', 'luci-base', 'mwan3', 'busybox'] }),
    createApkArtifactFixture('apk-bad-file-list', { omit: 'usr/libexec/multilogin-config' }),
    createApkArtifactFixture('apk-bad-mode', { badMode: 'etc/init.d/multilogin' }),
    createApkArtifactFixture('apk-extra-payload', { extraPayload: true }),
    createApkArtifactFixture('apk-literal-hook', { literalHook: true }),
    createApkArtifactFixture('apk-missing-marker', { missingMarker: true }),
    createApkArtifactFixture('apk-extra-hook-prefix', { extraHookPrefix: true }),
    createApkArtifactFixture('apk-duplicate-hook', { duplicateHook: true }),
  ]) {
    const rejected = run('sh', inspectArgs(fixture), { timeout: 8000 });
    assert.notEqual(rejected.status, 0, `invalid prepared APK passed: ${fixture.apk}`);
  }
  pass('prepared APK metadata/files/modes/dependencies/hooks/checksum inspect read-only and fail closed');
}

workflowPolicyTests();
sdkMatrixTests();
metadataTests();
scriptVersionTests();
changeScopeTests();
artifactInspectionTests();
apkArtifactInspectionTests();
process.stdout.write(`${checks} Phase 8 static/pure checks passed.\n`);

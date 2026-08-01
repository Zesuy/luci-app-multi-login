#!/usr/bin/env node
/* Bounded Phase 4 static checks and narrow wrapper argv/stdin tests. */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const tests = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(tests, '..');
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'multilogin-phase4-logic.'));
const baselineCommit = 'fb272e8285c65415dea8a9a359a4204b94be06a0';
const expectedHashes = Object.freeze({
  'check_status.sh': '24ae7e4190701786f39111e7a15210e8d3fa52fd1d25157806e89035bf5a590e',
  'login.sh': '6ceef1565b393e692216f8c789d52a5fe533df35f1db243eb90527c61d95b380',
  'login_A.sh': '2c8551c7b2e8af6c7f791640bbb1718ee97abf28245fa695637a41988e8eef94',
  'login_huxi.sh': '6ceef1565b393e692216f8c789d52a5fe533df35f1db243eb90527c61d95b380',
  'logout.sh': '176e170723d8eef5fcc90cf160c50239c57213ff2c55e6b5a44a677f5b0ab5ca',
});
const constantsByFile = Object.freeze({
  'check_status.sh': 'ML_KNOWN_STATUS_SHA',
  'login.sh': 'ML_KNOWN_LOGIN_SHA',
  'login_A.sh': 'ML_KNOWN_A_SHA',
  'login_huxi.sh': 'ML_KNOWN_HUXI_SHA',
  'logout.sh': 'ML_KNOWN_LOGOUT_SHA',
});
let checks = 0;

process.on('exit', () => fs.rmSync(temporaryRoot, { recursive: true, force: true }));

const read = (file) => fs.readFileSync(file, 'utf8');
const digest = (value) => crypto.createHash('sha256').update(value).digest('hex');
const pass = (name) => { checks += 1; process.stdout.write(`PASS  phase4-logic: ${name}\n`); };

function write(file, body, mode = 0o600) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body, { mode });
  fs.chmodSync(file, mode);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repository,
    env: { ...process.env, ...options.env },
    encoding: 'utf8',
    input: options.input,
    timeout: options.timeout ?? 3000,
  });
  if (result.error)
    throw result.error;
  return result;
}

function packageTextTests() {
  const makefile = read(path.join(repository, 'Makefile'));
  assert.match(makefile, /define Package\/luci-app-multilogin\/conffiles\n\/etc\/config\/multilogin\nendef/);
  assert.match(makefile, /\$\(INSTALL_CONF\) \.\/etc\/config\/multilogin \$\(1\)\/etc\/config\//);
  assert.match(makefile, /\$\(INSTALL_BIN\) \.\/etc\/multilogin\/cqu-portal\.sh \$\(1\)\/usr\/lib\/multilogin\/cqu-portal\.factory\.sh/);
  assert.doesNotMatch(makefile, /cqu-portal\.sh \$\(1\)\/etc\/multilogin/);
  for (const name of ['login_control.bash', 'login.sh', 'check_status.sh', 'logout.sh', 'quick_setup.sh'])
    assert.match(makefile, new RegExp(`\\$\\(INSTALL_BIN\\) \\.\\/etc\\/multilogin\\/${name.replace('.', '\\.')} \\$\\(1\\)\\/etc\\/multilogin\\/`));
  assert.doesNotMatch(makefile, /INSTALL_(?:BIN|DATA).*login_(?:huxi|A)\.sh/);

  for (const hook of ['preinst', 'postinst', 'prerm', 'postrm']) {
    const block = makefile.match(new RegExp(`define Package/luci-app-multilogin/${hook}([\\s\\S]*?)endef`))?.[1] ?? '';
    assert.match(block, /ML_MIGRATION_EMBEDDED=1/);
    assert.ok(block.includes('$(file <$(CURDIR)/package/multilogin-migrate.sh)'), `${hook} does not embed migration logic`);
    assert.ok(block.includes(`$(file <$(CURDIR)/package/hooks/${hook}.sh)`), `${hook} does not embed its dispatcher`);
    assert.doesNotMatch(block, /\$\$\(file/, `${hook} uses an APK-incompatible deferred file expression`);
  }
  pass('Makefile ownership, conffile, factory, wrapper, and hook embedding text');
}

function freshConfigTests() {
  const config = read(path.join(repository, 'etc/config/multilogin'));
  assert.equal((config.match(/^config /gm) ?? []).length, 1);
  assert.match(config, /^config settings 'global'$/m);
  for (const [name, value] of Object.entries({ enabled: '0', log_level: 'info', retry_interval: '4', check_interval: '5', max_retry_delay: '16384', already_logged_delay: '16' }))
    assert.match(config, new RegExp(`^\\s*option ${name} '${value}'$`, 'm'));
  assert.doesNotMatch(config, /^config (?:account|instance)\b/m);
  assert.doesNotMatch(config, /\b(?:username|password)\b/);
  pass('fresh config contains only disabled global settings with frozen defaults');
}

function pinnedHashTests() {
  const migration = read(path.join(repository, 'package/multilogin-migrate.sh'));
  const baselineReport = read(path.join(repository, 'docs/v3/baseline-v2.2.0-4.txt'));
  const parsed = {};
  for (const [name, expected] of Object.entries(expectedHashes)) {
    const shown = run('git', ['show', `${baselineCommit}:etc/multilogin/${name}`]);
    assert.equal(shown.status, 0, `cannot read pinned ${name}`);
    assert.equal(digest(shown.stdout), expected, `${name} pinned content hash`);
    const row = baselineReport.split('\n').find((line) => line.includes(`\`etc/multilogin/${name}\``));
    assert.ok(row?.endsWith(`| \`${expected}\` |`), `${name} deterministic baseline row`);
    const constant = constantsByFile[name];
    const match = migration.match(new RegExp(`^${constant}='([0-9a-f]{64})'$`, 'm'));
    assert.ok(match, `${constant} is missing`); parsed[name] = match[1];
    assert.equal(parsed[name], expected, `${name} migration decision hash`);
    assert.ok(migration.includes(`${name}:"$${constant}"`), `${name} is absent from ml_known_hash`);
    assert.match(migration, new RegExp(`${name.replace('.', '\\.')}\\) printf '%s\\\\n' '${expected}'`));
  }
  const isKnownStock = (name, hash) => Object.hasOwn(parsed, name) && parsed[name] === hash;
  for (const [name, hash] of Object.entries(expectedHashes)) assert.equal(isKnownStock(name, hash), true);
  assert.equal(isKnownStock('login.sh', `${expectedHashes['login.sh'][0] === '0' ? '1' : '0'}${expectedHashes['login.sh'].slice(1)}`), false);
  assert.equal(isKnownStock('unknown.sh', expectedHashes['login.sh']), false);
  assert.match(migration, /\[ "\$ML_TARGET" = 2\.2\.0-4 \] \|\|/);
  assert.match(migration, /source=fb272e8285c65415dea8a9a359a4204b94be06a0/);
  assert.equal(expectedHashes['login.sh'], expectedHashes['login_huxi.sh']);
  pass('pinned v2 hashes and stock/downgrade decision predicates');
}

function wrapperHarness(name) {
  const directory = fs.mkdtempSync(path.join(temporaryRoot, `${name}.`));
  const argvFile = path.join(directory, 'argv.bin');
  const stdinFile = path.join(directory, 'stdin.bin');
  const core = path.join(directory, 'core.sh');
  write(core, `#!/bin/sh\n: > '${argvFile}'\nfor value do printf '%s\\0' "$value" >> '${argvFile}'; done\ncat > '${stdinFile}'\nprintf '%s\\n' '{"ok":true,"outcome":"stub"}'\nexit "\${CORE_EXIT:-0}"\n`, 0o755);
  return { directory, argvFile, stdinFile, core, env: { MULTILOGIN_WRAPPER_TEST_MODE: '1', MULTILOGIN_TEST_PORTAL_PATH: core } };
}

function capturedArgv(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file).toString('utf8').split('\0').slice(0, -1);
}

function wrapperTests() {
  const wrapperDirectory = path.join(repository, 'etc/multilogin');
  const inputSentinel = `phase4-wrapper-stdin-${digest('fixture').slice(0, 12)}`;
  const cases = [
    ['login.sh', ['--mwan3', 'wan0', '--account', 'account0', '--v6face', 'wan6', '--ua-type', 'pc'], ['login', '--mwan3', 'wan0', '--account', 'account0', '--ua-type', 'pc', '--v6face', 'wan6'], `${inputSentinel}\n`],
    ['login.sh', ['--check-only', '--mwan3', 'wan0', '--account', 'account0'], ['status', '--mwan3', 'wan0', '--ua-type', 'mobile', '--account', 'account0'], ''],
    ['check_status.sh', ['--mwan3', 'wan0', '--account', 'account0', '--v6face', 'wan6', '--ua-type', 'mobile'], ['status', '--mwan3', 'wan0', '--account', 'account0', '--v6face', 'wan6', '--ua-type', 'mobile'], ''],
    ['logout.sh', ['--mwan3', 'wan0', '--account', 'account0', '--v6face', 'wan6', '--ua-type', 'pc'], ['logout', '--mwan3', 'wan0', '--account', 'account0', '--v6face', 'wan6', '--ua-type', 'pc'], ''],
  ];
  for (const [name, args, expectedArgv, expectedStdin] of cases) {
    const harness = wrapperHarness(name.replace('.', '-'));
    const suppliedInput = `${inputSentinel}\n`;
    const result = run(path.join(wrapperDirectory, name), args, { env: harness.env, input: suppliedInput });
    assert.equal(result.status, 0, `${name} mapping status`);
    assert.deepEqual(capturedArgv(harness.argvFile), expectedArgv, `${name} mapping argv`);
    assert.equal(read(harness.stdinFile), expectedStdin, `${name} stdin boundary`);
    assert.equal(result.stdout.includes(inputSentinel) || result.stderr.includes(inputSentinel), false, `${name} leaked stdin`);
  }

  for (const name of ['login.sh', 'check_status.sh', 'logout.sh']) {
    for (const args of [['--password', 'forbidden'], ['--mwan3'], ['--mwan3', 'wan0', '--unknown'], ['--mwan3', 'wan0', '--ua-type', 'tablet']]) {
      const harness = wrapperHarness(`reject-${name.replace('.', '-')}`);
      const result = run(path.join(wrapperDirectory, name), args, { env: harness.env });
      assert.equal(result.status, 4, `${name} rejection status`);
      assert.equal(fs.existsSync(harness.argvFile), false, `${name} called core for rejected arguments`);
    }
  }

  const propagation = wrapperHarness('exit-propagation');
  const propagated = run(path.join(wrapperDirectory, 'logout.sh'), ['--mwan3', 'wan0', '--account', 'account0'], { env: { ...propagation.env, CORE_EXIT: '9' } });
  assert.equal(propagated.status, 9, 'wrapper did not propagate core exit status');
  assert.match(read(path.join(wrapperDirectory, 'login.sh')), /exec "\$core" "\$@" <\/dev\/null/);
  assert.match(read(path.join(wrapperDirectory, 'check_status.sh')), /exec "\$core" "\$@" <\/dev\/null/);
  assert.match(read(path.join(wrapperDirectory, 'logout.sh')), /exec "\$core" "\$@" <\/dev\/null/);
  pass('wrapper mapping, rejection, exit propagation, and stdin versus /dev/null boundaries');
}

function syntaxCompileTests() {
  const migration = read(path.join(repository, 'package/multilogin-migrate.sh'));
  const useBusyBox = run('/bin/sh', ['-c', 'command -v busybox >/dev/null 2>&1']).status === 0;
  const compile = (label, source) => {
    const file = path.join(temporaryRoot, `${label}.sh`); write(file, source, 0o700);
    assert.equal(run('/bin/sh', ['-n', file]).status, 0, `${label} sh syntax`);
    if (useBusyBox) assert.equal(run('busybox', ['ash', '-n', file]).status, 0, `${label} BusyBox ash syntax`);
  };
  for (const hook of ['preinst', 'postinst', 'prerm', 'postrm']) {
    const dispatcher = read(path.join(repository, 'package/hooks', `${hook}.sh`));
    const expanded = `#!/bin/sh\nML_MIGRATION_EMBEDDED=1\n${migration}\n${dispatcher}\n`;
    assert.equal(expanded.includes('$$(file'), false, `${hook} expansion retained a Make expression`);
    compile(`expanded-${hook}`, expanded);
  }
  const finalizer = migration.match(/cat <<'ML_FINALIZER_EOF'[^\n]*\n(#!\/bin\/sh[\s\S]*?)\nML_FINALIZER_EOF\n/)?.[1];
  assert.ok(finalizer, 'embedded downgrade finalizer was not extractable');
  compile('downgrade-finalizer', `${finalizer}\n`);
  pass(`embedded hook and finalizer syntax${useBusyBox ? ' under sh and BusyBox ash' : ' under sh'}`);
}

packageTextTests();
freshConfigTests();
pinnedHashTests();
wrapperTests();
syntaxCompileTests();
process.stdout.write(`${checks} Phase 4 static/pure checks passed.\n`);

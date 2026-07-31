#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(testDirectory, '..');
const script = path.join(repository, 'etc/multilogin/cqu-portal.sh');
const mockCommand = path.join(testDirectory, 'mocks/command');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'multilogin-portal-tests.'));
const createdHarnesses = [];
const emptyHash = crypto.createHash('sha256').update('').digest('hex');
const pcUa = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36';
const mobileUa = 'Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Mobile Safari/537.36';
let checks = 0;

process.on('exit', () => fs.rmSync(root, { recursive: true, force: true }));

function digest(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition)
    fail(message);
}

function equal(actual, expected, message) {
  if (actual !== expected)
    fail(`${message}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
}

function deepEqual(actual, expected, message) {
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    fail(`${message}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
}

function pass(name) {
  checks += 1;
  process.stdout.write(`PASS  portal: ${name}\n`);
}

function write(file, value = '') {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value, { mode: 0o600 });
}

function jsonp(payload) {
  return `fixtureCallback(${JSON.stringify(payload)});\n`;
}

function createHarness(name, options = {}) {
  const scenario = fs.mkdtempSync(path.join(root, `${name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.`));
  const state = path.join(scenario, 'state');
  const bin = path.join(scenario, 'bin');
  const tmp = path.join(scenario, 'tmp');
  fs.mkdirSync(path.join(state, 'allow'), { recursive: true });
  fs.mkdirSync(path.join(state, 'responses'), { recursive: true });
  fs.mkdirSync(bin, { recursive: true });
  fs.mkdirSync(tmp, { mode: 0o700 });

  const commands = ['uci', 'jsonfilter', 'ifstatus', 'ip', 'mwan3', 'curl', 'logger', 'sleep'];
  for (const command of commands)
    fs.symlinkSync(mockCommand, path.join(bin, command));
  for (const command of ['uci', 'jsonfilter', 'ifstatus', 'ip', 'mwan3', 'logger', 'sleep'])
    write(path.join(state, 'allow', command));

  if (options.missingCommand)
    fs.rmSync(path.join(bin, options.missingCommand), { force: true });

  if (options.restrictedPath) {
    for (const tool of ['awk', 'cat', 'chmod', 'cut', 'date', 'dirname', 'grep', 'head', 'mkdir', 'mktemp', 'node', 'od', 'rm', 'sed', 'sha256sum', 'tr']) {
      if (fs.existsSync(path.join(bin, tool)))
        continue;
      const lookup = spawnSync('/bin/sh', ['-c', 'command -v "$1"', 'lookup', tool], { encoding: 'utf8' });
      if (lookup.status === 0)
        fs.symlinkSync(lookup.stdout.trim(), path.join(bin, tool));
    }
  }

  const secret = options.secret ?? '';
  const env = {
    ...process.env,
    PATH: options.restrictedPath ? bin : `${bin}:${process.env.PATH}`,
    TMPDIR: tmp,
    MULTILOGIN_TEST_MODE: '1',
    MULTILOGIN_TEST_CALLBACK: 'fixtureCallback',
    MULTILOGIN_TEST_CACHE: '1700000000000',
    MULTILOGIN_MOCK_STATE: state,
    MULTILOGIN_MOCK_CAPTURE_HELPER: path.join(testDirectory, 'mocks/capture-stdin.mjs'),
    MULTILOGIN_MOCK_JSONFILTER_HELPER: path.join(testDirectory, 'mocks/jsonfilter.mjs'),
    MULTILOGIN_MOCK_CURL_INSPECTOR: path.join(testDirectory, 'mocks/inspect-curl-config.mjs'),
    MULTILOGIN_MOCK_DEVICE_HELPER: path.join(testDirectory, 'mocks/device-command.mjs'),
    MULTILOGIN_MOCK_SECRET_SHA256: secret ? digest(secret) : emptyHash,
    MULTILOGIN_MOCK_INTERFACE: 'wan-test',
    MULTILOGIN_MOCK_V6FACE: 'wan6-test',
    MULTILOGIN_MOCK_DEVICE: 'eth-test',
    MULTILOGIN_MOCK_V6_DEVICE: 'eth6-test',
    MULTILOGIN_MOCK_IPV4: '192.0.2.10',
    MULTILOGIN_MOCK_IPV6: '2001:db8::10',
    MULTILOGIN_MOCK_MAC: '02:00:00:00:00:10',
    ...options.env,
  };
  const harness = { name, scenario, state, bin, tmp, secret, env };
  createdHarnesses.push(harness);
  return harness;
}

function networkResponses(harness, responses) {
  responses.forEach((response, index) => {
    const directory = path.join(harness.state, 'responses/mwan3', String(index + 1));
    write(path.join(directory, 'status'), `${response.status ?? 0}\n`);
    if (Object.hasOwn(response, 'body'))
      write(path.join(directory, 'stdout'), typeof response.body === 'string' ? response.body : jsonp(response.body));
    if (response.block)
      write(path.join(directory, 'block'));
  });
}

function invoke(harness, args, options = {}) {
  if (options.responses)
    networkResponses(harness, options.responses);
  const command = options.busybox ?? script;
  const commandArgs = options.busybox ? ['ash', script, ...args] : args;
  const result = spawnSync(command, commandArgs, {
    env: harness.env,
    encoding: 'utf8',
    input: options.input,
    timeout: options.timeout ?? 10000,
  });
  if (result.error)
    throw result.error;
  return { ...result, status: result.status ?? 128 };
}

function busyboxPath() {
  const lookup = spawnSync('/bin/sh', ['-c', 'command -v busybox'], { env: process.env, encoding: 'utf8' });
  return lookup.status === 0 ? lookup.stdout.trim() : '';
}

function envelope(result, expectedStatus, action, outcome, errorKind) {
  equal(result.status, expectedStatus, `${action}/${outcome} exit status`);
  const lines = result.stdout.trim().split(/\r?\n/).filter(Boolean);
  equal(lines.length, 1, `${action}/${outcome} stdout envelope count`);
  let payload;
  try {
    payload = JSON.parse(lines[0]);
  } catch {
    fail(`${action}/${outcome} emitted invalid JSON: ${result.stdout}`);
  }
  equal(payload.action, action, `${action}/${outcome} action`);
  equal(payload.outcome, outcome, `${action}/${outcome} outcome`);
  equal(payload.error_kind, errorKind, `${action}/${outcome} error_kind`);
  equal(payload.api, 3, `${action}/${outcome} API`);
  equal(payload.version, '3.0.0-rc.1', `${action}/${outcome} version`);
  assert(payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data), `${action}/${outcome} data must be an object`);
  // Status `offline` is a trustworthy negative observation: it keeps ok=true
  // even though its compatibility exit code is 1. Other exit-1 outcomes are
  // rejected actions and remain ok=false.
  const expectedOk = outcome === 'offline' || [0, 2].includes(expectedStatus);
  equal(payload.ok, expectedOk, `${action}/${outcome} ok`);
  return payload;
}

function callDirectories(harness, command) {
  const directory = path.join(harness.state, 'calls', command);
  if (!fs.existsSync(directory))
    return [];
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d+$/.test(entry.name))
    .sort((left, right) => Number(left.name) - Number(right.name))
    .map((entry) => path.join(directory, entry.name));
}

function argvFor(callDirectory) {
  return fs.readFileSync(path.join(callDirectory, 'argv.bin')).toString('utf8').split('\0').slice(0, -1);
}

function reports(harness) {
  return callDirectories(harness, 'mwan3').map((directory) => JSON.parse(fs.readFileSync(path.join(directory, 'curl-config.json'), 'utf8')));
}

function urls(harness) {
  return reports(harness).map((report) => new URL(report.url).pathname);
}

function assertNoNetwork(harness, label) {
  equal(callDirectories(harness, 'mwan3').length, 0, `${label} must not call mwan3`);
  equal(callDirectories(harness, 'curl').length, 0, `${label} must not call curl`);
}

function assertConfigSecurity(harness, expectPassword = false) {
  for (const call of callDirectories(harness, 'mwan3')) {
    const argv = argvFor(call);
    equal(argv.length, 5, 'mwan3 argc');
    deepEqual(argv.slice(0, 4), ['use', 'wan-test', 'curl', '--config'], 'mwan3 fixed argv');
    assert(!argv.some((argument) => argument.includes('Mozilla/')), 'spaced UA leaked into mwan3 argv');
    assert(!argv.some((argument) => harness.secret && argument.includes(harness.secret)), 'password leaked into mwan3 argv');
    const report = JSON.parse(fs.readFileSync(path.join(call, 'curl-config.json'), 'utf8'));
    equal(report.config_mode, '0600', 'curl config mode');
    equal(report.directory_mode, '0700', 'curl temp directory mode');
    assert(report.url.startsWith('https://login.cqu.edu.cn:802/eportal/portal/'), 'curl URL origin is fixed');
    if (report.term_ua !== null)
      equal(report.user_agent, report.term_ua, 'HTTP User-Agent equals term_ua');
    if (expectPassword && report.url.endsWith('/eportal/portal/login'))
      equal(report.params.user_password[0].matches_secret, true, 'curl config preserves exact password bytes');
    const configPath = argv[4];
    assert(!fs.existsSync(configPath), 'curl config survives action cleanup');
    assert(!fs.existsSync(path.dirname(configPath)), 'curl temp directory survives action cleanup');
  }
}

function walkFiles(directory, output = []) {
  if (!fs.existsSync(directory))
    return output;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory())
      walkFiles(file, output);
    else if (entry.isFile())
      output.push(file);
  }
  return output;
}

function assertSecretAbsent(harness, result) {
  if (!harness.secret)
    return;
  assert(!result.stdout.includes(harness.secret), 'password leaked to stdout');
  assert(!result.stderr.includes(harness.secret), 'password leaked to stderr');
  for (const file of walkFiles(harness.scenario)) {
    const buffer = fs.readFileSync(file);
    assert(!buffer.includes(Buffer.from(harness.secret)), `password persisted in ${path.relative(harness.scenario, file)}`);
  }
}

function params(report, name) {
  return report.params[name] ?? [];
}

function online(phoneFlag, identity = {}) {
  return { result: 1, list: [{ phone_flag: phoneFlag, ...identity }] };
}

function offline() {
  return { result: 0, list: [] };
}

function syntaxAndMetadataTests() {
  for (const action of ['version', 'self-test']) {
    const harness = createHarness(action);
    const result = invoke(harness, [action]);
    envelope(result, 0, action, action === 'version' ? 'version' : 'self_test_pass', null);
    assertNoNetwork(harness, action);
  }
  pass('version and self-test are offline and machine-readable');

  const invalid = [
    [[], 'missing action'],
    [['unknown'], 'unknown action'],
    [['status'], 'missing required interface'],
    [['status', '--mwan3'], 'missing option value'],
    [['status', '--mwan3', 'wan-test', '--unknown'], 'unknown option'],
    [['status', '--mwan3', 'wan-test', 'extra'], 'extra positional argument'],
    [['status', '--mwan3', 'wan-test', '--ua-type', 'tablet'], 'invalid UA type'],
    [['login', '--mwan3', 'wan-test', '--account', 'fixture', '--ua-type', 'pc', '--password', 'forbidden'], 'password argv'],
  ];
  for (const [args, label] of invalid) {
    const harness = createHarness(`args-${label}`);
    const result = invoke(harness, args);
    envelope(result, 4, args[0] ?? 'unknown', 'argument_error', 'arguments');
    assertNoNetwork(harness, label);
  }
  for (const [input, label] of [[undefined, 'missing stdin password'], ['\n', 'empty stdin password']]) {
    const harness = createHarness(`args-${label}`);
    const result = invoke(harness, ['login', '--mwan3', 'wan-test', '--account', 'fixture-account', '--ua-type', 'pc'], { input });
    envelope(result, 4, 'login', 'argument_error', 'arguments');
    assertNoNetwork(harness, label);
  }
  for (const [input, label] of [[Buffer.from('nul\0secret\n'), 'NUL stdin password'], ['first\nsecond\n', 'second stdin line']]) {
    const secret = 'stdin-secret-sentinel';
    const harness = createHarness(`args-${label}`, { secret });
    const result = invoke(harness, ['login', '--mwan3', 'wan-test', '--account', 'fixture-account', '--ua-type', 'pc'], { input });
    envelope(result, 4, 'login', 'argument_error', 'arguments');
    assertNoNetwork(harness, label);
    assertSecretAbsent(harness, result);
  }
  pass('strict argument parser rejects missing, unknown, extra, invalid, and password argv');

  // Argument parsing runs before PATH is normalized or dependencies are
  // checked. A valid account must therefore use shell-only validation: with
  // an empty ambient PATH it reaches dependency_error rather than being
  // misclassified as argument_error because an external helper is missing.
  const busybox = busyboxPath();
  let harness = createHarness('args-unicode-empty-path', { env: { PATH: '' } });
  let result = invoke(harness, ['login', '--mwan3', 'wan-test', '--account', '学生 user', '--ua-type', 'pc'], { busybox: busybox || undefined });
  envelope(result, 5, 'login', 'dependency_error', 'dependency');
  assertNoNetwork(harness, 'UTF-8/space account with empty PATH');

  harness = createHarness('args-control-account');
  result = invoke(harness, ['login', '--mwan3', 'wan-test', '--account', 'bad\naccount', '--ua-type', 'pc'], { busybox: busybox || undefined });
  envelope(result, 4, 'login', 'argument_error', 'arguments');
  assertNoNetwork(harness, 'control-character account');
  pass(`shell-only account validation handles UTF-8/spaces and rejects controls${busybox ? ' under BusyBox ash' : ''}`);
}

function statusTests() {
  const scenarios = [
    ['offline', offline(), 1, 'offline', null],
    ['pc-online', online(0), 0, 'online', null],
    ['mobile-online', online(1), 0, 'online', null],
  ];
  for (const [name, body, status, outcome, errorKind] of scenarios) {
    const harness = createHarness(name);
    const result = invoke(harness, ['status', '--mwan3', 'wan-test'], { responses: [{ body }] });
    envelope(result, status, 'status', outcome, errorKind);
    assertConfigSecurity(harness);
  }

  let harness = createHarness('status-malformed');
  let result = invoke(harness, ['status', '--mwan3', 'wan-test'], { responses: [{ body: 'fixtureCallback({"result":1,"list":[});\n' }] });
  envelope(result, 3, 'status', 'protocol_error', 'protocol');

  harness = createHarness('status-transport');
  result = invoke(harness, ['status', '--mwan3', 'wan-test'], { responses: [{ status: 7 }] });
  envelope(result, 3, 'status', 'transport_error', 'transport');

  harness = createHarness('status-dependency', { missingCommand: 'mwan3' });
  result = invoke(harness, ['status', '--mwan3', 'wan-test']);
  envelope(result, 5, 'status', 'dependency_error', 'dependency');
  assertNoNetwork(harness, 'missing dependency');

  for (const [name, env, args] of [
    ['device', { MULTILOGIN_MOCK_NO_DEVICE: '1' }, ['status', '--mwan3', 'wan-test']],
    ['ipv4', { MULTILOGIN_MOCK_NO_IPV4: '1' }, ['status', '--mwan3', 'wan-test']],
    ['mac', { MULTILOGIN_MOCK_NO_MAC: '1' }, ['status', '--mwan3', 'wan-test']],
    ['ipv6', { MULTILOGIN_MOCK_NO_IPV6: '1' }, ['status', '--mwan3', 'wan-test', '--v6face', 'wan6-test']],
  ]) {
    harness = createHarness(`status-interface-${name}`, { env });
    result = invoke(harness, args);
    envelope(result, 6, 'status', 'interface_error', 'interface');
    assertNoNetwork(harness, `missing ${name}`);
  }

  harness = createHarness('status-encoding', { restrictedPath: true });
  result = invoke(harness, ['status', '--mwan3', 'wan-test']);
  envelope(result, 7, 'status', 'encoding_error', 'encoding');
  assertNoNetwork(harness, 'missing Base64 capability');
  pass('status handles offline, both classifications, malformed, transport, dependency, interface, and Base64 failures');

  harness = createHarness('status-ipv6');
  result = invoke(harness, ['status', '--mwan3', 'wan-test', '--v6face', 'wan6-test'], { responses: [{ body: offline() }] });
  envelope(result, 1, 'status', 'offline', null);
  const report = reports(harness)[0];
  deepEqual(params(report, 'wlan_user_ip'), [Buffer.from('192.0.2.10').toString('base64')], 'status IPv4 Base64');
  deepEqual(params(report, 'wlan_user_ipv6'), [Buffer.from('2001:db8::10').toString('base64')], 'status IPv6 Base64');
  equal(report.url, 'https://login.cqu.edu.cn:802/eportal/portal/online_list', 'status URL');
  deepEqual(Object.keys(report.params).sort(), ['callback', 'jsVersion', 'lang', 'user_account', 'user_password', 'v', 'wlan_user_ip', 'wlan_user_ipv6', 'wlan_user_mac'].sort(), 'status parameter names');
  deepEqual(params(report, 'callback'), ['fixtureCallback'], 'fixed callback');
  deepEqual(params(report, 'v'), ['1700000000000'], 'fixed cache value');
  deepEqual(params(report, 'jsVersion'), ['4.X'], 'status JS version');
  deepEqual(params(report, 'lang'), ['zh'], 'status language');
  pass('status freezes URL, parameters, deterministic values, and Base64 addresses');

  harness = createHarness('status-ipv6-missing', { env: { MULTILOGIN_MOCK_NO_IPV6: '1' } });
  result = invoke(harness, ['status', '--mwan3', 'wan-test', '--v6face', 'wan6-test']);
  envelope(result, 6, 'status', 'interface_error', 'interface');
}

function loginTests() {
  const specialSecret = `phase2-secret ${Date.now()} "quote" \\tail`;
  let harness = createHarness('login-pc-success', { secret: specialSecret });
  let result = invoke(harness, ['login', '--mwan3', 'wan-test', '--account', 'fixture-account', '--v6face', 'wan6-test', '--ua-type', 'pc'], {
    input: `${specialSecret}\n`,
    responses: [{ body: offline() }, { body: { result: 1, ret_code: 0 } }, { body: online(0) }],
  });
  envelope(result, 0, 'login', 'login_success', null);
  assertConfigSecurity(harness, true);
  assertSecretAbsent(harness, result);
  const request = reports(harness)[1];
  equal(request.url, 'https://login.cqu.edu.cn:802/eportal/portal/login', 'login URL');
  deepEqual(Object.keys(request.params).sort(), [
    'callback', 'jsVersion', 'lang', 'login_method', 'term_type', 'term_ua', 'terminal_type', 'user_account',
    'user_password', 'v', 'wlan_ac_ip', 'wlan_ac_name', 'wlan_user_ip', 'wlan_user_ipv6', 'wlan_user_mac',
  ].sort(), 'login parameter names');
  deepEqual(params(request, 'login_method'), ['1'], 'login method');
  equal(request.account_operator, '0', 'PC login operator');
  deepEqual(params(request, 'term_type'), ['1'], 'PC term type');
  deepEqual(params(request, 'terminal_type'), ['1'], 'PC terminal type');
  deepEqual(params(request, 'term_ua'), [pcUa], 'PC term UA');
  equal(request.user_agent, pcUa, 'PC HTTP UA');
  deepEqual(params(request, 'lang'), ['zh-cn', 'zh'], 'duplicate login language values');
  deepEqual(params(request, 'wlan_user_ip'), ['192.0.2.10'], 'login plain IPv4');
  deepEqual(params(request, 'wlan_user_ipv6'), ['2001:db8::10'], 'login optional IPv6');
  deepEqual(params(request, 'wlan_user_mac'), ['020000000010'], 'login normalized MAC');

  harness = createHarness('login-unicode-account', { secret: 'unicode fixture passphrase' });
  result = invoke(harness, ['login', '--mwan3', 'wan-test', '--account', '学生 user', '--ua-type', 'pc'], {
    input: `${harness.secret}\n`,
    responses: [{ body: offline() }, { body: { result: 1, ret_code: 0 } }, { body: online(0) }],
  });
  envelope(result, 0, 'login', 'login_success', null);
  const unicodeRequest = reports(harness)[1];
  const unicodeAccount = ',0,学生 user';
  const accountEvidence = params(unicodeRequest, 'user_account')[0];
  equal(accountEvidence.length, unicodeAccount.length, 'UTF-8/space account framing length');
  equal(accountEvidence.sha256, digest(unicodeAccount), 'UTF-8/space account framing digest');
  assertConfigSecurity(harness, true);

  harness = createHarness('login-mobile-success', { secret: 'mobile fixture passphrase' });
  result = invoke(harness, ['login', '--mwan3', 'wan-test', '--account', 'fixture-account', '--ua-type', 'mobile'], {
    input: `${harness.secret}\n`,
    responses: [{ body: offline() }, { body: { result: 1, ret_code: 0 } }, { body: online(1) }],
  });
  envelope(result, 0, 'login', 'login_success', null);
  const mobile = reports(harness)[1];
  deepEqual(params(mobile, 'term_type'), ['2'], 'mobile term type');
  equal(mobile.account_operator, '1', 'mobile login operator');
  deepEqual(params(mobile, 'term_ua'), [mobileUa], 'mobile term UA');
  equal(mobile.user_agent, mobileUa, 'mobile HTTP UA');

  harness = createHarness('login-auth', { secret: 'auth fixture passphrase' });
  result = invoke(harness, ['login', '--mwan3', 'wan-test', '--account', 'fixture-account', '--ua-type', 'pc'], {
    input: `${harness.secret}\n`, responses: [{ body: offline() }, { body: { result: 0, ret_code: 1, message_code: 'AUTH_REJECTED' } }],
  });
  envelope(result, 1, 'login', 'auth_rejected', 'auth');

  harness = createHarness('login-race-already', { secret: 'race fixture passphrase' });
  result = invoke(harness, ['login', '--mwan3', 'wan-test', '--account', 'fixture-account', '--ua-type', 'pc'], {
    input: `${harness.secret}\n`, responses: [{ body: offline() }, { body: { result: 1, ret_code: 2 } }, { body: online(0) }],
  });
  envelope(result, 2, 'login', 'already_online', null);

  harness = createHarness('login-wrong-after-success', { secret: 'wrong-phone fixture passphrase' });
  result = invoke(harness, ['login', '--mwan3', 'wan-test', '--account', 'fixture-account', '--ua-type', 'pc'], {
    input: `${harness.secret}\n`, responses: [{ body: offline() }, { body: { result: 1, ret_code: 0 } }, { body: online(1) }],
  });
  envelope(result, 8, 'login', 'classification_mismatch', 'classification');

  harness = createHarness('login-already', { secret: 'unused fixture passphrase' });
  result = invoke(harness, ['login', '--mwan3', 'wan-test', '--account', 'fixture-account', '--ua-type', 'pc'], {
    input: `${harness.secret}\n`, responses: [{ body: online(0) }],
  });
  envelope(result, 2, 'login', 'already_online', null);
  equal(callDirectories(harness, 'mwan3').length, 1, 'already-online makes no login request');

  harness = createHarness('login-wrong-preexisting', { secret: 'unused mismatch passphrase' });
  result = invoke(harness, ['login', '--mwan3', 'wan-test', '--account', 'fixture-account', '--ua-type', 'pc'], {
    input: `${harness.secret}\n`, responses: [{ body: online(1) }],
  });
  envelope(result, 8, 'login', 'classification_mismatch', 'classification');
  equal(callDirectories(harness, 'mwan3').length, 1, 'classification mismatch makes no login/logout request');

  harness = createHarness('login-never-online', { secret: 'poll fixture passphrase' });
  result = invoke(harness, ['login', '--mwan3', 'wan-test', '--account', 'fixture-account', '--ua-type', 'pc'], {
    input: `${harness.secret}\n`, responses: [{ body: offline() }, { body: { result: 1, ret_code: 0 } }, ...Array.from({ length: 5 }, () => ({ body: offline() }))],
  });
  envelope(result, 3, 'login', 'protocol_error', 'protocol');
  equal(callDirectories(harness, 'sleep').length, 4, 'login polling is bounded to five attempts');
  pass('login covers PC/mobile success, secret config, auth, existing state, mismatch, and bounded confirmation');
}

function logoutTests() {
  let harness = createHarness('logout-offline');
  let result = invoke(harness, ['logout', '--mwan3', 'wan-test', '--account', 'fixture-account'], { responses: [{ body: offline() }] });
  envelope(result, 0, 'logout', 'already_offline', null);
  equal(callDirectories(harness, 'mwan3').length, 1, 'already-offline does not unbind');

  harness = createHarness('logout-delayed');
  result = invoke(harness, ['logout', '--mwan3', 'wan-test', '--account', 'fixture-account'], {
    responses: [
      { body: online(0) }, { body: { result: 1, ret_code: 0 } }, { body: { result: 1, ret_code: 0 } },
      { body: online(0) }, { body: online(0) }, { body: offline() },
    ],
  });
  envelope(result, 0, 'logout', 'logout_success', null);
  deepEqual(urls(harness), [
    '/eportal/portal/online_list', '/eportal/portal/mac/unbind', '/eportal/portal/custom/checkLogout',
    '/eportal/portal/online_list', '/eportal/portal/online_list', '/eportal/portal/online_list',
  ], 'logout request order');
  equal(callDirectories(harness, 'sleep').length, 2, 'delayed logout sleeps between online polls only');
  const unbind = reports(harness)[1];
  deepEqual(Object.keys(unbind.params).sort(), [
    'callback', 'jsVersion', 'lang', 'user_account', 'v', 'wlan_user_ip', 'wlan_user_ipv6', 'wlan_user_mac',
  ].sort(), 'unbind parameter names');
  deepEqual(params(unbind, 'wlan_user_mac'), ['000000000000'], 'unbind zero MAC');
  deepEqual(params(unbind, 'wlan_user_ip'), ['192.0.2.10'], 'unbind plain IPv4');
  harness = createHarness('logout-no-v6');
  result = invoke(harness, ['logout', '--mwan3', 'wan-test', '--account', 'fixture-account'], {
    responses: [{ body: online(0) }, { body: { result: 1 } }, { body: { result: 1 } }, { body: offline() }],
  });
  envelope(result, 0, 'logout', 'logout_success', null);
  deepEqual(params(reports(harness)[1], 'wlan_user_ipv6'), ['::'], 'logout missing IPv6 sentinel');
  const checkLogout = reports(harness)[2];
  deepEqual(Object.keys(checkLogout.params).sort(), ['callback', 'jsVersion', 'lang', 'v', 'wlan_user_ip', 'wlan_user_ipv6'].sort(), 'checkLogout parameter names');

  for (const [name, firstStage, secondStage] of [
    ['negative-stage', { body: { result: 0, ret_code: 1 } }, { body: { result: 0, ret_code: 1 } }],
    ['transport-stage', { status: 7 }, { status: 7 }],
  ]) {
    harness = createHarness(`logout-${name}`);
    result = invoke(harness, ['logout', '--mwan3', 'wan-test', '--account', 'fixture-account'], {
      responses: [{ body: online(0) }, firstStage, secondStage, { body: offline() }],
    });
    envelope(result, 0, 'logout', 'logout_success', null);
    equal(callDirectories(harness, 'mwan3').length, 4, `${name} still checks logout and polls`);
  }

  harness = createHarness('logout-timeout');
  result = invoke(harness, ['logout', '--mwan3', 'wan-test', '--account', 'fixture-account'], {
    responses: [{ body: online(0) }, { body: { result: 1 } }, { body: { result: 1 } }, ...Array.from({ length: 10 }, () => ({ body: online(0) }))],
  });
  envelope(result, 9, 'logout', 'logout_timeout', 'timeout');
  equal(urls(harness).filter((value) => value.endsWith('/online_list')).length, 11, 'logout timeout has initial status plus ten polls');
  equal(callDirectories(harness, 'sleep').length, 9, 'logout timeout does not sleep after final poll');

  harness = createHarness('logout-timeout-mixed-stages');
  result = invoke(harness, ['logout', '--mwan3', 'wan-test', '--account', 'fixture-account'], {
    responses: [{ body: online(0) }, { body: { result: 0 } }, { status: 7 }, ...Array.from({ length: 10 }, () => ({ body: online(0) }))],
  });
  envelope(result, 9, 'logout', 'logout_timeout', 'timeout');

  harness = createHarness('logout-no-valid-poll');
  result = invoke(harness, ['logout', '--mwan3', 'wan-test', '--account', 'fixture-account'], {
    responses: [{ body: online(0) }, { status: 7 }, { body: { result: 0 } }, ...Array.from({ length: 10 }, () => ({ status: 7 }))],
  });
  envelope(result, 3, 'logout', 'transport_error', 'transport');
  equal(urls(harness).filter((value) => value.endsWith('/online_list')).length, 11, 'no-valid-poll still exhausts bound');
  pass('logout is idempotent and enforces unbind/checkLogout/bounded-poll precedence');
}

function identityTests() {
  let harness = createHarness('identity-select');
  let result = invoke(harness, ['status', '--mwan3', 'wan-test'], {
    responses: [{ body: { result: 1, list: [
      { phone_flag: 1, wlan_user_mac: '02:00:00:00:00:10', wlan_user_ip: '192.0.2.11' },
      { phone_flag: 0, wlan_user_mac: '020000000010', wlan_user_ip: '192.0.2.10' },
    ] } }],
  });
  const selected = envelope(result, 0, 'status', 'online', null);
  equal(selected.data.phone_flag, 0, 'identity filtering selects the local record');

  harness = createHarness('identity-ip-select');
  result = invoke(harness, ['status', '--mwan3', 'wan-test'], {
    responses: [{ body: { result: 1, list: [
      { phone_flag: 1, wlan_user_ip: '192.0.2.11' },
      { phone_flag: 0, wlan_user_ip: '192.0.2.10' },
    ] } }],
  });
  const ipSelected = envelope(result, 0, 'status', 'online', null);
  equal(ipSelected.data.phone_flag, 0, 'identity filtering falls back to local IP');

  for (const [name, list] of [
    ['zero-match', [{ phone_flag: 0, wlan_user_mac: '020000000011' }, { phone_flag: 1, wlan_user_mac: '020000000012' }]],
    ['ambiguous-no-identity', [{ phone_flag: 0 }, { phone_flag: 1 }]],
    ['ambiguous-duplicate', [{ phone_flag: 0, wlan_user_mac: '020000000010' }, { phone_flag: 1, wlan_user_mac: '020000000010' }]],
  ]) {
    harness = createHarness(`identity-${name}`);
    result = invoke(harness, ['status', '--mwan3', 'wan-test'], { responses: [{ body: { result: 1, list } }] });
    envelope(result, 3, 'status', 'protocol_error', 'protocol');
  }
  pass('multiple portal records require unique local MAC/IP selection');
}

async function signalAndConcurrencyTests() {
  const secret = 'signal fixture passphrase';
  const harness = createHarness('signal-cleanup', { secret });
  networkResponses(harness, [{ body: offline() }, { block: true, body: { result: 1 } }]);
  const child = spawn(script, ['login', '--mwan3', 'wan-test', '--account', 'fixture-account', '--ua-type', 'pc'], {
    env: harness.env,
    detached: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  child.stdin.end(`${secret}\n`);
  const output = [];
  const errors = [];
  child.stdout.on('data', (chunk) => output.push(chunk));
  child.stderr.on('data', (chunk) => errors.push(chunk));
  const deadline = Date.now() + 5000;
  let call;
  while (Date.now() < deadline) {
    call = callDirectories(harness, 'mwan3')[1];
    if (call && fs.existsSync(path.join(call, 'curl-config.json')))
      break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert(call, 'signal test never reached blocked curl request');
  const configPath = argvFor(call)[4];
  process.kill(-child.pid, 'SIGTERM');
  await new Promise((resolve) => child.once('close', resolve));
  assert(!fs.existsSync(configPath), 'signal left curl config behind');
  assert(!fs.existsSync(path.dirname(configPath)), 'signal left temp directory behind');
  assert(!Buffer.concat(output).includes(Buffer.from(secret)), 'signal stdout leaked password');
  assert(!Buffer.concat(errors).includes(Buffer.from(secret)), 'signal stderr leaked password');
  assertSecretAbsent(harness, { stdout: Buffer.concat(output).toString(), stderr: Buffer.concat(errors).toString() });

  const first = createHarness('concurrent-a');
  const second = createHarness('concurrent-b');
  networkResponses(first, [{ body: offline() }]);
  networkResponses(second, [{ body: offline() }]);
  const [one, two] = await Promise.all([first, second].map((item) => new Promise((resolve, reject) => {
    const processChild = spawn(script, ['status', '--mwan3', 'wan-test'], { env: item.env, stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout = [];
    const stderr = [];
    processChild.stdout.on('data', (chunk) => stdout.push(chunk));
    processChild.stderr.on('data', (chunk) => stderr.push(chunk));
    processChild.on('error', reject);
    processChild.on('close', (status) => resolve({ status, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString() }));
  })));
  envelope(one, 1, 'status', 'offline', null);
  envelope(two, 1, 'status', 'offline', null);
  const firstPath = argvFor(callDirectories(first, 'mwan3')[0])[4];
  const secondPath = argvFor(callDirectories(second, 'mwan3')[0])[4];
  assert(firstPath !== secondPath, 'concurrent requests reused a curl config path');
  assert(!fs.existsSync(firstPath) && !fs.existsSync(secondPath), 'concurrent request cleanup failed');
  pass('signals clean secrets and concurrent actions isolate temporary state');
}

try {
  if (!fs.existsSync(script))
    fail(`unified portal script is missing: ${script}`);
  syntaxAndMetadataTests();
  statusTests();
  loginTests();
  logoutTests();
  identityTests();
  await signalAndConcurrencyTests();
  process.stdout.write(`\n${checks} portal black-box checks passed.\n`);
} catch (error) {
  process.stderr.write(`portal test failure: ${error.stack ?? error.message}\n`);
  process.exitCode = 1;
}

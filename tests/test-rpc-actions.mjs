#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const tests = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(tests, '..');
const sourcePath = path.join(repo, 'root/usr/libexec/rpcd/multilogin');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'multilogin-rpc.'));
let checks = 0;
process.on('exit', () => fs.rmSync(root, { recursive: true, force: true }));
const write = (file, body, mode = 0o700) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, body, { mode }); fs.chmodSync(file, mode); };
const assert = (ok, message) => { if (!ok) throw new Error(message); };
const pass = (name) => { checks += 1; process.stdout.write(`PASS  rpc-actions: ${name}\n`); };
function jsonfilter(bin) { write(path.join(bin, 'jsonfilter'), `#!/bin/sh
expr=; while [ "$#" -gt 0 ]; do case "$1" in -e) expr=$2; shift 2;; *) shift;; esac; done
input=$(cat); JSONFILTER_INPUT=$input node - "$expr" <<'NODE'
let v; try { const o=JSON.parse(process.env.JSONFILTER_INPUT||''); const m=process.argv[2].match(/([A-Za-z_][A-Za-z0-9_]*)[\"']?\]?$/); v=m?o[m[1]]:undefined; } catch (_) {} if(v==null) process.stdout.write(''); else if(typeof v==='boolean') process.stdout.write(v?'true':'false'); else if(typeof v==='object') process.stdout.write(JSON.stringify(v)); else process.stdout.write(String(v));
NODE
`); }
function jshnStub(file) { write(file, `json_init(){ JSHN_JSON=; }
json_load(){ JSHN_INPUT=$1; node -e 'JSON.parse(process.argv[1])' "$1" >/dev/null 2>&1; }
json_get_keys(){ value=$(node -e 'process.stdout.write(Object.keys(JSON.parse(process.argv[1])).join(" "))' "$JSHN_INPUT") || return 1; export "$1=$value"; }
json_get_type(){ value=$(node -e 'const v=JSON.parse(process.argv[1])[process.argv[2]]; process.stdout.write(v===null?"null":Array.isArray(v)?"array":typeof v)' "$JSHN_INPUT" "$2") || return 1; [ "$value" != undefined ] || return 1; export "$1=$value"; }
json_get_var(){ value=$(node -e 'const v=JSON.parse(process.argv[1])[process.argv[2]]; if(v===undefined||v===null) process.exit(1); process.stdout.write(String(v))' "$JSHN_INPUT" "$2") || return 1; export "$1=$value"; }
json_add_string(){ k=$1; v=$2; v=$(printf '%s' "$v" | sed 's/[\\\\]/\\\\\\\\/g; s/[\"]/\\\\\"/g; s/$(printf "\\n")/\\\\n/g'); [ -n "$JSHN_JSON" ] && JSHN_JSON="$JSHN_JSON,"; JSHN_JSON="$JSHN_JSON\\\"$k\\\":\\\"$v\\\""; }
json_add_int(){ [ -n "$JSHN_JSON" ] && JSHN_JSON="$JSHN_JSON,"; JSHN_JSON="$JSHN_JSON\\\"$1\\\":$2"; }
json_add_boolean(){ [ -n "$JSHN_JSON" ] && JSHN_JSON="$JSHN_JSON,"; if [ "$2" = 1 ]; then b=true; else b=false; fi; JSHN_JSON="$JSHN_JSON\\\"$1\\\":$b"; }
json_dump(){ printf '{%s}\\n' "$JSHN_JSON"; }
`); }

function harness(name, options = {}) {
  const dir = fs.mkdtempSync(path.join(root, `${name}.`)); const bin = path.join(dir, 'bin'); const state = path.join(dir, 'state'); fs.mkdirSync(bin); fs.mkdirSync(state);
  const secret = options.secret ?? 'phase3-rpc-secret';
  write(path.join(bin, 'uci'), `#!/bin/sh
key="$*"; printf '%s\\n' "$key" >> '${state}/uci.calls'; case "$key" in
  *"get multilogin.i1") echo instance ;; *"get multilogin.i1.alias") echo Demo ;; *"get multilogin.i1.interface") echo wan1 ;; *"get multilogin.i1.v6face") echo '' ;; *"get multilogin.i1.ua_type") echo pc ;; *"get multilogin.i1.account") echo a1 ;; *"get multilogin.a1.username") echo user1 ;; *"get multilogin.a1.password") printf '%s\\n' "$MULTILOGIN_TEST_PASSWORD" ;; *) exit 1 ;; esac
`); jsonfilter(bin); write(path.join(bin, 'jshn'), `#!/bin/sh
[ "$1" = -r ] && [ "$#" -eq 2 ] || exit 1
node -e 'JSON.parse(process.argv[1])' "$2" >/dev/null 2>&1
`);
  const jshn = path.join(dir, 'jshn.sh'); jshnStub(jshn);
  let source = fs.readFileSync(sourcePath, 'utf8'); const marker = '. /usr/share/libubox/jshn.sh'; assert(source.split(marker).length === 2, 'rpc source jshn line changed unexpectedly'); const runnable = path.join(dir, 'multilogin'); fs.writeFileSync(runnable, source.replace(marker, `. ${jshn}`), { mode: 0o700 }); fs.chmodSync(runnable, 0o700);
  write(path.join(bin, 'logger'), `#!/bin/sh
printf '%s\n' "$*" >> '${state}/logger.log'
`);
  const payload = options.payload ?? { action: options.action ?? 'login', ok: options.ok ?? (options.errorKind == null), outcome: options.outcome ?? 'login_success', error_kind: options.errorKind ?? null, api: options.api ?? 3, version: options.version ?? '3.0.0-rc.1', data: {} };
  const payloadText = options.rawPayload ?? JSON.stringify(payload);
  const portal = path.join(dir, 'portal.sh'); write(portal, `#!/bin/sh
set -eu
printf '%s\\n' "$@" > '${state}/argv'; stdin_meta='${state}/stdin'; n=$(cat | tee /dev/null | wc -c); printf '%s\\n' "$n" >"$stdin_meta"
printf '%s\\n' '${payloadText.replaceAll("'", "'\\''")}'
exit ${options.code ?? 0}
`);
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, TMPDIR: dir, MULTILOGIN_TEST_MODE: options.testMode === false ? '0' : '1', MULTILOGIN_TEST_PORTAL_PATH: portal, MULTILOGIN_TEST_PASSWORD: secret };
  return { dir, bin, state, runnable, portal, env, secret, payload };
}
function run(h, method, input = { section: 'i1', ubus_rpc_session: '0123456789abcdef' }) { const r = spawnSync('sh', [h.runnable, 'call', method], { input: JSON.stringify(input), env: h.env, cwd: repo, encoding: 'utf8', timeout: 3000 }); return { ...r, json: (() => { try { return JSON.parse(r.stdout.split(/\r?\n/).find((x) => x.trim())); } catch (_) { return null; } })() }; }
function tempDirs(h) { return fs.readdirSync(h.dir).filter((x) => x.startsWith('multilogin-rpc.')); }

for (const [method, action, code, outcome, expectedStatus] of [['check_instance', 'status', 0, 'online', '已登录'], ['test_instance', 'login', 0, 'login_success', '登录成功'], ['logout_instance', 'logout', 0, 'logout_success', '注销成功']]) {
  const h = harness(method, { action, code, outcome }); const r = run(h, method); assert(r.status === 0 && r.json, `${method} did not return JSON: status=${r.status} stdout=${r.stdout} stderr=${r.stderr}`); assert(r.json.action === method.replace('_instance', '').replace('test', 'test'), 'cached action mismatch'); assert(r.json.legacy_code === code && r.json.status === expectedStatus && r.json.success === true, `${method} cached fields mismatch: ${JSON.stringify(r.json)}`); assert(r.json.output === outcome && !r.json.output.includes('portal'), 'output was not sanitized'); assert(tempDirs(h).length === 0, `${method} temp survived`); pass(`accepts rpcd session metadata, executes child action=${action}, and returns status/outcome/exit`);
  const stdinBytes = Number(fs.readFileSync(path.join(h.state, 'stdin'), 'utf8')); if (method === 'test_instance') assert(stdinBytes === h.secret.length + 1, 'login password was not stdin-only'); else { assert(stdinBytes === 0, `${method} read a password`); assert(!fs.readFileSync(path.join(h.state, 'uci.calls'), 'utf8').includes('.password'), `${method} read the UCI password`); } assert(!fs.readFileSync(path.join(h.state, 'argv'), 'utf8').includes(h.secret), `${method} leaked password in argv`);
  const diagnostic = fs.readFileSync(path.join(h.state, 'logger.log'), 'utf8'); assert(diagnostic.includes(`source=manual action=${action} outcome=${outcome} exit=${code}`), `${method} did not record its structured script return`); assert(!diagnostic.includes(h.secret), `${method} leaked password to diagnostics`);
}
pass('login password is stdin-only; check/logout do not read or pass one');

{
  const h = harness('sessionless-direct', { action: 'status', code: 1, outcome: 'offline', ok: true });
  const r = run(h, 'check_instance', { section: 'i1' });
  assert(r.status === 0 && r.json?.success === true && r.json?.legacy_code === 1 && r.json?.outcome === 'offline', 'session-less direct action call regressed');
  assert(fs.existsSync(path.join(h.state, 'argv')), 'session-less direct action did not reach the child');
  pass('preserves session-less direct ubus action calls');
}

for (const [name, method, options, expected] of [
  ['offline', 'check_instance', { action: 'status', code: 1, outcome: 'offline', ok: true }, ['ok', 1, '未登录']],
  ['already-online', 'test_instance', { action: 'login', code: 2, outcome: 'already_online', ok: true }, ['ok', 2, '已登录']],
  ['already-offline', 'logout_instance', { action: 'logout', code: 0, outcome: 'already_offline', ok: true }, ['ok', 0, '注销成功']],
  ['auth-rejected', 'test_instance', { action: 'login', code: 1, outcome: 'auth_rejected', errorKind: 'auth' }, ['auth_rejected', 1, '登录失败']],
  ['logout-timeout', 'logout_instance', { action: 'logout', code: 9, outcome: 'logout_timeout', errorKind: 'timeout' }, ['logout_timeout', 9, '脚本错误']],
  ['transport', 'check_instance', { action: 'status', code: 3, outcome: 'transport_error', errorKind: 'transport' }, ['transport_error', 3, '状态检查失败']],
  ['protocol', 'logout_instance', { action: 'logout', code: 3, outcome: 'protocol_error', errorKind: 'protocol' }, ['protocol_error', 3, '脚本错误']],
]) {
  const h = harness(`outcome-${name}`, options);
  const r = run(h, method);
  assert(r.status === 0 && r.json?.code === expected[0] && r.json?.legacy_code === expected[1] && r.json?.status === expected[2] && r.json?.outcome === options.outcome, `${name} action return mismatch: ${JSON.stringify(r.json)}`);
  const diagnostic = fs.readFileSync(path.join(h.state, 'logger.log'), 'utf8');
  assert(diagnostic.includes(`outcome=${options.outcome} exit=${options.code}`), `${name} diagnostic missing`);
  pass(`returns and logs ${name} classification`);
}

for (const [name, input] of [
  ['empty-session', { section: 'i1', ubus_rpc_session: '' }],
  ['wrong-session-type', { section: 'i1', ubus_rpc_session: 7 }],
  ['unknown-field', { section: 'i1', ubus_rpc_session: 'session', unexpected: 'x' }],
]) {
  const h = harness(name, { action: 'login', code: 0, outcome: 'login_success' });
  const r = run(h, 'test_instance', input);
  assert(r.status === 1 && r.json?.code === 'invalid_request', `${name} metadata was accepted`);
  assert(!fs.existsSync(path.join(h.state, 'argv')), `${name} reached the portal child`);
  assert(!fs.existsSync(path.join(h.state, 'logger.log')), `${name} logged an action that never reached the child`);
  pass(`rejects ${name} before child execution`);
}

const invalid = [
  ['action_mismatch', { action: 'status', code: 0, outcome: 'login_success' }],
  ['malformed_json', { rawPayload: '{not-json}', code: 0 }],
  ['outcome_mismatch', { action: 'login', code: 0, outcome: 'auth_rejected', errorKind: null }],
  ['error_kind_mismatch', { action: 'login', code: 1, outcome: 'auth_rejected', errorKind: 'transport' }],
  ['api_mismatch', { action: 'login', code: 0, outcome: 'login_success', api: 2 }],
  ['exit_mismatch', { action: 'login', code: 1, outcome: 'login_success', errorKind: null }],
];
for (const [name, options] of invalid) { const h = harness(name, options); const r = run(h, 'test_instance'); assert(r.status === 0 && r.json && r.json.code === 'internal_error' && r.json.legacy_code === 3 && r.json.outcome === 'internal_error' && r.json.success === false, `${name} accepted invalid envelope: status=${r.status} error=${r.error} stdout=${r.stdout} stderr=${r.stderr}`); assert(tempDirs(h).length === 0, `${name} leaked temp`); pass(`rejects malformed/mismatched ${name} envelope as code3/internal_error`); }

{ const h = harness('production-override', { testMode: false, action: 'status', code: 0, outcome: 'online' }); const marker = path.join(h.state, 'override-used'); write(h.portal, `#!/bin/sh\nprintf used > '${marker}'\nexit 0\n`); const r = run(h, 'check_instance'); assert(r.status === 0 && r.json?.code === 'internal_error' && r.json?.legacy_code === 3 && !fs.existsSync(marker), 'production accepted portal override'); pass('production mode ignores un-gated portal override'); }

{ const h = harness('signal', { action: 'login', code: 0, outcome: 'login_success' }); write(h.portal, '#!/bin/sh\nwhile :; do sleep 1; done\n'); const child = spawn('sh', [h.runnable, 'call', 'test_instance'], { input: JSON.stringify({ section: 'i1', ubus_rpc_session: 'signal-session' }), env: h.env, cwd: repo, stdio: ['pipe', 'pipe', 'pipe'] }); child.stdin.end(); await new Promise((resolve) => { setTimeout(() => child.kill('SIGTERM'), 80); child.on('close', resolve); }); assert(tempDirs(h).length === 0, 'signal left rpc temp'); pass('signal cleanup removes RPC temp state after a session-bearing request starts the child'); }

{ const h = harness('secret-scan', { action: 'login', code: 1, outcome: 'auth_rejected', errorKind: 'auth' }); const r = run(h, 'test_instance'); const output = `${r.stdout}${r.stderr}`; assert(!output.includes(h.secret) && !fs.readFileSync(path.join(h.state, 'argv'), 'utf8').includes(h.secret), 'secret leaked to RPC output/argv'); assert(Number(fs.readFileSync(path.join(h.state, 'stdin'), 'utf8')) === h.secret.length + 1, 'secret did not arrive on stdin'); pass('RPC stdout/stderr/argv/temp are secret-free'); }

process.stdout.write(`${checks} rpc action checks passed.\n`);

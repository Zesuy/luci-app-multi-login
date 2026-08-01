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
`); jsonfilter(bin);
  const jshn = path.join(dir, 'jshn.sh'); jshnStub(jshn);
  let source = fs.readFileSync(sourcePath, 'utf8'); const marker = '. /usr/share/libubox/jshn.sh'; assert(source.split(marker).length === 2, 'rpc source jshn line changed unexpectedly'); const runnable = path.join(dir, 'multilogin'); fs.writeFileSync(runnable, source.replace(marker, `. ${jshn}`), { mode: 0o700 }); fs.chmodSync(runnable, 0o700);
  const payload = options.payload ?? { action: options.action ?? 'login', ok: options.code === 1 || options.code === 3 ? false : true, outcome: options.outcome ?? 'login_success', error_kind: options.errorKind ?? null, api: options.api ?? 3, version: options.version ?? '3.0.0-rc.1', data: {} };
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
function run(h, method, input = { section: 'i1' }) { const r = spawnSync('sh', [h.runnable, 'call', method], { input: JSON.stringify(input), env: h.env, cwd: repo, encoding: 'utf8', timeout: 3000 }); return { ...r, json: (() => { try { return JSON.parse(r.stdout.split(/\r?\n/).find((x) => x.trim())); } catch (_) { return null; } })() }; }
function tempDirs(h) { return fs.readdirSync(h.dir).filter((x) => x.startsWith('multilogin-rpc.')); }

for (const [method, action, code, outcome, expectedStatus] of [['check_instance', 'status', 0, 'online', '已登录'], ['test_instance', 'login', 0, 'login_success', '登录成功'], ['logout_instance', 'logout', 0, 'logout_success', '注销成功']]) {
  const h = harness(method, { action, code, outcome }); const r = run(h, method); assert(r.status === 0 && r.json, `${method} did not return JSON`); assert(r.json.action === method.replace('_instance', '').replace('test', 'test'), 'cached action mismatch'); assert(r.json.code === code && r.json.status === expectedStatus && r.json.success === true, `${method} cached fields mismatch`); assert(r.json.output === outcome && !r.json.output.includes('portal'), 'output was not sanitized'); assert(tempDirs(h).length === 0, `${method} temp survived`); pass(`executes child action=${action} and caches code/status/success/output`);
  const stdinBytes = Number(fs.readFileSync(path.join(h.state, 'stdin'), 'utf8')); if (method === 'test_instance') assert(stdinBytes === h.secret.length + 1, 'login password was not stdin-only'); else { assert(stdinBytes === 0, `${method} read a password`); assert(!fs.readFileSync(path.join(h.state, 'uci.calls'), 'utf8').includes('.password'), `${method} read the UCI password`); } assert(!fs.readFileSync(path.join(h.state, 'argv'), 'utf8').includes(h.secret), `${method} leaked password in argv`);
}
pass('login password is stdin-only; check/logout do not read or pass one');

const invalid = [
  ['action_mismatch', { action: 'status', code: 0, outcome: 'login_success' }],
  ['malformed_json', { rawPayload: '{not-json}', code: 0 }],
  ['outcome_mismatch', { action: 'login', code: 0, outcome: 'auth_rejected', errorKind: null }],
  ['error_kind_mismatch', { action: 'login', code: 1, outcome: 'auth_rejected', errorKind: 'transport' }],
  ['api_mismatch', { action: 'login', code: 0, outcome: 'login_success', api: 2 }],
  ['exit_mismatch', { action: 'login', code: 1, outcome: 'login_success', errorKind: null }],
];
for (const [name, options] of invalid) { const h = harness(name, options); const r = run(h, 'test_instance'); assert(r.status === 0 && r.json && r.json.code === 3 && r.json.outcome === 'internal_error' && r.json.success === false, `${name} accepted invalid envelope: status=${r.status} error=${r.error} stdout=${r.stdout} stderr=${r.stderr}`); assert(tempDirs(h).length === 0, `${name} leaked temp`); pass(`rejects malformed/mismatched ${name} envelope as code3/internal_error`); }

{ const h = harness('production-override', { testMode: false, action: 'status', code: 0, outcome: 'online' }); const marker = path.join(h.state, 'override-used'); write(h.portal, `#!/bin/sh\nprintf used > '${marker}'\nexit 0\n`); const r = run(h, 'check_instance'); assert(r.status === 0 && r.json?.code === 3 && !fs.existsSync(marker), 'production accepted portal override'); pass('production mode ignores un-gated portal override'); }

{ const h = harness('signal', { action: 'login', code: 0, outcome: 'login_success' }); write(h.portal, '#!/bin/sh\nwhile :; do sleep 1; done\n'); const child = spawn('sh', [h.runnable, 'call', 'test_instance'], { input: JSON.stringify({ section: 'i1' }), env: h.env, cwd: repo, stdio: ['pipe', 'pipe', 'pipe'] }); child.stdin.end(); await new Promise((resolve) => { setTimeout(() => child.kill('SIGTERM'), 80); child.on('close', resolve); }); assert(tempDirs(h).length === 0, 'signal left rpc temp'); pass('signal cleanup removes RPC temp state'); }

{ const h = harness('secret-scan', { action: 'login', code: 1, outcome: 'auth_rejected', errorKind: 'auth' }); const r = run(h, 'test_instance'); const output = `${r.stdout}${r.stderr}`; assert(!output.includes(h.secret) && !fs.readFileSync(path.join(h.state, 'argv'), 'utf8').includes(h.secret), 'secret leaked to RPC output/argv'); assert(Number(fs.readFileSync(path.join(h.state, 'stdin'), 'utf8')) === h.secret.length + 1, 'secret did not arrive on stdin'); pass('RPC stdout/stderr/argv/temp are secret-free'); }

process.stdout.write(`${checks} rpc action checks passed.\n`);

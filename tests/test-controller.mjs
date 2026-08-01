#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const tests = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(tests, '..');
const controller = path.join(repo, 'etc/multilogin/login_control.bash');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'multilogin-controller.'));
let checks = 0;
process.on('exit', () => fs.rmSync(root, { recursive: true, force: true }));
const write = (file, body, mode = 0o700) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, body, { mode }); fs.chmodSync(file, mode); };
const assert = (ok, message) => { if (!ok) throw new Error(message); };
const pass = (name) => { checks += 1; process.stdout.write(`PASS  controller: ${name}\n`); };
function files(dir) { if (!fs.existsSync(dir)) return []; return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => { const p = path.join(dir, e.name); return e.isDirectory() ? files(p) : [p]; }); }

function harness(name, options = {}) {
  const dir = fs.mkdtempSync(path.join(root, `${name}.`)); const bin = path.join(dir, 'bin'); const state = path.join(dir, 'state'); fs.mkdirSync(bin); fs.mkdirSync(state);
  const instances = options.instances ?? [{ section: 'i1', iface: 'wan1', account: 'a1', username: 'user1', ua: 'pc' }]; const secret = options.password ?? 'phase3-controller-secret';
  const uci = ['#!/bin/sh', 'key="$*"', 'case "$key" in', '  *"get multilogin.global") echo settings ;;', `  *"get multilogin.global.enabled") echo ${options.disabled ? 0 : 1} ;;`, `  *"get multilogin.global.retry_interval") echo ${options.retry ?? 4} ;;`, `  *"get multilogin.global.check_interval") echo ${options.check ?? 1} ;;`, `  *"get multilogin.global.max_retry_delay") echo ${options.max ?? 16384} ;;`, `  *"get multilogin.global.already_logged_delay") echo ${options.alreadyDelay ?? 16} ;;`, '  *"get multilogin.global.log_level") echo debug ;;'];
  uci.push(`  *"show multilogin") ${options.noInstances ? ':' : `printf '%s\\n' ${instances.map((x) => `multilogin.${x.section}=instance`).join(' ')}`} ;;`);
  for (const x of instances) { uci.push(`  *"get multilogin.${x.section}.enabled") echo ${x.enabled === false ? 0 : 1} ;;`, `  *"get multilogin.${x.section}.interface") echo ${x.iface} ;;`, `  *"get multilogin.${x.section}.v6face") echo ${x.v6face ?? ''} ;;`, `  *"get multilogin.${x.section}.ua_type") echo ${x.ua ?? 'pc'} ;;`, `  *"get multilogin.${x.section}.account") echo ${x.account ?? 'a1'} ;;`, `  *"get multilogin.${x.account ?? 'a1'}.username") printf '%s\\n' '${x.username ?? 'user1'}' ;;`, `  *"get multilogin.${x.account ?? 'a1'}.password") printf '%s\\n' "$MULTILOGIN_TEST_PASSWORD" ;;`); }
  uci.push('  *) exit 1 ;;', 'esac', ''); write(path.join(bin, 'uci'), uci.join('\n'));
write(path.join(bin, 'jsonfilter'), `#!/bin/sh
expr=
while [ "$#" -gt 0 ]; do case "$1" in -e) expr=$2; shift 2;; *) shift;; esac; done
input=$(cat); JSONFILTER_INPUT=$input node - "$expr" <<'NODE'
let v; try { const o=JSON.parse(process.env.JSONFILTER_INPUT||''); const m=process.argv[2].match(/([A-Za-z_][A-Za-z0-9_]*)[\"']?\]?$/); v=m?o[m[1]]:undefined; } catch (_) {} if(v==null) process.stdout.write(''); else if(typeof v==='boolean') process.stdout.write(v?'1':'0'); else if(typeof v==='object') process.stdout.write(JSON.stringify(v)); else process.stdout.write(String(v));
NODE
`);
  const status = instances.map((x) => `interface ${x.iface} is ${x.online ? 'online' : 'offline'}`).join('\\n');
  if (!options.noMwan3) {
    const statusSequence = options.statusSequence ?? [status]; write(path.join(state, 'mwan.seq'), statusSequence.join('\n') + '\n', 0o600);
    write(path.join(bin, 'mwan3'), `#!/bin/sh\ncase "$1" in interfaces) f='${state}/mwan.count'; n=0; [ -f "$f" ] && n=$(cat "$f"); n=$((n+1)); printf '%s\\n' "$n" >"$f"; row=$(sed -n "$n"p '${state}/mwan.seq') || row=; [ -n "$row" ] || row=$(tail -n 1 '${state}/mwan.seq'); printf '%b\\n' "$row" ;; *) exit 1 ;; esac\n`);
  }
  write(path.join(bin, 'sleep'), options.realSleep ? '#!/bin/sh\nexec /bin/sleep 0.02\n' : '#!/bin/sh\nexit 0\n'); write(path.join(bin, 'date'), '#!/bin/sh\necho 1700000000\n'); write(path.join(bin, 'logger'), `#!/bin/sh\nmkdir -p '${state}'\nprintf '%s\\n' "$*" >> '${state}/logger.log'\n`);
  const seq = options.sequences ?? {}; for (const x of instances) { const rows = seq[x.iface] ?? options.sequence ?? [{ code: options.code ?? 0, outcome: options.outcome ?? 'login_success', errorKind: options.errorKind ?? '' }]; write(path.join(state, `seq.${x.iface}`), rows.map((r) => `${r.code ?? 0}|${r.outcome ?? 'login_success'}|${r.errorKind ?? ''}|${r.raw ?? ''}`).join('\n') + '\n', 0o600); }
  const portal = path.join(dir, 'portal.sh'); write(portal, `#!/bin/sh
set -eu
iface=; while [ "$#" -gt 0 ]; do case "$1" in --mwan3) iface=$2; shift 2;; *) shift;; esac; done
mkdir -p '${state}'; printf '%s\\n' "$@" >> '${state}/portal.argv'; stdin_meta='${state}/stdin.'"$iface"; stdin_bytes=$(cat | tee /dev/null | wc -c); printf '%s\\n' "$stdin_bytes" >"$stdin_meta"
cf='${state}/count.'"$iface"; n=0; [ -f "$cf" ] && n=$(cat "$cf"); n=$((n+1)); printf '%s\\n' "$n" >"$cf"
row=$(sed -n "$n"p '${state}/seq.'"$iface") || row=; [ -n "$row" ] || row=$(tail -n 1 '${state}/seq.'"$iface"); IFS='|' read -r code outcome error raw <<EOF
$row
EOF
if [ -n "$raw" ]; then printf '%s\\n' "$raw" | tee '${state}/portal.output'; else ok=true; if [ "$code" = 1 ] || [ "$code" = 3 ]; then ok=false; fi; e=null; [ -n "$error" ] && e="\\\"$error\\\"" || :; printf '{"action":"login","ok":%s,"outcome":"%s","error_kind":%s,"api":3,"version":"3.0.0-rc.1","data":{}}\\n' "$ok" "$outcome" "$e" | tee '${state}/portal.output'; fi
exit "\${code:-3}"
`);
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, TMPDIR: dir, MULTILOGIN_TEST_MODE: options.production ? '0' : '1', MULTILOGIN_TEST_MAX_LOOPS: String(options.loops ?? 1), MULTILOGIN_TEST_PORTAL_PATH: portal, MULTILOGIN_TEST_NOW: '1700000000', MULTILOGIN_TEST_JITTER: String(options.jitter ?? 0), MULTILOGIN_TEST_PASSWORD: secret };
  return { dir, state, env, secret, portal, instances };
}
function run(h, timeout = 3000) { return spawnSync('bash', [controller], { env: h.env, cwd: repo, encoding: 'utf8', timeout }); }
function log(h) { const f = path.join(h.state, 'logger.log'); return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : ''; }
function calls(h, iface = h.instances[0].iface) { const f = path.join(h.state, `count.${iface}`); return fs.existsSync(f) ? Number(fs.readFileSync(f, 'utf8')) : 0; }
function scan(h) { for (const f of files(h.dir)) assert(!fs.readFileSync(f).includes(Buffer.from(h.secret)), `secret leaked into ${f}`); }
async function signalRun(h) { return await new Promise((resolve, reject) => { const c = spawn('bash', [controller], { env: h.env, cwd: repo, stdio: ['ignore', 'pipe', 'pipe'] }); let out=''; let err=''; c.stdout.on('data',x=>out+=x); c.stderr.on('data',x=>err+=x); const t=setTimeout(()=>c.kill('SIGTERM'),60); c.on('error',reject); c.on('close',(status,signal)=>{clearTimeout(t); resolve({status,signal,out,err});}); }); }

{ const h=harness('backoff',{loops:60,sequence:[{code:1,outcome:'auth_rejected',errorKind:'auth'}]}); const r=run(h); assert(r.status===0,`backoff exit ${r.status}`); assert(calls(h)===4,`expected due calls, got ${calls(h)}`); for(const n of [8,16,32]) assert(log(h).includes(`next base=${n}s`),`missing base ${n}`); pass('failure base sequence is 8/16/32 with no early attempts'); }
{ const h=harness('jitter-upper',{retry:8,max:16,jitter:99,sequence:[{code:3,outcome:'transport_error',errorKind:'transport'}]}); run(h); assert(log(h).includes('next base=16s scheduled=17s'),'positive jitter was not clamped after capping base'); pass('max retry cap precedes clamped +10% jitter'); }
{ const h=harness('jitter-lower',{retry:8,max:16,jitter:-99,sequence:[{code:3,outcome:'transport_error',errorKind:'transport'}]}); run(h); assert(log(h).includes('next base=16s scheduled=15s'),'negative jitter was not clamped after capping base'); pass('max retry cap precedes clamped -10% jitter'); }
{ const h=harness('already',{loops:20,sequence:[{code:2,outcome:'already_online'}]}); run(h); assert(calls(h)===2,'already-online retried early'); assert(log(h).includes('next base=16s'),'already-online delay missing'); pass('already-online timing'); }
for(const [n,c,o,e] of [['auth',1,'auth_rejected','auth'],['transport',3,'transport_error','transport'],['protocol',3,'protocol_error','protocol']]) { const h=harness(n,{sequence:[{code:c,outcome:o,errorKind:e}]}); run(h); assert(log(h).includes(`class=${e} outcome=${o}`),`${n} classification missing: ${log(h)}`); pass(`distinct ${n} result`); }
{ const h=harness('reset',{loops:14,sequence:[{code:1,outcome:'auth_rejected',errorKind:'auth'},{code:0,outcome:'login_success'},{code:1,outcome:'auth_rejected',errorKind:'auth'}]}); run(h); assert(calls(h)===3,'success reset timing failed'); assert(log(h).includes('login succeeded; next base=4s'),'success reset missing'); pass('successful login reset and later retry'); }
{ const h=harness('multi',{loops:10,instances:[{section:'i1',iface:'wan1',account:'a1',username:'u1'},{section:'i2',iface:'wan2',account:'a2',username:'u2'}],sequences:{wan1:[{code:1,outcome:'auth_rejected',errorKind:'auth'}],wan2:[{code:0,outcome:'login_success'},{code:0,outcome:'login_success'}]}}); run(h); assert(calls(h,'wan1')===2&&calls(h,'wan2')===3,'instance state contaminated'); pass('two-instance state independence'); }
{ const h=harness('online',{loops:1,instances:[{section:'i1',iface:'wan1',account:'a1',username:'u1',online:true}]}); const r=run(h); assert(r.status===0&&calls(h)===0,'online interface attempted login'); pass('interface-online recovery'); }
{ const h=harness('later-online',{loops:6,statusSequence:['interface wan1 is offline','interface wan1 is online','interface wan1 is offline'],sequence:[{code:1,outcome:'auth_rejected',errorKind:'auth'}]}); run(h); const l=log(h); assert(calls(h)===2,`reset retry was not due at initial timing: ${calls(h)}`); assert((l.match(/next base=8s/g)??[]).length===2&&!l.includes('next base=16s'),'post-recovery failure retained exponential state'); assert(l.includes('resetting its retry base'),'online recovery reset was not observed'); pass('failure then online recovery resets timing before later offline retry'); }
for(const [n,o] of [['disabled',{disabled:true}],['no-instances',{noInstances:true}],['mwan3-unavailable',{noMwan3:true}]]) { const h=harness(n,o); const r=run(h); assert(r.status===0&&calls(h)===0,`${n} did work`); pass(`${n} safe idle`); }
{ const h=harness('malformed',{sequence:[{code:0,outcome:'login_success',raw:'{not-json}'}]}); run(h); assert(log(h).includes('next base=8s'),'malformed envelope accepted'); pass('malformed envelope rejected'); }
{ const h=harness('signal',{realSleep:true,loops:0}); const r=await signalRun(h); assert(r.status===0||r.signal==='SIGTERM','signal did not terminate'); assert(!fs.readdirSync(h.dir).some(f=>f.startsWith('multilogin-controller.')),'temp survived signal'); pass('signal cleanup'); }
{ const h=harness('secret',{sequence:[{code:1,outcome:'auth_rejected',errorKind:'auth'}]}); const r=run(h); scan(h); assert(fs.readFileSync(path.join(h.state,'stdin.wan1'),'utf8').trim()===String(h.secret.length+1),'password was not piped via stdin'); assert(!r.stdout.includes(h.secret)&&!r.stderr.includes(h.secret)&&!log(h).includes(h.secret),'secret leaked in output'); pass('secret absent from stdout/stderr/logger/temp/argv and arrives only on stdin'); }
{ const h=harness('production',{production:true,realSleep:true}); const marker=path.join(h.state,'override-used'); write(h.portal,`#!/bin/sh\nprintf used > '${marker}'\nexit 0\n`); const r=await signalRun(h); assert(!fs.existsSync(marker),'production accepted override'); assert(!fs.readdirSync(h.dir).some(f=>f.startsWith('multilogin-controller.')),'production signal left temp'); pass('production rejects un-gated override'); }
process.stdout.write(`${checks} controller checks passed.\n`);

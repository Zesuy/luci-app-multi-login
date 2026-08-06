#!/usr/bin/env node
/* Phase 7 contract/static/pure-policy checks.  No rpcd, UCI, service, network,
 * browser, DOM, filesystem-state or OpenWrt emulation is performed here. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(testDir, '..');
const rpcPath = path.join(repository, 'root/usr/libexec/rpcd/multilogin');
const configPath = path.join(repository, 'root/usr/libexec/multilogin-config');
const policyPath = path.join(repository, 'root/usr/lib/multilogin/config-policy.sh');
const aclPath = path.join(repository, 'root/usr/share/rpcd/acl.d/luci-app-multi-login.json');
const menuPath = path.join(repository, 'root/usr/share/luci/menu.d/luci-app-multi-login.json');
const viewDirectory = path.join(repository, 'htdocs/luci-static/resources/view/multilogin');
const docs = ['README.md', 'PROJECT_OVERVIEW.md'];
const read = (file) => fs.readFileSync(file, 'utf8');
const rpc = read(rpcPath);
const config = fs.existsSync(configPath) ? read(configPath) : '';
const backend = `${rpc}\n${config}`;
let checks = 0;
const pass = (label) => { checks += 1; process.stdout.write(`PASS  phase7-logic: ${label}\n`); };

function shellFunctionBody(source, name) {
  const marker = `${name}()`;
  const start = source.indexOf(marker);
  assert.ok(start >= 0, `${name} function is absent`);
  const brace = source.indexOf('{', start);
  assert.ok(brace >= 0, `${name} function has no body`);
  let depth = 0;
  for (let index = brace; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(brace + 1, index);
  }
  assert.fail(`${name} function is unbalanced`);
}

const methods = Object.freeze({
  get_overview: [],
  get_settings: [],
  save_settings: ['already_logged_delay', 'check_interval', 'enabled', 'log_level', 'max_retry_delay', 'retry_interval'],
  list_accounts: [],
  save_account: ['alias', 'password', 'section', 'username'],
  delete_account: ['section'],
  list_instances: [],
  save_instance: ['account', 'alias', 'enabled', 'interface', 'section', 'ua_type', 'v6face'],
  delete_instance: ['section'],
  service_status: [],
  service_action: ['action'],
  get_diagnostics: [],
  get_logs: [],
  clear_logs: [],
  quick_setup: ['base_iface', 'count'],
  list_auto: [],
  remove_auto: [],
  network_recover: [],
});

function advertisedMethods() {
  const match = rpc.match(/\nlist\)\n\s*printf '([^']+)'/);
  assert.ok(match, 'rpcd list response is not statically extractable');
  const json = match[1].replace(/\\n/g, '');
  return JSON.parse(json);
}

function rpcSurfaceTests() {
  const advertised = advertisedMethods();
  const phase7 = Object.fromEntries(Object.keys(advertised)
    .filter((name) => Object.hasOwn(methods, name))
    .map((name) => [name, advertised[name]]));
  assert.deepEqual(Object.keys(phase7).sort(), Object.keys(methods).sort(), 'exact Phase 7 RPC family');
  for (const [method, params] of Object.entries(methods)) {
    assert.deepEqual(Object.keys(advertised[method]).sort(), params.slice().sort(), `${method} exact parameter names`);
    assert.equal(JSON.stringify(advertised[method]).match(/(?:url|path|uci|command|object|init)/i), null,
      `${method} accepts an arbitrary path/URL/UCI/command selector`);
    assert.match(rpc, new RegExp(`(?:^|\\|)\\s*${method}\\s*(?:\\||\\))`, 'm'), `${method} is not dispatched`);
  }
  assert.match(rpc, /json_add_boolean ok/);
  assert.match(rpc, /json_add_string code/);
  assert.match(rpc, /json_add_string message/);
  assert.match(rpc, /json_add_object data/);
  assert.doesNotMatch(rpc, /json_add_(?:string|int|boolean)\s+password\b/i, 'password is emitted by RPC');
  const actionEmitter = rpc.match(/(?:emit|add|build)[A-Za-z_]*(?:action|instance)[A-Za-z_]*\(\)[\s\S]*?(?=\n[A-Za-z_][A-Za-z0-9_]*\(\)|\ncase\s)/i)?.[0] || '';
  if (actionEmitter)
    assert.doesNotMatch(actionEmitter, /json_add_(?:string|int|boolean)\s+username\b/i, 'username is emitted by action RPC');
  assert.doesNotMatch(rpc, /json_add_string\s+output\s+"\$output"/i, 'raw child output is copied into compatibility output');
  const typed = {
    settings_enabled: 'boolean', service_enabled: 'boolean', service_running: 'boolean', network_recovery_required: 'boolean',
    account_count: 'int', instance_count: 'int', enabled_instance_count: 'int', owned_network_count: 'int',
    password_set: 'boolean', reference_count: 'int', restart_required: 'boolean',
    generation: 'int', count: 'int', metric: 'int',
  };
  for (const [key, kind] of Object.entries(typed))
    assert.match(config, new RegExp(`json_add_${kind}\\s+${key}\\b`), `${key} has wrong/missing JSON type`);
  assert.match(config, /json_add_string\s+enabled\b/); assert.match(config, /json_add_string\s+log_level\b/);
  for (const key of ['retry_interval', 'check_interval', 'max_retry_delay', 'already_logged_delay'])
    assert.match(config, new RegExp(`json_add_int\\s+${key}\\b`), `${key} is not an integer payload`);
  assert.doesNotMatch(config, /json_add_(?:string|int|boolean)\s+password\b/i, 'secret password field is serialized');

  const actionBody = shellFunctionBody(rpc, 'emit_instance_result');
  const dataStart = actionBody.indexOf('json_add_object data');
  assert.ok(dataStart >= 0, 'action data object is absent');
  const dataEnd = actionBody.indexOf('json_close_object');
  assert.ok(dataEnd > 0, 'action data object is not closed');
  const dataKeys = [...actionBody.slice(dataStart, dataEnd).matchAll(/json_add_(?:boolean|string|int|array|object|null)\s+([a-z_][a-z0-9_]*)\b/g)].map((m) => m[1]);
  const topKeys = [...actionBody.slice(dataEnd).matchAll(/json_add_(?:boolean|string|int|array|object|null)\s+([a-z_][a-z0-9_]*)\b/g)].map((m) => m[1]);
  const expectedDataKeys = ['action', 'section', 'alias', 'interface', 'v6face', 'account_ref', 'ua_type', 'exit_code', 'outcome', 'status', 'success', 'output'];
  const expectedTopKeys = ['action', 'section', 'alias', 'interface', 'v6face', 'account_ref', 'ua_type', 'legacy_code', 'status', 'success', 'output', 'outcome'];
  assert.deepEqual([...new Set(dataKeys.filter((key) => key !== 'data'))].sort(), expectedDataKeys.sort(), 'action data fields are not exact');
  assert.deepEqual([...new Set(topKeys)].sort(), expectedTopKeys.sort(), 'legacy top-level action fields are not exact');
  assert.equal([...topKeys, ...dataKeys].some((key) => /(?:password|username|ip|mac)/i.test(key)), false, 'action envelope exposes a secret/network identifier');
  assert.doesNotMatch(shellFunctionBody(config, 'ml_network_transaction'), /json_add_string\s+result\b/, 'quick/network data contains an extra legacy result field');
  pass('exact Phase 7 RPC names, fields, envelope and output allowlist');
}

function browserBoundaryTests() {
  const viewRoot = path.join(repository, 'htdocs/luci-static/resources/view/multilogin');
  const files = fs.readdirSync(viewRoot).filter((name) => name.endsWith('.js'));
  assert.ok(files.length >= 5, 'Phase 7 product views are missing');
  const source = files.map((name) => read(path.join(viewRoot, name))).join('\n');
  assert.doesNotMatch(source, /'require uci';|"require uci";/, 'browser directly reads UCI');
  assert.doesNotMatch(source, /'require fs';|"require fs";/, 'browser directly reads/writes files');
  assert.doesNotMatch(source, /\b(?:fs|uci)\.(?:read|write|exec|load|set|add|remove|commit)/, 'browser invokes direct file/UCI APIs');
  assert.doesNotMatch(source, /setInitAction|callInitAction|luci\.setInitAction|callInitAction/, 'browser invokes generic init actions');
  assert.doesNotMatch(source, /\/etc\/multilogin|\/var\/log\/multilogin|https?:\/\//, 'browser embeds server paths or URLs');
  assert.match(source, /password_set/, 'account response does not use password_set');
  assert.doesNotMatch(source, /\b(?:password|passwd)\s*:\s*[^,}\n]+/i, 'browser serializes a returned password field');
  const rpcObjects = [...source.matchAll(/object\s*:\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
  assert.equal(rpcObjects.every((object) => object === 'multilogin'), true, 'browser declares non-MultiLogin RPC object');
  pass('browser has no UCI/file/init access and only receives password_set');
}

function callPolicy(name, args = []) {
  const result = spawnSync('/bin/sh', ['-c', '. "$1"; shift; "$@"', 'policy-call', policyPath, name, ...args], {
    cwd: repository, encoding: 'utf8', timeout: 3000,
  });
  assert.equal(result.error, undefined, `${name} could not run`);
  return { status: result.status, stdout: result.stdout.trim(), stderr: result.stderr };
}

function tokenAndRequestTests() {
  assert.equal(callPolicy('ml_config_token', ['account_1']).status, 0);
  for (const invalid of ['', '1account', 'account.name', 'account/name', '@account[0]', 'a'.repeat(65), 'a b', 'account;rm'])
    assert.notEqual(callPolicy('ml_config_token', [invalid]).status, 0, `invalid token accepted: ${invalid}`);
  assert.equal(callPolicy('ml_config_iface', ['eth0.10']).status, 0);
  for (const invalid of ['', '.eth0', '-eth0', 'eth 0', 'eth0/1', 'e'.repeat(16)])
    assert.notEqual(callPolicy('ml_config_iface', [invalid]).status, 0, `invalid interface accepted: ${invalid}`);

  const exact = [
    ['get_overview', ''], ['save_account', 'alias password section username'],
    ['save_instance', 'account alias enabled interface section ua_type v6face'],
    ['service_action', 'action'], ['quick_setup', 'base_iface count'],
  ];
  for (const [method, fields] of exact)
    assert.equal(callPolicy('ml_config_request_fields', [method, fields]).stdout, 'ok', `${method} exact request fields`);
  for (const [method, fields] of exact) {
    assert.equal(callPolicy('ml_config_request_fields', [method, `${fields} url`]).stdout, 'invalid_request', `${method} URL field`);
    assert.equal(callPolicy('ml_config_request_fields', [method, `${fields} path`]).stdout, 'invalid_request', `${method} path field`);
  }
  assert.equal(callPolicy('ml_config_request_fields', ['unknown', '']).stdout, 'invalid_request');
  pass('section/interface token grammar and exact request-field rejection');
}

function redactionTests() {
  const key = /(?:^|[^A-Za-z0-9_])['"]?(?:authorization|cookie|set-cookie|password|passwd|secret|token)['"]?[ \t]*[:=]/i;
  const mac = /(?:^|[^0-9A-Fa-f])(?:[0-9A-Fa-f]{2}(?::|-)){5}[0-9A-Fa-f]{2}(?:$|[^0-9A-Fa-f])/;
  const ip4 = /(?:^|[^0-9])(?:25[0-5]|2[0-4][0-9]|1?[0-9]{1,2})(?:\.(?:25[0-5]|2[0-4][0-9]|1?[0-9]{1,2})){3}(?:$|[^0-9])/;
  const ip6 = /[0-9A-Fa-f:.]*:[0-9A-Fa-f:.]*:[0-9A-Fa-f:.]*/;
  for (const value of ['Authorization: Bearer sentinel', 'password=sentinel', 'x-token: abc', '"set-cookie": x']) assert.match(value, key);
  assert.match('aa:bb:cc:dd:ee:ff', mac); assert.match('192.0.2.1', ip4); assert.match('2001:db8::1', ip6);
  assert.match(backend, /\[REDACTED\]|REDACTED/);
  assert.match(backend, /\[MAC\]|\[IP\]/);
  for (const required of ['authorization', 'set-cookie', 'password', 'passwd', 'secret', 'token'])
    assert.match(backend, new RegExp(required, 'i'), `RPC redaction misses ${required}`);
  assert.match(backend, /(?:redact|sanitize)[A-Za-z_]*\s*\(/i, 'redaction predicate is absent');
  assert.match(backend, /(?:repeat|second|again|rescan|scan)[\s\S]{0,180}(?:redact|sanitize)/i, 'redaction is not fail-closed/re-scanned');
  const redactor = [...backend.matchAll(/^([A-Za-z_][A-Za-z0-9_]*)\(\)\s*\{([\s\S]*?)^\}/gm)]
    .map((match) => match[2])
    .find((body) => /REDACTED/.test(body) && /password/i.test(body) && /(?:uci|account|passwords|ml_collect)/i.test(body)) || '';
  assert.match(redactor, /password/i, 'redactor does not enumerate server-side passwords');
  assert.match(redactor, /(?:uci|account|passwords|ml_collect)/i, 'redactor has no server-side password source');
  assert.match(redactor, /REDACTED/, 'redactor has no sensitive-key replacement');
  pass('secret, IPv4, IPv6 and MAC redaction predicates are present and fail closed');
}

function ownedPlanTests() {
  assert.ok(fs.existsSync(policyPath), 'Phase 7 source-only policy is missing');
  const empty = callPolicy('ml_config_state_empty');
  assert.equal(empty.status, 0); assert.deepEqual(JSON.parse(empty.stdout), {
    schema: 1, generation: 0, base_iface: '', count: 0, firewall_zone: '',
    network_sections: [], firewall_networks: [], mwan3_sections: [], mwan3_policy: 'balanced', mwan3_members: [],
  });
  const generated = callPolicy('ml_config_state_json', ['7', 'eth0', '3']);
  assert.equal(generated.status, 0); const state = JSON.parse(generated.stdout);
  assert.equal(state.generation, 7); assert.equal(state.count, 3); assert.equal(state.firewall_zone, 'ml3_zone');
  for (const field of ['network_sections', 'firewall_networks', 'mwan3_sections', 'mwan3_members']) {
    assert.deepEqual(state[field], [...state[field]].sort(), `${field} is not deterministic lexical order`);
    assert.equal(new Set(state[field]).size, state[field].length, `${field} contains duplicates`);
  }
  assert.deepEqual(state.network_sections, ['ml3_dev_1', 'ml3_dev_2', 'ml3_dev_3', 'ml3_if_1', 'ml3_if_2', 'ml3_if_3']);
  assert.deepEqual(state.mwan3_members, ['ml3_member_1', 'ml3_member_2', 'ml3_member_3']);
  const ten = JSON.parse(callPolicy('ml_config_state_json', ['8', 'eth0', '10']).stdout);
  for (const field of ['network_sections', 'firewall_networks', 'mwan3_sections', 'mwan3_members'])
    assert.deepEqual(ten[field], [...ten[field]].sort(), `${field} loses lexical ordering at count 10`);
  assert.match(backend, /network-state\.json|network-journal\.json/);
  assert.match(backend, /ml3_(?:dev|if|member|zone)/);
  assert.doesNotMatch(backend, /case\s+[^\n]*auto_\*|auto_\*\s*\)/, 'prefix-based auto_* deletion remains');
  assert.match(backend, /(?:collision|reserved|ownership|owned_generation)/i, 'collision/ownership check is absent');
  pass('canonical owned UCI plans and D-012 exact-ID collision boundary');
}

function stateAndJournalTests() {
  assert.match(backend, /!\s*-e\s+[^\n]+[\s\S]{0,220}ml_config_state_empty/i, 'absent state does not synthesize generation zero');
  assert.match(backend, /manual_recovery/); assert.match(backend, /network_recovery_required/);
  assert.match(backend, /(?:invalid|malformed|unreadable)[\s\S]{0,240}manual_recovery/i);
  assert.match(backend, /network.*commit[\s\S]*firewall.*commit[\s\S]*mwan3.*commit/i, 'network transaction order is not visible');
  assert.match(backend, /(?:json_get_type|type[_-]check|strict[_-]type|expected[_-]type)/i, 'request/state JSON types are not checked explicitly');
  for (const [name, field] of [['ml_delete_account', 'section'], ['ml_delete_instance', 'section']])
    assert.match(shellFunctionBody(config, name), new RegExp(`ml_request_type\\s+${field}\\s+string`), `${name} does not reject non-string section types`);
  assert.match(shellFunctionBody(config, 'ml_quick_setup'), /ml_request_type\s+base_iface\s+string/);
  assert.match(shellFunctionBody(config, 'ml_quick_setup'), /ml_request_type\s+count\s+int/);
  assert.match(shellFunctionBody(config, 'ml_service_action'), /ml_request_type\s+action\s+string/);
  const state = JSON.parse(callPolicy('ml_config_state_json', ['0', 'eth0', '0']).stdout);
  const next = JSON.parse(callPolicy('ml_config_state_json', ['1', 'eth0', '1']).stdout);
  const before = JSON.stringify(state); const after = JSON.stringify(next);
  const decisions = new Map([
    ['prepared', 'finish_after'], ['network_committed', 'finish_after'], ['firewall_committed', 'finish_after'],
    ['mwan3_committed', 'finish_after'], ['services_reloaded', 'finish_after'], ['rollback_required', 'restore_before'],
  ]);
  for (const [journalState, expected] of decisions)
    assert.equal(callPolicy('ml_config_journal_decision', [journalState, before, before, after]).stdout, expected, journalState);
  for (const journalState of decisions.keys())
    assert.equal(callPolicy('ml_config_journal_decision', [journalState, after, before, after]).stdout, 'cleanup_committed', `${journalState} cleanup precedence`);
  assert.equal(callPolicy('ml_config_journal_decision', ['bogus', before, before, after]).stdout, 'manual_recovery');
  assert.equal(callPolicy('ml_config_journal_decision', ['prepared', 'garbage', before, after]).stdout, 'manual_recovery');
  pass('absent/invalid state decisions and total ordered journal reducer');
}

function transactionSafetyTests() {
  const validator = shellFunctionBody(config, 'ml_verify_owned_plan');
  const collisions = shellFunctionBody(config, 'ml_verify_reserved_collisions');
  const transaction = shellFunctionBody(config, 'ml_network_transaction');
  const journalWrite = transaction.indexOf('ml_atomic_text "$ML_NET_JOURNAL"');
  assert.ok(journalWrite >= 0, 'network transaction has no journal write');
  assert.match(validator, /(?:ml_state|ML_STATE|owned|recorded)/i, 'owned-plan validator does not inspect recorded state');
  assert.match(validator, /(?:uci|section|drift|exact)/i, 'owned-plan validator does not validate exact UCI ownership');
  assert.match(validator, /mwan3[\s\S]*ml3_if_[\s\S]*interface\s+17\b/, 'mwan3 interface drift count omits type/options/list entries');
  assert.match(validator, /firewall[\s\S]*ml3_zone[\s\S]*(?:7\s*\+\s*ML_STATE_COUNT|ML_STATE_COUNT\s*\+\s*7)/, 'firewall drift count is not count-dependent');
  assert.match(collisions, /(?:firewall\.ml3_zone|balanced|mwan3|member)/i, 'collision validator omits firewall/policy/member IDs');
  assert.doesNotMatch(validator, /for\s+owned\s+in\s+\$ML_STATE_COUNT\s*;\s*do\s*:/, 'owned-plan validator is a no-op placeholder');
  assert.doesNotMatch(validator, /\[\s*"\$\([^\n]+\)"\s*=\s*policy\s*\]\s*$/m, 'owned-plan validator only checks policy existence');
  assert.match(validator, /(?:ml_uci_checked|uci\s+-q\s+get)[\s\S]*(?:initial_state|track_method|reliability|use_member|network)/i, 'owned-plan validator does not verify exact owned options/list values');
  assert.match(collisions, /(?:for|seq)[\s\S]*(?:1\s+10|1\.\.10|10)|while\s+\[\s*"\$n"\s+-le\s+10\s*\]/, 'reserved collision validator does not scan all indices 1..10');
  assert.doesNotMatch(collisions, /\[\s*"\$\([^\n]+\)"\s*=\s*policy\s*$/m, 'reserved collision validator has an unmatched/placeholder test');
  assert.ok(transaction.indexOf('ml_verify_owned_plan') >= 0 && transaction.indexOf('ml_verify_owned_plan') < journalWrite, 'owned-plan validator runs after journal write');
  assert.ok(transaction.indexOf('ml_verify_reserved_collisions') >= 0 && transaction.indexOf('ml_verify_reserved_collisions') < journalWrite, 'collision validator runs after journal write');

  const apply = shellFunctionBody(config, 'ml_apply_plan');
  const requiredMwanOptions = [
    ['initial_state', 'offline'], ['track_method', 'ping'], ['reliability', '1'], ['count', '1'],
    ['size', '56'], ['max_ttl', '60'], ['timeout', '2'], ['interval', '5'], ['failure_interval', '5'],
    ['recovery_interval', '5'], ['down', '2'], ['up', '3'],
  ];
  for (const [option, value] of requiredMwanOptions)
    assert.match(apply, new RegExp(`mwan3\\.ml3_if_\\$n\\.${option}=${value}`), `apply plan omits mwan3 ${option}=${value}`);
  assert.match(apply, /ml_uci_checked\s+add_list\s+"mwan3\.ml3_if_\$n\.track_ip=223\.5\.5\.5"[\s\S]*ml_uci_checked\s+add_list\s+"mwan3\.ml3_if_\$n\.track_ip=114\.114\.114\.114"/, 'track_ip list order/values drifted');
  assert.match(config, /ml_uci_checked\(\)/, 'checked UCI helper is absent');
  assert.match(apply, /ml_uci_checked\s+/, 'apply plan does not route UCI calls through checked helper');
  assert.doesNotMatch(apply, /\buci\s+(?:-q\s+)?(?:set|delete|del_list|add_list)\b[^\n]*;\s*uci\s+/, 'apply plan chains unchecked UCI mutations');
  assert.match(transaction, /network reload[\s\S]*rollback_required[\s\S]*ml_apply_plan|rollback_required[\s\S]*ml_apply_plan[\s\S]*network reload/, 'reload failure does not record rollback and reconstruct the before-plan');
  pass('ownership drift/collision validation precedes journaling and apply plans check every UCI mutation');
}

function logBoundaryTests() {
  const getLogs = shellFunctionBody(config, 'ml_get_logs');
  assert.match(config, /ml_utf8_valid\(\)/, 'UTF-8 validator is absent');
  assert.match(config, /ml_ipv4_token_valid\(\)/, 'strict IPv4 validator is absent');
  assert.match(config, /ml_log_tail_complete\(\)/, 'complete-line byte-tail helper is absent');
  const utf8 = shellFunctionBody(config, 'ml_utf8_valid');
  const tail = shellFunctionBody(config, 'ml_log_tail_complete');
  assert.doesNotMatch(utf8, /grep\s+-Iq/, 'UTF-8 validation uses grep heuristic instead of a validator');
  assert.match(utf8, /iconv|uconv|python|perl|\bod\b[\s\S]*(?:194|244)[\s\S]*(?:128|191)/, 'UTF-8 validator has no decoding implementation');
  assert.doesNotMatch(tail, /tail\s+-c\s+65536/, 'byte tail can expose a partial first line');
  assert.match(tail, /(?:line|newline|sed|awk|head|while)/i, 'complete-line tail has no boundary handling');
  assert.match(getLogs, /ml_utf8_valid\s+/, 'get_logs does not invoke UTF-8 validation');
  assert.match(getLogs, /ml_log_tail_complete\s+/, 'get_logs does not invoke complete-line byte truncation');
  assert.match(getLogs, /selected_bytes[\s\S]*source_bytes/, 'truncated is derived from command-substitution content instead of selected bytes');
  const redact = shellFunctionBody(config, 'ml_redact_log');
  assert.match(redact, /ml_(?:ipv4_token_valid|redact_ipv4_line)\s*/, 'strict IPv4 predicate is not part of redaction');
  if (/ml_redact_ipv4_line/.test(redact))
    assert.match(shellFunctionBody(config, 'ml_redact_ipv4_line'), /(?:255|ml_ipv4_token_valid)/, 'IPv4 redactor does not enforce octet bounds');
  const manual = shellFunctionBody(rpc, 'record_manual_action');
  assert.match(manual, /INSTANCE_CHILD_STARTED[\s\S]*source=manual action=\$action outcome=\$outcome exit=\$code/,
    'manual action diagnostics do not prove child execution or use fixed fields');
  assert.match(manual, /! -L \/var\/log\/multilogin\.log[\s\S]*chmod 0600[\s\S]*logger -t multilogin-action/,
    'manual action diagnostics lack fixed-log symlink/mode protection or syslog');
  const manualTemplate = /diagnostic="([^"]+)"/.exec(manual)?.[1];
  assert.equal(manualTemplate, 'source=manual action=$action outcome=$outcome exit=$code',
    'manual action diagnostic template is not the exact allowlist');
  assert.doesNotMatch(manualTemplate, /(?:password|username|account|portal|result|alias|interface)/i,
    'manual action diagnostic template includes non-allowlisted data');
  pass('log redaction uses UTF-8, strict IPv4 and complete-line byte-bound helpers');
}

function aclAndMenuTests() {
  const acl = JSON.parse(read(aclPath))['luci-app-multi-login'];
  assert.ok(acl?.read && acl?.write, 'ACL read/write split is missing');
  assert.equal(Object.hasOwn(acl.read, 'uci'), false); assert.equal(Object.hasOwn(acl.write, 'uci'), false);
  assert.equal(Object.hasOwn(acl.read, 'file'), false); assert.equal(Object.hasOwn(acl.write, 'file'), false);
  assert.equal(Object.hasOwn(acl.read.ubus ?? {}, 'file'), false); assert.equal(Object.hasOwn(acl.write.ubus ?? {}, 'file'), false);
  assert.equal(Object.hasOwn(acl.read.ubus ?? {}, 'service'), false); assert.equal(Object.hasOwn(acl.write.ubus ?? {}, 'service'), false);
  assert.equal(Object.hasOwn(acl.read.ubus ?? {}, 'luci'), false); assert.equal(Object.hasOwn(acl.write.ubus ?? {}, 'luci'), false);
  const readMethods = new Set(acl.read.ubus?.multilogin ?? []);
  const writeMethods = new Set(acl.write.ubus?.multilogin ?? []);
  for (const name of ['get_overview', 'get_settings', 'list_accounts', 'list_instances', 'service_status', 'get_diagnostics', 'get_logs', 'script_info', 'script_check', 'script_get_draft', 'list_auto']) assert.ok(readMethods.has(name), `missing read ${name}`);
  for (const name of ['save_settings', 'save_account', 'delete_account', 'save_instance', 'delete_instance', 'service_action', 'clear_logs', 'quick_setup', 'remove_auto', 'network_recover', 'test_instance', 'logout_instance', 'script_create_draft']) assert.ok(writeMethods.has(name), `missing write ${name}`);
  for (const name of ['test_instance', 'logout_instance', 'save_account', 'delete_account', 'quick_setup', 'remove_auto', 'script_create_draft']) assert.equal(readMethods.has(name), false, `mutator ${name} has read grant`);
  const menu = JSON.parse(read(menuPath));
  const visibleRoutes = Object.entries(menu)
    .filter(([route, entry]) => route.startsWith('admin/services/multilogin/') && entry.hidden !== true)
    .map(([route]) => route)
    .sort();
  assert.deepEqual(visibleRoutes, [
    'admin/services/multilogin/configuration',
    'admin/services/multilogin/maintenance',
    'admin/services/multilogin/maintenance/scripts',
    'admin/services/multilogin/maintenance/troubleshooting',
    'admin/services/multilogin/network',
    'admin/services/multilogin/overview',
  ], 'visible navigation does not match the dashboard/login/network/maintenance IA');
  assert.equal(menu['admin/services/multilogin/maintenance']?.action?.type, 'alias', 'maintenance parent is not an alias');
  assert.equal(menu['admin/services/multilogin/maintenance']?.action?.path,
    'admin/services/multilogin/maintenance/troubleshooting', 'maintenance parent targets troubleshooting');
  assert.equal(menu['admin/services/multilogin/maintenance/troubleshooting']?.action?.type, 'view');
  assert.equal(menu['admin/services/multilogin/maintenance/troubleshooting']?.action?.path, 'multilogin/diagnostics');
  assert.equal(menu['admin/services/multilogin/maintenance/scripts']?.action?.type, 'view');
  assert.equal(menu['admin/services/multilogin/maintenance/scripts']?.action?.path, 'multilogin/script');
  assert.equal(menu['admin/services/multilogin/configuration']?.title, '登录管理');
  assert.equal(menu['admin/services/multilogin/network']?.title, '网络资源');
  assert.equal(menu['admin/services/multilogin/overview']?.title, '仪表盘');
  assert.equal(JSON.stringify(menu).includes('services/multilogin.png'), false, 'dangling menu icon remains');
  for (const [legacy, target] of Object.entries({
    settings: 'configuration', accounts: 'configuration', interfaces: 'network',
    scripts: 'maintenance/scripts', diagnostics: 'maintenance/troubleshooting',
    script: 'maintenance/scripts', log: 'maintenance/troubleshooting'
  })) {
    const entry = menu[`admin/services/multilogin/${legacy}`];
    assert.equal(entry?.hidden, true, `${legacy} compatibility alias is not hidden`);
    assert.equal(Object.hasOwn(entry ?? {}, 'title'), false, `${legacy} compatibility alias still exposes a menu title on LuCI 23.05`);
    assert.equal(entry?.action?.type, 'alias', `${legacy} compatibility route loads an old view`);
    assert.equal(entry?.action?.path, `admin/services/multilogin/${target}`, `${legacy} alias targets wrong route`);
  }
  const overview = read(path.join(viewDirectory, 'overview.js'));
  const configuration = read(path.join(viewDirectory, 'configuration.js'));
  const network = read(path.join(viewDirectory, 'network.js'));
  const diagnostics = read(path.join(viewDirectory, 'diagnostics.js'));
  const script = read(path.join(viewDirectory, 'script.js'));
  assert.match(overview, /method:\s*['"]service_action['"]/);
  assert.match(overview, /params:\s*\[['"]action['"]\]/);
  assert.match(overview, /function runServiceAction\(/);
  assert.match(overview, /callServiceAction\(entry\.action\)/);
  for (const action of ['start', 'stop', 'restart', 'enable', 'disable'])
    assert.match(overview, new RegExp(`action:\\s*['"]${action}['"]`), `overview misses ${action} service action`);
  for (const heading of ['overview-conclusion-heading', 'overview-blockers-heading'])
    assert.match(overview, new RegExp(heading), `overview misses ${heading} IA section`);
  for (const removed of ['overview-completeness-heading', 'overview-primary-heading', 'overview-service-heading', 'overview-recovery-heading'])
    assert.doesNotMatch(overview, new RegExp(removed), `overview still exposes removed ${removed} section`);
  const loadSource = overview.slice(overview.indexOf('load:'), overview.indexOf('render:'));
  assert.doesNotMatch(loadSource, /callServiceAction\(/, 'overview load path writes service state');
  assert.doesNotMatch(configuration, /method:\s*['"]service_action['"]/, 'configuration retains service action RPC after IA move');
  assert.match(overview, /ml-dashboard-service-inline/, 'overview hides service controls instead of keeping them in the blockers card');
  assert.doesNotMatch(overview, /owned_network_count|缺少网络资源|尚未配置网络资源/, 'network resource absence still blocks the dashboard');
  for (const source of [diagnostics, script]) {
    assert.match(source, /function maintenanceNav\(active\)/, 'maintenance page lacks its task sub-navigation');
    assert.match(source, /maintenance\/troubleshooting/);
    assert.match(source, /maintenance\/scripts/);
    assert.match(source, /aria-current/);
  }
  assert.match(network, /function confirmRecovery\(\)/, 'network recovery has no dedicated confirmation path');
  assert.match(network, /写入 UCI[\s\S]{0,120}commit[\s\S]{0,120}reload network[\s\S]{0,120}firewall[\s\S]{0,120}mwan3/,
    'network recovery confirmation does not describe its write/reload risk');
  assert.match(network, /button\(_\('执行固定恢复检查'\), confirmRecovery,[\s\S]{0,120}cbi-button-negative/,
    'network recovery action is not visibly destructive or confirmation-gated');
  assert.doesNotMatch(network, /执行固定恢复检查'\)[\s\S]{0,80}run\(callRecover/, 'network recovery bypasses confirmation');
  pass('ACL grants, dashboard/login/network/maintenance navigation, recovery safety, and Overview service IA');
}

function docsTests() {
  for (const file of docs) {
    const source = read(path.join(repository, file));
    assert.doesNotMatch(source, /option\s+password\s+['"][^<\[\]…]+['"]/i, `${file} contains a credential-bearing UCI example`);
    assert.doesNotMatch(source, /--password\s+(?!<password>|<[^>]+>|PASSWORD\b|\$\{?PASSWORD\}?)/i, `${file} contains a password-bearing CLI example`);
    assert.doesNotMatch(source, /(?:student123|pass123|password123|your_password|your_account)/i, `${file} contains stock credential sentinel`);
  }
  pass('README and project overview contain no credential-bearing examples');
}

function luciRpcEnvelopeTests() {
  const views = fs.readdirSync(viewDirectory).filter((name) => name.endsWith('.js')).sort();
  assert.ok(views.length >= 5, 'MultiLogin LuCI view set is unexpectedly incomplete');
  for (const name of views) {
    const source = read(path.join(viewDirectory, name));
    const declarations = source.match(/rpc\.declare\s*\(\s*\{/g) ?? [];
    assert.ok(declarations.length > 0, `${name} has no RPC declarations`);
    assert.equal((source.match(/expect:\s*\{\s*\}/g) ?? []).length, 0, `${name} uses ambiguous empty RPC expect declarations`);
    assert.equal((source.match(/expect:\s*\{\s*['"]['"]\s*:\s*\{\s*\}\s*\}/g) ?? []).length, declarations.length,
      `${name} does not preserve the complete RPC response envelope`);
  }
  pass('LuCI RPC declarations preserve complete response envelopes across supported LuCI versions');
}

function luciNullChildTests() {
  const expectedCompactCalls = {
    configuration: 6,
    diagnostics: 2,
    network: 3,
    overview: 2,
    script: 3
  };
  for (const [name, expected] of Object.entries(expectedCompactCalls)) {
    const source = read(path.join(viewDirectory, `${name}.js`));
    assert.match(source, /function compact\(children\)\s*\{[\s\S]*?child !== null && child !== undefined/, `${name} has no null-child filter`);
    assert.equal((source.match(/compact\(\[/g) ?? []).length, expected, `${name} has an unexpected number of filtered child lists`);
    assert.doesNotMatch(source, /(?:root|content)\.replaceChildren\s*\(/, `${name} passes raw children to replaceChildren`);
    assert.match(source, /(?:root|content)\.replaceChildren\.apply\([^;]*compact\(\[/, `${name} does not filter replaceChildren arguments`);
  }
  assert.match(read(path.join(viewDirectory, 'configuration.js')), /function input\([\s\S]*?compact\(\[/, 'configuration input help child is not filtered');
  assert.match(read(path.join(viewDirectory, 'overview.js')), /var blockerChildren = compact\(\[/, 'overview blocker children are not filtered');
  assert.match(read(path.join(viewDirectory, 'overview.js')), /var conclusionChildren = \[/, 'overview conclusion children are not assembled explicitly');
  assert.match(read(path.join(viewDirectory, 'network.js')), /state\.feedback \? E\([\s\S]*?compact\(\[/, 'network feedback children are not filtered');
  assert.match(read(path.join(viewDirectory, 'script.js')), /custom-heading[\s\S]*?compact\(\[/, 'script conflict child is not filtered');
  pass('LuCI optional DOM children never render literal null text on legacy appenders');
}

function jshnNounsetCompatibilityTests() {
  assert.doesNotMatch(config, /^set -u$/m, 'configuration RPC backend forces third-party jshn into nounset');
  assert.doesNotMatch(config, /^JSON_(?:PREFIX|UNSET)=/m, 'configuration RPC backend carries jshn state shims');
  assert.doesNotMatch(config, /^json_init\(\) \{/m, 'configuration RPC backend overrides third-party json_init');
  assert.match(config, /ml_json_load\(\)[\s\S]{0,240}jshn -r "\$text"[\s\S]{0,120}json_load "\$text"/,
    'configuration RPC backend does not preserve the native jshn parse status');
  assert.doesNotMatch(config, /^\s*json_get_keys\s+\S+\s*(?:\|\||;|$)/m,
    'configuration RPC backend calls optional jshn json_get_keys argument unsafely');
  assert.doesNotMatch(config, /^\s*json_get_var\s+\S+\s+\S+\s*(?:\|\||;|$)/m,
    'configuration RPC backend calls optional jshn json_get_var default unsafely');
  pass('configuration RPC backend uses native jshn semantics with explicit optional arguments');
}

function rpcdSessionMetadataTests() {
  const script = read(path.join(repository, 'root/usr/libexec/multilogin-script'));
  assert.match(config, /ubus_rpc_session/, 'configuration backend does not account for rpcd session metadata');
  assert.match(config, /ubus_rpc_session\)[\s\S]{0,180}ml_request_type[^\n]*string/, 'configuration backend does not type-check rpcd session metadata');
  assert.match(config, /filtered="\$filtered\$\{filtered:\+ \}\$key"/, 'configuration backend does not rebuild business fields after metadata filtering');
  assert.ok(config.includes("ML_REQUEST_KEYS=$(printf '%s\\n' $filtered | LC_ALL=C sort"),
    'configuration backend does not canonicalize filtered business-field order');
  assert.match(script, /ubus_rpc_session/, 'script backend does not account for rpcd session metadata');
  assert.match(script, /ubus_rpc_session\)[\s\S]{0,200}ml_get_typed[^\n]*string/, 'script backend does not type-check rpcd session metadata');
  assert.match(script, /filtered="\$filtered\$\{filtered:\+ \}\$key"/, 'script backend does not rebuild business fields after metadata filtering');
  const actionParser = shellFunctionBody(rpc, 'parse_action_section');
  assert.match(actionParser, /jshn -r "\$trimmed"[\s\S]*?json_load "\$trimmed"/,
    'instance action backend does not preserve native JSHN parser status');
  assert.match(actionParser, /ubus_rpc_session\)[\s\S]*?json_get_type session_type ubus_rpc_session[\s\S]*?\[ "\$session_type" = string \]/,
    'instance action backend does not type-check rpcd session metadata');
  assert.match(actionParser, /business_keys="\$business_keys\$\{business_keys:\+ \}\$key"[\s\S]*?\[ "\$business_keys" = section \]/,
    'instance action backend does not exclude session metadata from the exact business schema');
  pass('rpcd-injected ubus_rpc_session metadata is type-checked and excluded from every business schema');
}

function instanceActionFeedbackTests() {
  const configuration = read(path.join(viewDirectory, 'configuration.js'));
  assert.match(configuration, /function runInstanceAction\(/, 'structured instance action runner is absent');
  assert.match(configuration, /runInstanceAction\(instance,[\s\S]{0,120}callCheckInstance\(instance\.section\)/,
    'instance status action does not use the structured action runner');
  for (const field of ['data.status', 'data.outcome', 'data.exit_code'])
    assert.ok(configuration.includes(field), `instance action feedback omits ${field}`);
  assert.match(configuration, /state\.instanceResults\[instance\.section\][\s\S]*?action:[\s\S]*?outcome:[\s\S]*?exitCode:/,
    'instance action response is not retained per task');
  assert.match(configuration, /脚本返回[\s\S]*?action=[\s\S]*?outcome=[\s\S]*?exit=/,
    'task row does not render the structured script return');
  assert.match(configuration, /function runInstanceAction\([\s\S]*?\}, false\);/,
    'instance actions unnecessarily refresh configuration and risk replacing the script return');
  assert.match(configuration, /if \(refreshAfter === false\)[\s\S]*?state\.busy = false;[\s\S]*?draw\(\);/,
    'non-refreshing action results do not leave busy state or redraw their return');
  const rowsStart = configuration.indexOf('function instanceRows');
  const rowsEnd = configuration.indexOf('function taskPrerequisite');
  assert.ok(rowsStart >= 0 && rowsEnd > rowsStart, 'instance rows source range is absent');
  const instanceRowsSource = configuration.slice(rowsStart, rowsEnd);
  const dangerAt = instanceRowsSource.indexOf("E('div', { class: 'ml-actions ml-actions--danger' }, [");
  assert.ok(dangerAt >= 0, 'task danger action group is absent');
  assert.equal((instanceRowsSource.slice(0, dangerAt).match(/E\('div', \{ class: 'ml-actions' \}, \[/g) ?? []).length, 2,
    'task actions are not wrapped in a single row-level action container');
  const stylesheet = read(path.join(viewDirectory, 'multi-login.css'));
  assert.match(stylesheet, /\.ml-table \.ml-actions \{\s*align-items: flex-start;\s*min-width: 0;\s*\}/,
    'task action container can overflow or lose flexible shrink behavior');
  pass('instance actions preserve and render structured script status/outcome/exit results');
}

function instanceEditorTests() {
  const configuration = read(path.join(viewDirectory, 'configuration.js'));
  const editor = /function instanceEditor\([\s\S]*?\n        \}/.exec(configuration)?.[0] ?? '';
  assert.ok(editor, 'instance editor is absent');
  assert.match(editor, /var interfaceChoices = interfaces\.map/, 'IPv4/IPv6 selectors do not share the loaded interface set');
  assert.match(editor, /choicesWithCurrent\(current\)[\s\S]*!interfaces\.includes\(current\)[\s\S]*当前配置，暂不可用/, 'temporarily missing saved interfaces are not preserved');
  assert.match(editor, /select\(iface, _\('IPv4 接口'\), choices\(choicesWithCurrent\(instance\.interface\), instance\.interface\)\)/, 'IPv4 interface is not a preserving selector');
  assert.match(editor, /select\(v6, _\('IPv6 接口（可选）'\), choices\(choicesWithCurrent\(instance\.v6face\), instance\.v6face, _\('不使用 IPv6 接口'\)\)\)/, 'IPv6 interface is not an optional preserving selector');
  assert.doesNotMatch(editor, /input\(v6,/, 'IPv6 interface regressed to a free-text field');
  assert.match(configuration, /\.ml-modal|ml-modal/, 'instance editor lacks the shared modal layout class');
  pass('instance editor uses aligned IPv4/IPv6 interface selectors');
}

function settingsSaveOrderTests() {
  const configuration = read(path.join(viewDirectory, 'configuration.js'));
  const runStart = configuration.indexOf('function run(');
  const runEnd = configuration.indexOf('\n        }', runStart);
  assert.ok(runStart >= 0 && runEnd > runStart, 'configuration run helper is absent');
  const run = configuration.slice(runStart, runEnd);
  const requestAt = run.indexOf('L.resolveDefault(request(), failed())');
  assert.ok(requestAt >= 0, 'configuration run helper never starts the request');
  assert.doesNotMatch(run.slice(0, requestAt), /draw\(\)/, 'run() redraws before capturing request/DOM state');
  assert.ok(run.indexOf('draw();', requestAt) > requestAt, 'run() has no busy-state draw after the request starts');
  pass('settings save captures checkbox/field values before the busy-state redraw');
}

function uciSectionEnumerationTests() {
  const collector = shellFunctionBody(config, 'ml_collect_sections');
  assert.match(collector, /listing=\$\(uci -q -X show multilogin 2>\/dev\/null\) \|\| return 1/,
    'section enumeration does not request generated anonymous UCI names or fail closed');
  assert.match(collector, /printf '%s\\n' "\$listing"/, 'section enumeration parses captured UCI output');
  assert.match(collector, /status=\$\?[\s\S]*listing=''[\s\S]*return "\$status"/, 'section enumeration leaves captured UCI output in shell state');

  const normalize = shellFunctionBody(config, 'ml_normalize_section');
  const anonymous = shellFunctionBody(config, 'ml_section_is_anonymous');
  const saveAccount = shellFunctionBody(config, 'ml_save_account');
  const validText = shellFunctionBody(config, 'ml_valid_text');
  const validUsername = shellFunctionBody(config, 'ml_valid_username');
  const saveInstance = shellFunctionBody(config, 'ml_save_instance');
  assert.match(validText, /cr=\$\(printf '\\r'\)[\s\S]*nl=\$\(printf '\\nx'\)[\s\S]*nl=\$\{nl%x\}/, 'text validator does not preserve a literal newline while checking CR/LF');
  assert.doesNotMatch(validText, /\$\(printf '\\n'\)/, 'text validator uses a command-substituted empty newline pattern');
  assert.match(validUsername, /if printf '%s' "\$1" \| grep -q '\[\[:cntrl:\]\]'[\s\S]*return 1[\s\S]*return 0/, 'username validator rejects valid usernames because grep no-match falls through as failure');
  const validatorScript = [
    `ml_valid_text() {${validText}\n}`,
    `ml_valid_username() {${validUsername}\n}`,
    'case "$1" in text) ml_valid_text "$2" "$3" ;; username) ml_valid_username "$2" ;; esac',
  ].join('\n');
  const validate = (kind, value, limit = '') => spawnSync('sh', ['-c', validatorScript, 'phase7-validator', kind, value, limit], { encoding: 'utf8' });
  for (const [kind, value, limit] of [
    ['text', 'QEMU Test', 128], ['text', '含空格的别名', 128], ['text', 'a\tb', 128],
    ['username', 'student001', ''], ['username', '含空格 用户', ''],
  ]) assert.equal(validate(kind, value, limit).status, 0, `${kind} validator rejected valid text`);
  for (const [kind, value, limit] of [
    ['text', 'a\rb', 128], ['text', 'a\nb', 128], ['username', 'a\tb', ''],
    ['username', '', ''], ['username', 'x'.repeat(257), ''],
  ]) assert.notEqual(validate(kind, value, limit).status, 0, `${kind} validator accepted invalid text`);
  pass('account text validators preserve ordinary/UTF-8 values and reject line/control/length failures');
  assert.match(config, /ml_next_section_name\(\)/, 'stable section allocator is absent');
  assert.match(config, /ml_section_is_anonymous\(\)/, 'normalization has no actual anonymous-section detector');
  assert.match(config, /uci -q -X show multilogin[\s\S]*uci -q show multilogin/, 'anonymous-section detector does not compare extended and ordinary UCI listings');
  assert.match(anonymous, /if \(\$0 !~ \/\^multilogin\\\./, 'anonymous-section awk filters are not wrapped in BusyBox-compatible actions');
  assert.doesNotMatch(normalize, /case \$section in cfg\*\)/, 'normalization treats every cfg-prefixed name as anonymous');
  assert.match(normalize, /uci rename "multilogin\.\$section=\$target"/, 'anonymous sections are not normalized to named sections');
  assert.match(normalize, /ml_collect_sections instance[\s\S]*ml_normalize_section "\$reference" instance[\s\S]*uci rename "multilogin\.\$section=\$target"[\s\S]*uci set "multilogin\.\$normalized_reference\.account=\$target"/, 'account reference updates do not name instances before rewriting links');
  assert.match(saveAccount, /ml_next_section_name account[\s\S]*uci set "multilogin\.\$section=account"/, 'new accounts are still created anonymously');
  assert.doesNotMatch(saveAccount, /uci add multilogin account/, 'account save still depends on an unstable anonymous ID');
  assert.match(saveAccount, /ml_normalize_section "\$section" account/, 'legacy anonymous accounts are not normalized before update');
  assert.match(saveInstance, /ml_next_section_name instance[\s\S]*uci set "multilogin\.\$section=instance"/, 'new instances are still created anonymously');
  assert.doesNotMatch(saveInstance, /uci add multilogin instance/, 'instance save still depends on an unstable anonymous ID');
  assert.match(saveInstance, /ml_normalize_section "\$account" account/, 'instance save does not normalize legacy anonymous account references');
  assert.match(saveInstance, /normalized_changed[\s\S]*\[ "\$normalized_changed" != 1 \]/, 'instance no-change path ignores section normalization');
  assert.match(saveInstance, /section_listing=\$\(uci -q show "multilogin\.\$section"/, 'optional IPv6 clearing does not fail closed when the section listing cannot be read');
  assert.ok(saveInstance.includes('grep -Eq "^multilogin\\\\.$section\\\\.v6face="'), 'optional IPv6 clearing does not anchor exact option presence');
  assert.match(saveInstance, /grep_status=\$\?[\s\S]*\[ "\$grep_status" -eq 1 \] \|\| false/, 'optional IPv6 clearing does not distinguish no-match from grep errors');
  const adversarialListing = [
    "multilogin.instance_1=instance",
    "multilogin.instance_1.alias='valid multilogin.instance_1.v6face= alias'",
  ].join('\n');
  assert.equal(adversarialListing.split('\n').some((line) => /^multilogin\.instance_1\.v6face=/.test(line)), false,
    'option-presence predicate matches a substring inside a valid alias');
  assert.match(saveInstance, /uci revert multilogin[\s\S]*ml_error not_found 'instance not found'/, 'instance validation can leak an uncommitted account normalization');
  assert.match(saveInstance, /section=\$\(ml_next_section_name instance\) \|\| \{[\s\S]*uci revert multilogin/, 'instance allocator failure can leak account normalization');
  assert.ok(saveInstance.indexOf('section=$(ml_next_section_name instance)') < saveInstance.indexOf('ml_normalize_section "$account" account'),
    'new instance allocation occurs after account normalization');
  assert.match(shellFunctionBody(config, 'ml_get_overview'), /account_sections=\$\(ml_collect_sections account\) \|\| return 1[\s\S]*instance_sections=\$\(ml_collect_sections instance\) \|\| return 1/, 'overview hides section-enumeration failures');
  assert.match(shellFunctionBody(config, 'ml_list_accounts'), /sections=\$\(ml_collect_sections account\) \|\|[\s\S]*instance_sections=\$\(ml_collect_sections instance\) \|\|/, 'account listing hides section-enumeration failures');
  assert.match(shellFunctionBody(config, 'ml_delete_account'), /references=\$\(ml_collect_sections instance\) \|\|[\s\S]*configuration read failed/, 'account deletion treats failed reference enumeration as empty');
  assert.match(shellFunctionBody(config, 'ml_list_instances'), /sections=\$\(ml_collect_sections instance\) \|\|[\s\S]*configuration read failed/, 'instance listing hides section-enumeration failures');

  const listing = [
    'multilogin.global=settings',
    'multilogin.cfg_account=account',
    'multilogin.@account[0]=account',
    'multilogin.named_account=account',
    'multilogin.cfg_custom=account',
    'multilogin.cfg_instance=instance',
  ].join('\n');
  const parser = String.raw`type=$1; listing=$2; printf '%s\n' "$listing" | sed -n "s/^multilogin\.\([A-Za-z_][A-Za-z0-9_]*\)=\('$type'\|$type\)$/\1/p" | LC_ALL=C sort -u`;
  for (const [type, expected] of [['account', ['cfg_account', 'cfg_custom', 'named_account']], ['instance', ['cfg_instance']]]) {
    const result = spawnSync('/bin/sh', ['-c', parser, 'section-parser', type, listing], { encoding: 'utf8', timeout: 3000 });
    assert.equal(result.status, 0, `${type} section parser failed`);
    assert.deepEqual(result.stdout.trim().split('\n').filter(Boolean), expected, `${type} section enumeration changed`);
  }
  pass('UCI enumeration and stable named section references cover anonymous legacy data');
}

rpcSurfaceTests();
browserBoundaryTests();
tokenAndRequestTests();
redactionTests();
ownedPlanTests();
stateAndJournalTests();
transactionSafetyTests();
logBoundaryTests();
aclAndMenuTests();
docsTests();
luciRpcEnvelopeTests();
luciNullChildTests();
jshnNounsetCompatibilityTests();
rpcdSessionMetadataTests();
instanceActionFeedbackTests();
instanceEditorTests();
settingsSaveOrderTests();
uciSectionEnumerationTests();
process.stdout.write(`${checks} Phase 7 static/pure checks passed.\n`);

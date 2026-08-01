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
  for (const name of ['save_settings', 'save_account', 'delete_account', 'save_instance', 'delete_instance', 'service_action', 'clear_logs', 'quick_setup', 'remove_auto', 'network_recover', 'test_instance', 'logout_instance']) assert.ok(writeMethods.has(name), `missing write ${name}`);
  for (const name of ['test_instance', 'logout_instance', 'save_account', 'delete_account', 'quick_setup', 'remove_auto']) assert.equal(readMethods.has(name), false, `mutator ${name} has read grant`);
  const menu = JSON.parse(read(menuPath));
  const routes = Object.keys(menu).filter((route) => route.startsWith('admin/services/multilogin/')).map((route) => route.split('/').at(-1));
  assert.deepEqual(routes.filter((route) => ['overview', 'configuration', 'network', 'scripts', 'diagnostics'].includes(route)).sort(), ['configuration', 'diagnostics', 'network', 'overview', 'scripts']);
  assert.equal(JSON.stringify(menu).includes('services/multilogin.png'), false, 'dangling menu icon remains');
  for (const [legacy, target] of Object.entries({ settings: 'configuration', accounts: 'configuration', interfaces: 'network', script: 'scripts', log: 'diagnostics' })) {
    const entry = menu[`admin/services/multilogin/${legacy}`];
    assert.equal(entry?.hidden, true, `${legacy} compatibility alias is not hidden`);
    assert.equal(entry?.action?.type, 'alias', `${legacy} compatibility route loads an old view`);
    assert.equal(entry?.action?.path, `admin/services/multilogin/${target}`, `${legacy} alias targets wrong route`);
  }
  pass('ACL negative grants and five-route navigation surface');
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
process.stdout.write(`${checks} Phase 7 static/pure checks passed.\n`);

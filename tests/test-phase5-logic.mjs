#!/usr/bin/env node
/* Bounded Phase 5 static checks and source-only policy tests. */
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
const policyPath = path.join(repository, 'root/usr/lib/multilogin/script-policy.sh');
const backendPath = path.join(repository, 'root/usr/libexec/multilogin-script');
const rpcdPath = path.join(repository, 'root/usr/libexec/rpcd/multilogin');
const initPath = path.join(repository, 'etc/init.d/multilogin');
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'multilogin-phase5-logic.'));
const rawUrl = 'https://raw.githubusercontent.com/Zesuy/luci-app-multi-login/main/etc/multilogin/cqu-portal.sh';
const hashA = 'a'.repeat(64);
const hashB = 'b'.repeat(64);
const phase5Schemas = Object.freeze({
  script_info: [],
  script_check: [],
  script_stage: ['expected_generation'],
  script_validate: ['confirm_execute', 'expected_generation', 'expected_sha256', 'source'],
  script_activate: ['allow_downgrade', 'confirm_activate', 'expected_generation', 'expected_sha256', 'source'],
  script_rollback: ['confirm_activate', 'expected_generation', 'expected_sha256'],
  script_restore: ['confirm_activate', 'expected_generation', 'expected_sha256'],
  script_get_draft: [],
  script_save_draft: ['base_sha256', 'content', 'expected_generation'],
  script_discard_draft: ['expected_generation', 'expected_sha256'],
});
const summaryKeys = ['present', 'status', 'source', 'mode', 'version', 'api', 'sha256'];
const stateKeys = ['schema', 'generation', 'mode', 'active', 'candidate', 'last_known_good', 'custom'];
const journalKeys = ['schema', 'generation', 'operation', 'source', 'selected_sha256', 'previous_active', 'backup_sha256', 'state'];
const policyApi = [
  'ml_policy_semver_compare', 'ml_policy_relation', 'ml_policy_request_fields',
  'ml_policy_transition', 'ml_policy_generation', 'ml_policy_boolean',
  'ml_policy_http', 'ml_policy_content_file', 'ml_policy_downgrade',
];
let checks = 0;

process.on('exit', () => fs.rmSync(temporaryRoot, { recursive: true, force: true }));

const read = (file) => fs.readFileSync(file, 'utf8');
const pass = (name) => { checks += 1; process.stdout.write(`PASS  phase5-logic: ${name}\n`); };

function write(file, body, mode = 0o600) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body, { mode });
  fs.chmodSync(file, mode);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repository,
    env: { ...process.env, ...options.env },
    encoding: options.encoding ?? 'utf8',
    input: options.input,
    timeout: options.timeout ?? 3000,
  });
  if (result.error)
    throw result.error;
  return result;
}

function callPolicy(functionName, args = []) {
  const result = run('/bin/sh', ['-c', `. "$1"; shift; ${functionName} "$@"`, 'policy-call', policyPath, ...args]);
  assert.equal(result.status, 0, `${functionName}(${args.join(',')}) status: ${result.stderr}`);
  assert.equal(result.stderr, '', `${functionName} emitted stderr`);
  return result.stdout.trim();
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function shellFunctions(source) {
  return [...source.matchAll(/^([A-Za-z_][A-Za-z0-9_]*)\(\) \{\n([\s\S]*?)^\}/gm)]
    .map((match) => ({ name: match[1], body: match[2] }));
}

function singleFunction(functions, predicate, label) {
  const matches = functions.filter(predicate);
  assert.equal(matches.length, 1, `${label}: expected one semantic owner, found ${matches.map((item) => item.name).join(', ') || 'none'}`);
  return matches[0];
}

function jsonOperations(body, summaryFunction = '') {
  const operations = [];
  const summaryPattern = summaryFunction
    ? new RegExp(`\\b${escapeRegex(summaryFunction)}\\s+([a-z_][a-z0-9_]*)\\b`)
    : null;
  let depth = 0;
  for (const line of body.split(/\r?\n/)) {
    if (/\bjson_close_object\b/.test(line))
      depth = Math.max(0, depth - 1);
    const summary = summaryPattern?.exec(line);
    if (summary && depth === 0)
      operations.push({ type: 'object', key: summary[1], depth, line });
    const operation = /\bjson_add_(boolean|string|int|double|object|array)\s+([a-z_][a-z0-9_]*)\b/.exec(line);
    if (!operation)
      continue;
    operations.push({ type: operation[1], key: operation[2], depth, line });
    if (operation[1] === 'object')
      depth += 1;
  }
  return operations;
}

function topLevelJsonKeys(body, summaryFunction = '') {
  return jsonOperations(body, summaryFunction)
    .filter((operation) => operation.depth === 0)
    .map((operation) => operation.key);
}

function envelopeDataSchemas(functions, beginFunction, endFunction, summaryFunction) {
  const beginPattern = new RegExp(`\\b${escapeRegex(beginFunction)}\\b`);
  const endPattern = new RegExp(`\\b${escapeRegex(endFunction)}\\b`);
  const summaryPattern = new RegExp(`\\b${escapeRegex(summaryFunction)}\\s+([a-z_][a-z0-9_]*)\\b`);
  const schemas = [];
  for (const owner of functions) {
    let keys = null;
    let depth = 0;
    for (const line of owner.body.split(/\r?\n/)) {
      if (keys === null) {
        if (beginPattern.test(line)) {
          keys = [];
          depth = 0;
        }
        continue;
      }
      if (endPattern.test(line)) {
        schemas.push({ owner: owner.name, keys });
        keys = null;
        continue;
      }
      if (/\bjson_close_object\b/.test(line))
        depth = Math.max(0, depth - 1);
      const summary = summaryPattern.exec(line);
      if (summary && depth === 0)
        keys.push(summary[1]);
      const operation = /\bjson_add_(?:boolean|string|int|double|object|array)\s+([a-z_][a-z0-9_]*)\b/.exec(line);
      if (!operation)
        continue;
      if (depth === 0)
        keys.push(operation[1]);
      if (/\bjson_add_object\b/.test(line))
        depth += 1;
    }
  }
  return schemas;
}

function assertSchema(schemas, expected, label) {
  assert.equal(
    schemas.some((schema) => JSON.stringify(schema.keys) === JSON.stringify(expected)),
    true,
    `${label} JSON key schema is absent or not exact`,
  );
}

function discoverBackend(source) {
  const functions = shellFunctions(source);
  const envelopeBegin = singleFunction(
    functions,
    (item) => JSON.stringify(topLevelJsonKeys(item.body)) === JSON.stringify(['ok', 'code', 'message', 'data']),
    'standard envelope builder',
  );
  const envelopeEnd = singleFunction(
    functions,
    (item) => /\bjson_close_object\b/.test(item.body) && /\bjson_dump\b/.test(item.body) && /printf ['"]\\n/.test(item.body),
    'standard envelope terminator',
  );
  const summary = singleFunction(
    functions,
    (item) => JSON.stringify(topLevelJsonKeys(item.body)) === JSON.stringify(summaryKeys),
    'summary serializer',
  );
  const schemas = envelopeDataSchemas(functions, envelopeBegin.name, envelopeEnd.name, summary.name);
  return { functions, envelopeBegin, envelopeEnd, summary, schemas };
}

function rpcMethodSchemaTests() {
  const rpcd = read(rpcdPath);
  const advertised = rpcd.match(/\nlist\)\n\s*printf '(\{[^'\n]+\})\\n'/)?.[1];
  assert.ok(advertised, 'rpcd list response is not statically extractable');
  const methods = JSON.parse(advertised);
  for (const [method, keys] of Object.entries(phase5Schemas)) {
    assert.ok(Object.hasOwn(methods, method), `${method} is not advertised`);
    assert.deepEqual(Object.keys(methods[method]).sort(), [...keys].sort(), `${method} parameter names`);
  }
  const advertisedPhase5 = Object.keys(methods).filter((method) => method.startsWith('script_')).sort();
  assert.deepEqual(advertisedPhase5, Object.keys(phase5Schemas).sort(), 'fixed Phase 5 method list');
  const serialized = JSON.stringify(Object.fromEntries(advertisedPhase5.map((name) => [name, methods[name]])));
  assert.equal(/"(?:url|path)"/.test(serialized), false, 'client URL/path parameter is exposed');
  for (const method of advertisedPhase5)
    assert.match(rpcd, new RegExp(`(?:^|\\|)\\s*${method}\\s*(?:\\||\\))`, 'm'), `${method} is not dispatched`);
  assert.match(rpcd, /exec \/usr\/libexec\/multilogin-script rpc "\$2"/);
  pass('fixed RPC method list, exact parameters, and no client URL/path');
}

function policyLoadAndRequestTests() {
  assert.ok(fs.existsSync(policyPath), 'source-only policy library is missing');
  const loadDirectory = fs.mkdtempSync(path.join(temporaryRoot, 'load.'));
  const before = fs.readdirSync(loadDirectory);
  const loaded = run('/bin/sh', ['-c', '. "$1"', 'policy-load', policyPath], { cwd: loadDirectory });
  assert.equal(loaded.status, 0, `policy load failed: ${loaded.stderr}`);
  assert.equal(loaded.stdout, ''); assert.equal(loaded.stderr, ''); assert.deepEqual(fs.readdirSync(loadDirectory), before, 'policy load created files');

  for (const [method, keys] of Object.entries(phase5Schemas)) {
    assert.equal(callPolicy('ml_policy_request_fields', [method, keys.join(' ')]), 'ok', `${method} exact fields`);
    assert.equal(callPolicy('ml_policy_request_fields', [method, [...keys, 'url'].sort().join(' ')]), 'invalid_request', `${method} client URL`);
    assert.equal(callPolicy('ml_policy_request_fields', [method, [...keys, 'path'].sort().join(' ')]), 'invalid_request', `${method} client path`);
    if (keys.length > 0)
      assert.equal(callPolicy('ml_policy_request_fields', [method, keys.slice(1).join(' ')]), 'invalid_request', `${method} missing field`);
  }
  assert.equal(callPolicy('ml_policy_request_fields', ['script_unknown', '']), 'invalid_request');
  pass('policy library has no load side effects and rejects unknown/missing/URL/path fields');
}

function semverAndRelationTests() {
  const comparisons = [
    ['1.0.0', '1.0.0', '0'], ['1.2.3', '1.2.4', '-1'], ['2.0.0', '1.9.9', '1'],
    ['3.0.0-rc.1', '3.0.0', '-1'], ['1.0.0-alpha', '1.0.0-beta', '-1'],
    ['1.0.0-alpha.2', '1.0.0-alpha.10', '-1'], ['1.0.0-alpha.1', '1.0.0-alpha.beta', '-1'],
    ['1.0.0+build.1', '1.0.0+build.2', '0'],
  ];
  for (const [left, right, expected] of comparisons)
    assert.equal(callPolicy('ml_policy_semver_compare', [left, right]), expected, `${left} versus ${right}`);
  for (const invalid of ['', '1', '1.2', '1.2.3.4', '01.2.3', '1.02.3', '1.2.03', '1.0.0-alpha.01', 'v1.2.3'])
    assert.equal(callPolicy('ml_policy_semver_compare', [invalid, '1.0.0']), 'invalid', `invalid SemVer ${invalid}`);

  const relations = [
    ['1.0.0', '1.0.0', hashA, hashA, 'identical'],
    ['1.0.0', '1.1.0', hashA, hashB, 'newer'],
    ['2.0.0', '1.9.0', hashA, hashB, 'older'],
    ['1.0.0', '1.0.0', hashA, hashB, 'same_version_changed'],
    ['invalid', '1.0.0', hashA, hashB, 'unknown'],
    ['1.0.0', 'invalid', hashA, hashB, 'unknown'],
  ];
  for (const [active, remote, activeHash, remoteHash, expected] of relations)
    assert.equal(callPolicy('ml_policy_relation', [active, remote, activeHash, remoteHash]), expected);
  pass('SemVer precedence and identical/newer/older/same-version-changed/unknown relations');
}

function validationAndTransitionTests() {
  for (const value of ['0', '1', '42']) assert.equal(callPolicy('ml_policy_generation', [value, value]), 'ok');
  assert.equal(callPolicy('ml_policy_generation', ['2', '3']), 'conflict');
  for (const invalid of ['-1', '1.5', 'x', '']) assert.equal(callPolicy('ml_policy_generation', [invalid, '0']), 'invalid_request');
  for (const value of ['true', 'false']) assert.equal(callPolicy('ml_policy_boolean', [value]), 'ok');
  for (const value of ['1', '0', 'TRUE', 'yes', '']) assert.equal(callPolicy('ml_policy_boolean', [value]), 'invalid_request');

  const transitions = [
    ['stage', 'none', '', hashA, 'ok'], ['stage', 'staged', hashA, hashA, 'no_change'], ['stage', 'validated', hashA, hashA, 'no_change'], ['stage', 'staged', hashA, hashB, 'ok'],
    ['validate', 'staged', hashA, hashA, 'ok'], ['validate', 'draft', hashA, hashA, 'ok'], ['validate', 'validated', hashA, hashA, 'no_change'], ['validate', 'staged', hashA, hashB, 'conflict'],
    ['activate', 'validated', hashA, hashA, 'no_change'], ['activate', 'validated', hashA, hashB, 'ok'], ['activate', 'active', hashA, hashA, 'invalid_state'], ['activate', 'draft', hashA, hashA, 'invalid_state'],
    ['rollback', 'available', hashA, hashA, 'no_change'], ['rollback', 'available', hashA, hashB, 'ok'], ['rollback', 'active', hashA, hashA, 'invalid_state'],
    ['restore', 'available', hashA, hashA, 'no_change'], ['restore', 'available', hashA, hashB, 'ok'], ['restore', 'active', hashA, hashA, 'invalid_state'],
    ['save_draft', 'none', '', hashA, 'ok'], ['save_draft', 'draft', hashA, hashA, 'no_change'], ['save_draft', 'validated', hashA, hashA, 'no_change'], ['save_draft', 'draft', hashA, hashB, 'ok'],
    ['discard_draft', 'draft', hashA, hashA, 'ok'], ['discard_draft', 'validated', hashA, hashA, 'ok'], ['discard_draft', 'none', '', '', 'not_found'],
  ];
  for (const [operation, status, currentHash, targetHash, expected] of transitions)
    assert.equal(callPolicy('ml_policy_transition', [operation, status, currentHash, targetHash]), expected, `${operation}/${status}`);
  for (const invalidHash of ['A'.repeat(64), 'a'.repeat(63), `${'a'.repeat(63)}z`])
    assert.equal(callPolicy('ml_policy_transition', ['validate', 'staged', invalidHash, hashA]), 'invalid_request');

  const downgrade = [
    ['candidate', '2.0.0', '1.0.0', 'false', 'confirmation_required'], ['candidate', '2.0.0', '1.0.0', 'true', 'ok'],
    ['candidate', '1.0.0', '1.0.0', 'false', 'ok'], ['candidate', '1.0.0', '2.0.0', 'false', 'ok'],
    ['custom', '2.0.0', '1.0.0', 'false', 'ok'], ['custom', '2.0.0', '1.0.0', 'true', 'ok'],
    ['last_known_good', '2.0.0', '1.0.0', 'false', 'invalid_request'], ['factory', '2.0.0', '1.0.0', 'false', 'invalid_request'],
  ];
  for (const [source, active, selected, allow, expected] of downgrade)
    assert.equal(callPolicy('ml_policy_downgrade', [source, active, selected, allow]), expected, `${source} downgrade ${allow}`);
  assert.equal(callPolicy('ml_policy_downgrade', ['candidate', '2.0.0', '1.0.0', 'yes']), 'invalid_request');
  pass('generation/hash/boolean validation, no-op/conflict transitions, and downgrade confirmations');
}

function contentAndHttpTests() {
  const contentCases = [
    ['utf8.sh', Buffer.from('#!/bin/sh\n# 管理员草稿\n', 'utf8'), 'ok'],
    ['limit.sh', Buffer.alloc(262144, 0x61), 'ok'],
    ['oversize.sh', Buffer.alloc(262145, 0x61), 'invalid_request'],
    ['empty.sh', Buffer.alloc(0), 'invalid_request'],
    ['nul.sh', Buffer.from([0x61, 0x00, 0x62]), 'invalid_request'],
    ['invalid-utf8.sh', Buffer.from([0xc3, 0x28]), 'invalid_request'],
  ];
  for (const [name, body, expected] of contentCases) {
    const file = path.join(temporaryRoot, name); write(file, body);
    assert.equal(callPolicy('ml_policy_content_file', [file]), expected, name);
  }
  assert.equal(callPolicy('ml_policy_content_file', [path.join(temporaryRoot, 'absent.sh')]), 'invalid_request');

  const httpCases = [
    ['200', rawUrl, 'ok'], ['200', `${rawUrl}?changed=1`, 'source_rejected'],
    ['301', rawUrl, 'source_rejected'], ['302', rawUrl, 'source_rejected'], ['399', rawUrl, 'source_rejected'],
    ['000', rawUrl, 'download_failed'], ['201', rawUrl, 'download_failed'], ['404', rawUrl, 'download_failed'], ['500', rawUrl, 'download_failed'],
  ];
  for (const [status, effective, expected] of httpCases)
    assert.equal(callPolicy('ml_policy_http', [status, effective]), expected, `${status} ${effective}`);
  pass('Custom UTF-8/NUL/256KiB and fixed Raw HTTP classification policy');
}

function staticSchemaAndSourceTests() {
  const backend = read(backendPath); const policy = read(policyPath);
  const discovered = discoverBackend(backend);
  const policyFunctions = shellFunctions(policy);
  assert.ok(discovered.functions.length > 0, 'backend functions are not statically discoverable');
  for (const item of discovered.functions)
    assert.match(item.name, /^ml_[a-z0-9_]+$/, `backend helper is outside the ml_ namespace: ${item.name}`);
  for (const item of policyFunctions)
    assert.match(item.name, /^(?:_ml_policy_|ml_policy_)[a-z0-9_]+$/, `policy helper is outside the policy namespace: ${item.name}`);
  assert.deepEqual(
    policyFunctions.filter((item) => !item.name.startsWith('_')).map((item) => item.name).sort(),
    [...policyApi].sort(),
    'source-only public policy API',
  );

  assert.match(backend, /^ML_RAW_URL=https:\/\/raw\.githubusercontent\.com\/Zesuy\/luci-app-multi-login\/main\/etc\/multilogin\/cqu-portal\.sh$/m);
  assert.match(backend, /^ML_LIMIT=262144$/m); assert.match(backend, /^ML_CONNECT_TIMEOUT=8$/m); assert.match(backend, /^ML_TOTAL_TIMEOUT=20$/m);
  assert.match(backend, /^ML_SELF_TEST_TIMEOUT=10$/m); assert.match(backend, /^ML_SELF_TEST_OUTPUT_LIMIT=8192$/m);
  assert.match(backend, /^ML_JOURNAL=\$ML_STATE_DIR\/activation\.journal$/m); assert.match(backend, /^ML_BACKUP=\$ML_STATE_DIR\/activation\.backup\.sh$/m);
  assert.match(backend, /^\s*ml_[a-z0-9_]+ "\$ML_ACTIVE" "\$ML_BACKUP" 0600\b/m, 'active transaction backup is not written to the fixed path at mode 0600');
  assert.deepEqual(topLevelJsonKeys(discovered.envelopeBegin.body), ['ok', 'code', 'message', 'data'], 'standard envelope schema');
  assert.deepEqual(topLevelJsonKeys(discovered.summary.body), summaryKeys, 'present summary schema');

  const literalObjects = [...backend.matchAll(/'(\{[^'\n]*\})'/g)].flatMap((match) => {
    try { return [JSON.parse(match[1])]; } catch { return []; }
  });
  const absentSummary = literalObjects.find((value) => value.present === false && value.status === 'none');
  assert.ok(absentSummary, 'absent summary serialization is missing');
  assert.deepEqual(Object.keys(absentSummary), summaryKeys, 'absent summary schema');
  assert.deepEqual(absentSummary, { present: false, status: 'none', source: 'unknown', mode: 'none', version: '', api: 0, sha256: '' });

  const stateBuilder = singleFunction(
    discovered.functions,
    (item) => JSON.stringify(topLevelJsonKeys(item.body, discovered.summary.name)) === JSON.stringify(stateKeys),
    'durable state serializer',
  );
  const journalBuilder = singleFunction(
    discovered.functions,
    (item) => JSON.stringify(topLevelJsonKeys(item.body, discovered.summary.name)) === JSON.stringify(journalKeys),
    'activation journal serializer',
  );
  assert.deepEqual(topLevelJsonKeys(stateBuilder.body, discovered.summary.name), stateKeys, 'durable state schema');
  assert.deepEqual(topLevelJsonKeys(journalBuilder.body, discovered.summary.name), journalKeys, 'activation journal schema');

  for (const schema of [
    ['raw_url', 'generation', 'mode', 'recovery_required', 'active', 'factory', 'candidate', 'last_known_good', 'custom', 'preserved'],
    ['available', 'downgrade', 'relation', 'active_sha256', 'remote'], ['generation', 'candidate'],
    ['generation', 'source', 'summary', 'validation'], ['generation', 'mode', 'active', 'validation'],
    ['generation', 'source', 'summary', 'content'], ['generation', 'custom'],
    ['generation', 'sha256'], ['generation', 'recovery_required'], ['generation'], [],
  ]) assertSchema(discovered.schemas, schema, `method data ${schema.join('/') || 'empty'}`);

  const validationSchemas = discovered.functions.flatMap((item) =>
    [...item.body.matchAll(/json_add_object validation\b([\s\S]*?)json_close_object/g)]
      .map((match) => topLevelJsonKeys(match[1])));
  assert.ok(validationSchemas.some((schema) => JSON.stringify(schema) === JSON.stringify(['self_test'])), 'validate result schema is absent');
  assert.ok(validationSchemas.some((schema) => JSON.stringify(schema) === JSON.stringify(['self_test', 'status'])), 'activation validation schema is absent');

  for (const value of ['active', 'available', 'none', 'staged', 'validated', 'draft', 'factory', 'raw', 'custom', 'unknown', 'managed'])
    assert.ok(backend.includes(value) || policy.includes(value), `summary enum ${value} is absent`);
  for (const value of ['prepared', 'active_replaced', 'verified', 'rollback_required', 'activate', 'rollback', 'restore', 'candidate', 'last_known_good'])
    assert.ok(backend.includes(value), `journal enum ${value} is absent`);
  for (const code of ['ok', 'no_change', 'invalid_request', 'conflict', 'not_found', 'invalid_state', 'download_failed', 'source_rejected', 'confirmation_required', 'validation_failed', 'activation_failed', 'recovery_required', 'internal_error'])
    assert.ok(backend.includes(code) || policy.includes(code), `stable result code ${code} is absent`);

  const infoSchema = discovered.schemas.find((schema) => JSON.stringify(schema.keys) === JSON.stringify([
    'raw_url', 'generation', 'mode', 'recovery_required', 'active', 'factory', 'candidate', 'last_known_good', 'custom', 'preserved',
  ]));
  assert.ok(infoSchema, 'script_info semantic owner is absent');
  const infoOwner = discovered.functions.find((item) => item.name === infoSchema.owner);
  assert.equal(infoOwner.body.includes('json_add_string content'), false, 'script_info exposes source content');

  const contentEmitters = discovered.functions.filter((item) => /\bjson_add_string content\b/.test(item.body));
  assert.equal(contentEmitters.length, 1, 'script source is exposed outside the single draft response');
  assert.match(contentEmitters[0].body, /cat "\$ML_CUSTOM"/, 'draft response does not read the Custom draft');
  assert.match(contentEmitters[0].body, /json_add_string source draft\b/, 'draft source is not explicitly identified');
  assert.doesNotMatch(contentEmitters[0].body, /\$ML_(?:ACTIVE|FACTORY|LKG|CANDIDATE|PRESERVED)\b/, 'non-draft source is exposed by the draft response');

  const metadata = singleFunction(
    discovered.functions,
    (item) => item.body.includes('MULTILOGIN_SCRIPT_API=3') && item.body.includes('MULTILOGIN_SCRIPT_VERSION='),
    'anchored metadata parser',
  );
  const secureFile = singleFunction(
    discovered.functions,
    (item) => /stat -c ['"]%a %u %g['"]/.test(item.body) && item.body.includes('expected'),
    'secure regular-file predicate',
  );
  const staticAcceptance = singleFunction(
    discovered.functions,
    (item) => item.body.includes('ml_policy_content_file') && /\/bin\/sh -n\b/.test(item.body),
    'static source acceptance',
  );
  assert.match(staticAcceptance.body, new RegExp(`\\b${escapeRegex(secureFile.name)}\\b`), 'static acceptance omits secure regular-file/mode checks');
  assert.match(staticAcceptance.body, new RegExp(`\\b${escapeRegex(metadata.name)}\\b`), 'static acceptance omits anchored metadata parsing');
  assert.match(staticAcceptance.body, /\/bin\/sh -n "\$file"/, 'static acceptance omits shell syntax validation');
  singleFunction(discovered.functions, (item) => /\bsha256sum\b/.test(item.body), 'SHA-256 implementation');

  const selfTest = singleFunction(
    discovered.functions,
    (item) => item.body.includes('ML_SELF_TEST_TIMEOUT') && /\bself-test\b/.test(item.body),
    'bounded self-test validator',
  );
  const validateOwner = singleFunction(
    discovered.functions,
    (item) => item.body.includes('ML_REQ_CONFIRM_EXECUTE') && item.body.includes(staticAcceptance.name) && item.body.includes(selfTest.name),
    'executable validation decision',
  );
  const confirmationAt = validateOwner.body.indexOf('ML_REQ_CONFIRM_EXECUTE');
  const staticAt = validateOwner.body.indexOf(staticAcceptance.name, confirmationAt);
  const executionAt = validateOwner.body.indexOf(selfTest.name, staticAt);
  assert.ok(confirmationAt >= 0 && staticAt > confirmationAt && executionAt > staticAt, 'confirmation and static acceptance do not precede self-test execution');

  const rawFetch = singleFunction(
    discovered.functions,
    (item) => /\bcurl\b/.test(item.body) && item.body.includes('$ML_RAW_URL') && item.body.includes('ML_CONNECT_TIMEOUT'),
    'fixed Raw fetch',
  );
  assert.doesNotMatch(rawFetch.body, /--location|(?:^|\s)-L(?:\s|$)/m, 'Raw fetch follows redirects');
  assert.match(rawFetch.body, /--proto ['"]=https['"]/, 'Raw fetch is not HTTPS-only');
  assert.match(rawFetch.body, /--connect-timeout "\$ML_CONNECT_TIMEOUT"/);
  assert.match(rawFetch.body, /--max-time "\$ML_TOTAL_TIMEOUT"/);
  assert.match(rawFetch.body, /--max-filesize "\$ML_LIMIT"/);
  pass('namespaced backend/policy, exact schemas, source exposure, and static Raw rules');
}

function actionEnvelopeCompatibilityTests() {
  const rpcd = read(rpcdPath);
  const emitter = singleFunction(
    shellFunctions(rpcd),
    (item) => item.body.includes('json_add_int legacy_code') && item.body.includes('json_add_int exit_code'),
    'D-011 action response emitter',
  );
  const operations = jsonOperations(emitter.body);
  assert.deepEqual(operations.filter((item) => item.depth === 0).slice(0, 4).map((item) => item.key), ['ok', 'code', 'message', 'data'], 'action standard envelope prefix');
  const topCode = operations.filter((item) => item.depth === 0 && item.key === 'code');
  assert.equal(topCode.length, 1, 'action emitter has duplicate or ambiguous top-level code');
  assert.equal(topCode[0].type, 'string', 'authoritative action code is not a string');
  const exitCode = operations.find((item) => item.depth === 1 && item.key === 'exit_code');
  assert.ok(exitCode, 'legacy numeric exit is not exposed as data.exit_code');
  const numericVariable = /\$([A-Za-z_][A-Za-z0-9_]*)/.exec(exitCode.line)?.[1];
  assert.ok(numericVariable, 'data.exit_code is not tied to a numeric action result');
  const numericUses = operations.filter((item) => item.type === 'int' && item.line.includes(`$${numericVariable}`));
  assert.deepEqual(numericUses.map((item) => [item.depth, item.key]), [[1, 'exit_code'], [0, 'legacy_code']], 'legacy numeric exit appears outside data.exit_code/legacy_code');
  pass('D-011 action envelope keeps string code and isolates the legacy numeric exit');
}

function transactionOrderingTests() {
  const backend = read(backendPath);
  const discovered = discoverBackend(backend);
  const stateBuilder = singleFunction(
    discovered.functions,
    (item) => JSON.stringify(topLevelJsonKeys(item.body, discovered.summary.name)) === JSON.stringify(stateKeys),
    'durable state serializer',
  );
  const stateWriter = singleFunction(
    discovered.functions,
    (item) => item.body.includes(stateBuilder.name) && item.body.includes('$ML_STATE') && item.body.includes('0600'),
    'durable state writer',
  );
  const atomicCopy = singleFunction(
    discovered.functions,
    (item) => item.body.includes('cat "$source" >"$temporary"') && item.body.includes('mv -f "$temporary" "$target"'),
    'atomic file copier',
  );
  const summaryMatcher = singleFunction(
    discovered.functions,
    (item) => item.body.includes('summary=') && item.body.includes('file=') && item.body.includes('expected=') && item.body.includes('actual=') && item.body.includes('sha256'),
    'durable summary/file verifier',
  );
  const clearTransaction = singleFunction(
    discovered.functions,
    (item) => item.body.includes('rm -f "$ML_JOURNAL"') && item.body.includes('rm -f "$ML_BACKUP"'),
    'transaction cleanup',
  );
  const activation = singleFunction(
    discovered.functions,
    (item) => item.body.includes('prepared') && item.body.includes('active_replaced') && item.body.includes('verified') && item.body.includes('ML_STATUS_RESULT'),
    'activation transaction',
  );
  const recovery = singleFunction(
    discovered.functions,
    (item) => item.body.includes('journal_generation + 1') && item.body.includes('rollback_required') && item.body.includes('$ML_BACKUP'),
    'journal recovery reducer',
  );

  assert.doesNotMatch(backend, /(?:\/tmp\/)?lkg-old|old_lkg_backup/, 'activation retains the obsolete temporary old-LKG workaround');
  const generation = /([A-Za-z_][A-Za-z0-9_]*)=\$\(\(ML_GENERATION \+ 1\)\)/.exec(activation.body);
  assert.ok(generation, 'activation does not derive the next durable generation');
  const generationAt = activation.body.indexOf(generation[0]);
  const stateCommitAt = activation.body.indexOf(stateWriter.name, generationAt);
  const stateCommitLine = activation.body.slice(stateCommitAt).split(/\r?\n/, 1)[0];
  assert.ok(stateCommitAt > generationAt && stateCommitLine.includes(`$${generation[1]}`), 'activation does not commit generation+1 durable state first');
  const backupToLkgPattern = new RegExp(`\\b${escapeRegex(atomicCopy.name)}\\s+"\\$ML_BACKUP"\\s+"\\$ML_LKG"\\s+0600\\b`);
  const backupToLkgRelative = activation.body.slice(stateCommitAt).search(backupToLkgPattern);
  assert.ok(backupToLkgRelative > 0, 'activation does not materialize LKG from the transaction backup after the state commit');
  const backupToLkgAt = stateCommitAt + backupToLkgRelative;
  const activationClearAt = activation.body.indexOf(clearTransaction.name, backupToLkgAt);
  assert.ok(activationClearAt > backupToLkgAt, 'activation clears its journal before materializing LKG');

  const journalRemoveAt = clearTransaction.body.indexOf('rm -f "$ML_JOURNAL"');
  const backupRemoveAt = clearTransaction.body.indexOf('rm -f "$ML_BACKUP"');
  assert.ok(journalRemoveAt >= 0 && backupRemoveAt > journalRemoveAt, 'transaction cleanup is not journal-first');
  const committedAt = recovery.body.indexOf('journal_generation + 1');
  const recoveryCopyRelative = recovery.body.slice(committedAt).search(backupToLkgPattern);
  assert.ok(recoveryCopyRelative > 0, 'committed recovery does not materialize durable LKG from the activation backup');
  const recoveryCopyAt = committedAt + recoveryCopyRelative;
  const durableVerifyPattern = new RegExp(`\\b${escapeRegex(summaryMatcher.name)}\\s+"\\$ML_STATE_LKG"\\s+"\\$ML_LKG"\\s+600\\b`);
  const durableVerifyRelative = recovery.body.slice(recoveryCopyAt).search(durableVerifyPattern);
  assert.ok(durableVerifyRelative > 0, 'committed recovery does not verify LKG against the new durable summary');
  const durableVerifyAt = recoveryCopyAt + durableVerifyRelative;
  const recoveryClearAt = recovery.body.indexOf(clearTransaction.name, durableVerifyAt);
  assert.ok(recoveryClearAt > durableVerifyAt, 'committed recovery clears its journal before LKG verification');
  pass('state-first activation and committed-recovery LKG ordering');
}

function recoveryAndOwnershipTests() {
  const backend = read(backendPath); const init = read(initPath); const makefile = read(path.join(repository, 'Makefile'));
  const discovered = discoverBackend(backend);
  const recovery = singleFunction(
    discovered.functions,
    (item) => item.body.includes('journal_generation + 1') && item.body.includes('rollback_required') && item.body.includes('$ML_BACKUP'),
    'journal recovery reducer',
  );
  const dispatcher = singleFunction(
    discovered.functions,
    (item) => item.body.includes('case $method in') && item.body.includes(recovery.name) && Object.keys(phase5Schemas).every((method) => item.body.includes(method)),
    'script RPC dispatcher',
  );
  const infoSchema = discovered.schemas.find((schema) => schema.keys[0] === 'raw_url');
  assert.ok(infoSchema, 'script_info handler schema is absent');
  const infoOwner = discovered.functions.find((item) => item.name === infoSchema.owner);
  const recoverAt = init.indexOf('/usr/libexec/multilogin-script recover'); const controllerAt = init.indexOf('procd_set_param command');
  assert.ok(recoverAt >= 0 && controllerAt > recoverAt, 'init does not recover before controller start');
  assert.match(infoOwner.body, new RegExp(`\\b${escapeRegex(recovery.name)}\\b`), 'script_info does not attempt the common recovery reducer');
  const infoAt = dispatcher.body.indexOf('script_info');
  const commonRecoveryAt = dispatcher.body.indexOf(recovery.name, infoAt);
  const dispatchAt = dispatcher.body.indexOf('case $method in', commonRecoveryAt);
  assert.ok(infoAt >= 0 && commonRecoveryAt > infoAt && dispatchAt > commonRecoveryAt, 'non-info RPC dispatch is not blocked behind common recovery');

  const entrypoint = backend.slice(backend.lastIndexOf('\ncase ${1:-} in'));
  assert.ok(entrypoint, 'fixed backend CLI entrypoint is absent');
  const cliModes = [...entrypoint.matchAll(/^([a-z][a-z0-9_-]*)\)$/gm)].map((match) => match[1]);
  assert.deepEqual(cliModes, ['recover', 'rpc'], 'backend exposes CLI modes beyond recover/rpc');
  assert.match(entrypoint, new RegExp(`recover\\)[\\s\\S]*?\\b${escapeRegex(recovery.name)}\\b`), 'recover CLI does not call the common reducer');
  assert.match(entrypoint, new RegExp(`rpc\\)[\\s\\S]*?\\b${escapeRegex(dispatcher.name)}\\b`), 'rpc CLI does not call the fixed dispatcher');
  assert.doesNotMatch(backend, /policy-(?:semver|relation|request|transition|generation|bool|http|content|downgrade)\)/);
  assert.match(backend, /^\. \/usr\/lib\/multilogin\/script-policy\.sh \|\| exit 1$/m);
  assert.match(makefile, /\$\(INSTALL_DATA\) \.\/root\/usr\/lib\/multilogin\/script-policy\.sh \$\(1\)\/usr\/lib\/multilogin\//);
  assert.match(makefile, /\$\(INSTALL_BIN\) \.\/root\/usr\/libexec\/multilogin-script \$\(1\)\/usr\/libexec\//);
  assert.doesNotMatch(makefile, /multilogin-script .*\/etc\/multilogin/);
  assert.match(makefile, /cqu-portal\.sh \$\(1\)\/usr\/lib\/multilogin\/cqu-portal\.factory\.sh/);
  assert.doesNotMatch(makefile, /cqu-portal\.sh \$\(1\)\/etc\/multilogin/);
  pass('init recovery ordering, RPC blocking, source-only policy ownership, and package boundaries');
}

rpcMethodSchemaTests();
policyLoadAndRequestTests();
semverAndRelationTests();
validationAndTransitionTests();
contentAndHttpTests();
staticSchemaAndSourceTests();
actionEnvelopeCompatibilityTests();
transactionOrderingTests();
recoveryAndOwnershipTests();
process.stdout.write(`${checks} Phase 5 static/pure checks passed.\n`);

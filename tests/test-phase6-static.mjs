#!/usr/bin/env node
/* Phase 6 source/static and extracted pure-state checks; no DOM or RPC execution. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const tests = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(tests, '..');
const viewPath = path.join(repository, 'htdocs/luci-static/resources/view/multilogin/script.js');
const aclPath = path.join(repository, 'root/usr/share/rpcd/acl.d/luci-app-multi-login.json');
const source = fs.readFileSync(viewPath, 'utf8');
const acl = JSON.parse(fs.readFileSync(aclPath, 'utf8'))['luci-app-multi-login'];
const rpcSchemas = Object.freeze({
  script_info: [],
  script_check: [],
  script_stage: ['expected_generation'],
  script_validate: ['source', 'expected_sha256', 'expected_generation', 'confirm_execute'],
  script_activate: ['source', 'expected_sha256', 'expected_generation', 'confirm_activate', 'allow_downgrade'],
  script_rollback: ['expected_sha256', 'expected_generation', 'confirm_activate'],
  script_restore: ['expected_sha256', 'expected_generation', 'confirm_activate'],
  script_get_draft: [],
  script_save_draft: ['content', 'base_sha256', 'expected_generation'],
  script_discard_draft: ['expected_sha256', 'expected_generation'],
});
const readMethods = ['script_check', 'script_get_draft', 'script_info'];
const writeMethods = ['script_activate', 'script_discard_draft', 'script_restore', 'script_rollback', 'script_save_draft', 'script_stage', 'script_validate'];
let checks = 0;

function pass(label) {
  checks += 1;
  process.stdout.write(`PASS  phase6-static: ${label}\n`);
}

function functionSource(name) {
  const marker = `function ${name}(`;
  const start = source.indexOf(marker);
  assert.ok(start >= 0, `${name} function is absent`);
  const brace = source.indexOf('{', start);
  let depth = 0;
  for (let index = brace; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  assert.fail(`${name} function is not balanced`);
}

function rpcDeclarations() {
  const declarations = [];
  for (const match of source.matchAll(/var\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*rpc\.declare\(\{([\s\S]*?)\n\}\);/g)) {
    const body = match[2];
    const object = /\bobject:\s*'([^']+)'/.exec(body)?.[1];
    const method = /\bmethod:\s*'([^']+)'/.exec(body)?.[1];
    const parameters = /\bparams:\s*\[([^\]]*)\]/.exec(body)?.[1]
      .match(/'([^']+)'/g)?.map((value) => value.slice(1, -1)) ?? [];
    declarations.push({ variable: match[1], object, method, parameters, end: match.index + match[0].length });
  }
  return declarations;
}

function rpcAndBoundaryTests() {
  const declarations = rpcDeclarations();
  assert.deepEqual(declarations.map((item) => item.method).sort(), Object.keys(rpcSchemas).sort(), 'exact script RPC method family');
  for (const declaration of declarations) {
    assert.equal(declaration.object, 'multilogin', `${declaration.method} RPC object`);
    assert.deepEqual(declaration.parameters, rpcSchemas[declaration.method], `${declaration.method} parameter order`);
    assert.equal(declaration.parameters.some((name) => name === 'url' || name === 'path'), false, `${declaration.method} accepts URL/path`);
  }

  assert.deepEqual([...source.matchAll(/^'require ([^']+)';$/gm)].map((match) => match[1]).sort(), ['rpc', 'view'], 'view dependency surface');
  assert.doesNotMatch(source, /\b(?:fs|form|uci)\s*\./, 'view uses direct fs/form/uci API');
  assert.doesNotMatch(source, /setInitAction|callInitAction|ui\.changes|\bchmod\b|login_A\.sh|login_huxi\.sh|_apply_template|_template_type/, 'view retains direct template/chmod/init flow');
  assert.doesNotMatch(source, /(?:\/etc\/multilogin|\/usr\/lib\/multilogin|\/bin\/|https?:\/\/|raw\.githubusercontent\.com)/, 'view embeds a client path or URL');
  assert.equal(declarations.some((item) => item.object === 'service' || item.object === 'file' || item.object === 'luci'), false, 'view declares broad service/file/luci RPC');

  const contentReads = [...source.matchAll(/\b([A-Za-z_][A-Za-z0-9_.]*)\.data\.content\b/g)].map((match) => match[1]);
  assert.ok(contentReads.length > 0, 'Custom draft content is never loaded into the editor');
  assert.equal(contentReads.every((owner) => /draft/i.test(owner)), true, `non-draft source content is read: ${contentReads.join(', ')}`);
  assert.doesNotMatch(source, /\b(?:active|factory|candidate|last_known_good|preserved|remote)\s*(?:\.|\[['"])content\b/i, 'non-draft script source is exposed');
  pass('exact fixed RPC surface and no direct browser file/service/path access');
}

function aclTests() {
  assert.ok(acl && acl.read && acl.write, 'MultiLogin ACL sections are absent');
  const readScriptMethods = (acl.read.ubus?.multilogin ?? []).filter((method) => method.startsWith('script_')).sort();
  const writeScriptMethods = (acl.write.ubus?.multilogin ?? []).filter((method) => method.startsWith('script_')).sort();
  assert.deepEqual(readScriptMethods, readMethods, 'read-only script RPC ACL split');
  assert.deepEqual(writeScriptMethods, writeMethods, 'mutating/executing script RPC ACL split');
  for (const access of [acl.read, acl.write]) {
    const files = access.file ?? [];
    assert.equal(files.some((grant) => grant.startsWith('/etc/multilogin/')), false, 'ACL retains direct /etc/multilogin file access');
    assert.equal(files.some((grant) => /(?:login|portal).*\.sh/i.test(grant)), false, 'ACL retains a script file grant');
    assert.equal(Object.hasOwn(access.ubus ?? {}, 'file'), false, 'ACL retains ubus file methods');
  }
  pass('ACL removes direct script grants and splits read/write methods exactly');
}

function conflictAndBusyTests() {
  const helper = functionSource('preserveConflictDraft');
  const preserveConflictDraft = Function('_', 'actionError', `${helper}; return preserveConflictDraft;`)(
    (value) => value,
    (response) => `error:${response?.code ?? 'missing'}`,
  );
  const original = { draftText: 'typed-but-unsaved', draftBaseHash: 'old-base' };
  const conflict = preserveConflictDraft(original, { ok: false, code: 'conflict' });
  assert.equal(conflict.conflict, true);
  assert.equal(conflict.draftText, original.draftText, 'conflict replaces typed text');
  assert.equal(original.draftBaseHash, 'old-base', 'conflict helper mutates the old base hash');
  assert.match(conflict.message, /retained|Reload|保留|重新载入/i);
  const other = preserveConflictDraft(original, { ok: false, code: 'invalid_state' });
  assert.equal(other.draftText, original.draftText, 'ordinary failure replaces typed text');

  const runner = functionSource('runAction');
  const refresh = functionSource('refresh');
  assert.match(runner, /if\s*\(state\.busy\)\s*return/, 'busy actions are not rejected');
  assert.match(runner, /state\.busy\s*=\s*true/, 'action does not enter busy state');
  assert.match(runner, /state\.busy\s*=\s*false/, 'action does not leave busy state');
  assert.match(runner, /preserveConflictDraft[\s\S]*?refresh\(\{\s*preserveTypedDraft:\s*true\s*\}\)/, 'failure refresh does not explicitly preserve typed text and its base');
  assert.match(refresh, /if\s*\(!preserveTypedDraft\s*\|\|\s*updateDraftBase\)[\s\S]*?state\.draftBaseHash\s*=/, 'refresh can silently advance the base while preserving typed text');
  assert.match(source, /state\.busy\s*\|\|\s*!state\.info\.ok|disabled\s*=\s*state\.busy/, 'busy state does not disable actions');
  assert.match(source, /callScriptSaveDraft[\s\S]{0,300}updateDraftBase:\s*true/, 'successful save cannot adopt the returned draft base');
  pass('pure conflict preservation, success-only base adoption, and duplicate-action blocking');
}

function savedDraftSafetyTests() {
  const savedPredicateSource = functionSource('customDraftIsSaved');
  const makeSavedPredicate = (state, typedText) => Function(
    'state',
    'getDraftText',
    `${savedPredicateSource}; return customDraftIsSaved;`,
  )(state, () => typedText);
  assert.equal(makeSavedPredicate({ conflict: false, savedDraftText: 'saved' }, 'saved')(), true, 'matching saved Custom text is rejected');
  assert.equal(makeSavedPredicate({ conflict: false, savedDraftText: 'saved' }, 'typed')(), false, 'unsaved displayed text can validate/activate');
  assert.equal(makeSavedPredicate({ conflict: true, savedDraftText: 'saved' }, 'saved')(), false, 'conflicted Custom text can validate/activate');

  assert.match(source, /savedDraftText:\s*initialDraft\.ok\s*\?/, 'latest saved draft text is not initialized from script_get_draft');
  const refresh = functionSource('refresh');
  assert.match(refresh, /state\.savedDraftText\s*=\s*state\.draft\.data\.content/, 'successful draft refresh/save/reload does not update savedDraftText');
  const runner = functionSource('runAction');
  assert.match(runner, /state\.conflict\s*=\s*state\.conflict\s*\|\|\s*failure\.conflict/, 'unrelated failures clear a sticky conflict');

  for (const callPattern of [
    /callScriptValidate\('custom'/g,
    /callScriptActivate\('custom'/g,
  ]) {
    const call = [...source.matchAll(callPattern)][0];
    assert.ok(call, `Custom safety call is absent: ${callPattern}`);
    assert.match(source.slice(Math.max(0, call.index - 500), call.index), /requireCustomDraftSaved\(\)/, 'Custom validate/activate bypasses saved-text equality');
  }
  for (const callPattern of [
    /callScriptValidate\('custom'/g,
    /callScriptActivate\('custom'/g,
    /callScriptDiscardDraft\(/g,
  ]) {
    const call = [...source.matchAll(callPattern)][0];
    assert.ok(call, `Custom conflict-gated call is absent: ${callPattern}`);
    assert.match(source.slice(call.index, call.index + 500), /state\.conflict/, 'conflict does not disable Custom validate/activate/discard');
  }

  const reloadCallAt = source.lastIndexOf('reloadServerDraft,');
  assert.ok(reloadCallAt >= 0, 'explicit Reload control is absent');
  assert.doesNotMatch(source.slice(reloadCallAt, source.indexOf('\n', reloadCallAt)), /state\.conflict/, 'sticky conflict disables its only Reload recovery control');
  const reload = functionSource('reloadServerDraft');
  assert.match(reload, /confirm\s*\(/, 'Reload replaces typed text without confirmation');
  assert.match(reload, /state\.conflict\s*=\s*false/, 'explicit Reload does not clear conflict');
  assert.equal((source.match(/state\.conflict\s*=\s*false/g) ?? []).length, 1, 'an operation other than explicit Reload clears sticky conflict');
  pass('saved-text equality and sticky-conflict fail-closed Custom actions');
}

function reloadAndRetryFailureTests() {
  const reload = functionSource('reloadServerDraft');
  const reloadExpression = /var\s+draftReloaded\s*=\s*([^;]+);/.exec(reload)?.[1];
  assert.ok(reloadExpression, 'Reload success decision is not statically extractable');
  const draftReloaded = Function('state', `return Boolean(${reloadExpression});`);
  assert.equal(draftReloaded({ draft: { ok: true, code: 'ok' } }), true, 'successful get_draft cannot clear conflict');
  assert.equal(draftReloaded({ draft: { ok: false, code: 'not_found' } }), true, 'confirmed absent draft cannot clear conflict');
  assert.equal(draftReloaded({ draft: { ok: false, code: 'offline' } }), false, 'offline get_draft clears conflict');
  assert.equal(draftReloaded({ draft: { ok: false, code: 'internal_error' } }), false, 'internal_error get_draft clears conflict');
  assert.match(reload, /if\s*\(draftReloaded\)\s*\{[\s\S]*?state\.conflict\s*=\s*false/, 'Reload clears conflict outside its proven-success branch');
  assert.match(reload, /else\s*\{[\s\S]*?setFeedback\('error',\s*actionError\(state\.draft\)\)/, 'failed Reload overwrites its error with success feedback');

  const retry = functionSource('retryLoad');
  const infoErrorAt = retry.indexOf('!state.info.ok');
  const recoveryAt = retry.indexOf('recovery_required', infoErrorAt);
  const draftErrorAt = retry.indexOf("state.draft.code !== 'not_found'", recoveryAt);
  const successAt = retry.lastIndexOf("setFeedback('status'");
  assert.ok(infoErrorAt >= 0 && recoveryAt > infoErrorAt && draftErrorAt > recoveryAt && successAt > draftErrorAt, 'retry state precedence does not preserve info/recovery/draft errors');
  assert.match(retry.slice(infoErrorAt, successAt), /actionError\(state\.info\)/, 'retry loses info errors');
  assert.match(retry.slice(recoveryAt, successAt), /actionError\(\{\s*code:\s*'recovery_required'\s*\}\)/, 'retry loses recovery_required errors');
  assert.match(retry.slice(draftErrorAt, successAt), /actionError\(state\.draft\)/, 'retry loses draft errors');
  pass('Reload/retry preserve conflict and error precedence on failed draft loads');
}

function stateAndMetadataTests() {
  assert.match(source, /state\.check\s*=/, 'update-check response is not stored');
  assert.match(source, /state\.check[\s\S]*\b(?:relation|remote|available|downgrade)\b/, 'update-check result is not rendered');
  for (const token of ['raw_url', 'source', 'mode', 'version', 'sha256'])
    assert.match(source, new RegExp(`\\b${token}\\b`), `Managed metadata omits ${token}`);

  assert.match(source, /recovery_required/, 'recovery-required state is absent');
  assert.match(source, /recovery_required[\s\S]*disabled|disabled[\s\S]*recovery_required/, 'recovery-required does not disable actions');
  assert.match(source, /retryLoad|刷新脚本状态/, 'recovery/error state has no retry action');
  assert.match(source, /state\.busy[\s\S]*aria-busy/, 'loading/busy state is not announced');
  assert.match(source, /candidate\.present\s*\?/, 'candidate empty state is absent');
  assert.match(source, /draftMissing\s*\?/, 'draft empty state is absent');
  assert.match(source, /actionError[\s\S]*role':\s*'alert'/, 'error/recovery state is not rendered as an alert');

  assert.match(source, /preserveTypedDraft/, 'mutations have no typed-text preservation policy');
  assert.match(source, /callScriptDiscardDraft[\s\S]*preserveTypedDraft:\s*false/, 'discard does not explicitly opt into replacing editor text');
  assert.doesNotMatch(source, /callScript(?:Check|Stage|Validate|Activate|Rollback|Restore)[\s\S]{0,300}preserveTypedDraft:\s*false/, 'non-discard action erases unsaved text');
  pass('check/metadata rendering and loading/empty/error/recovery state coverage');
}

function confirmationAndAccessibilityTests() {
  for (const variable of ['callScriptValidate', 'callScriptActivate', 'callScriptRollback', 'callScriptRestore', 'callScriptDiscardDraft']) {
    const declaration = rpcDeclarations().find((item) => item.variable === variable);
    const calls = [...source.matchAll(new RegExp(`\\b${variable}\\(`, 'g'))].filter((match) => match.index > declaration.end);
    assert.ok(calls.length > 0, `${variable} is never called`);
    for (const call of calls)
      assert.match(source.slice(Math.max(0, call.index - 500), call.index), /confirm\s*\(/, `${variable} call lacks an explicit nearby confirmation`);
  }
  assert.match(source, /callScriptValidate\([^\n]+,\s*true\s*\)/, 'validate confirmation boolean is not literal true');
  assert.match(source, /callScriptActivate\([^\n]+,\s*true\s*,/, 'activate confirmation boolean is not literal true');
  assert.match(source, /root(?:-level|\s*级)/i, 'root-code execution warning is absent');

  const nativeButton = functionSource('nativeButton');
  assert.match(nativeButton, /E\('button'/, 'actions are not native buttons');
  assert.match(nativeButton, /'type':\s*'button'/, 'native action button has implicit submit semantics');
  assert.match(nativeButton, /'disabled':\s*disabled/, 'native action button ignores disabled state');
  assert.match(source, /E\('textarea'/, 'Custom editor is not a native textarea');
  assert.match(source, /'aria-live':\s*'polite'/, 'status feedback lacks aria-live');
  assert.match(source, /'aria-live':\s*'assertive'/, 'error feedback lacks assertive aria-live');
  assert.match(source, /'role':\s*'alert'/, 'error/root warning lacks alert semantics');
  assert.doesNotMatch(source, /E\('(div|span)'[^\n]+['"]click['"]\s*:/, 'non-keyboard element is used as an action');
  pass('explicit confirmations and native keyboard/live-region semantics');
}

function responsiveTests() {
  assert.match(source, /min-height:\s*44px/, 'action controls are below the 44px target');
  assert.match(source, /flex-wrap:\s*wrap/, 'action rows cannot wrap');
  assert.match(source, /min-width:\s*0/, 'flex/grid children lack overflow protection');
  assert.match(source, /script-editor[^'\n]*max-width:\s*100%/, 'textarea lacks max-width containment');
  assert.match(source, /@media\s*\(max-width:\s*375px\)/, '375px narrow breakpoint is absent');
  assert.match(source, /grid-template-columns:\s*minmax\(0,\s*1fr\)/, 'narrow metadata does not collapse to one column');
  assert.match(source, /flex:\s*1\s+1\s+100%/, 'narrow actions do not become reachable full-width controls');
  pass('44px, wrapping, overflow, textarea, and 375px static invariants');
}

rpcAndBoundaryTests();
aclTests();
conflictAndBusyTests();
savedDraftSafetyTests();
reloadAndRetryFailureTests();
stateAndMetadataTests();
confirmationAndAccessibilityTests();
responsiveTests();
process.stdout.write(`${checks} Phase 6 static/pure checks passed.\n`);

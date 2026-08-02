'use strict';
'require view';
'require rpc';

var callScriptInfo = rpc.declare({
    object: 'multilogin',
    method: 'script_info',
    expect: { '': {} }
});

var callScriptCheck = rpc.declare({
    object: 'multilogin',
    method: 'script_check',
    expect: { '': {} }
});

var callScriptStage = rpc.declare({
    object: 'multilogin',
    method: 'script_stage',
    params: ['expected_generation'],
    expect: { '': {} }
});

var callScriptValidate = rpc.declare({
    object: 'multilogin',
    method: 'script_validate',
    params: ['source', 'expected_sha256', 'expected_generation', 'confirm_execute'],
    expect: { '': {} }
});

var callScriptActivate = rpc.declare({
    object: 'multilogin',
    method: 'script_activate',
    params: ['source', 'expected_sha256', 'expected_generation', 'confirm_activate', 'allow_downgrade'],
    expect: { '': {} }
});

var callScriptRollback = rpc.declare({
    object: 'multilogin',
    method: 'script_rollback',
    params: ['expected_sha256', 'expected_generation', 'confirm_activate'],
    expect: { '': {} }
});

var callScriptRestore = rpc.declare({
    object: 'multilogin',
    method: 'script_restore',
    params: ['expected_sha256', 'expected_generation', 'confirm_activate'],
    expect: { '': {} }
});

var callScriptGetDraft = rpc.declare({
    object: 'multilogin',
    method: 'script_get_draft',
    expect: { '': {} }
});

var callScriptSaveDraft = rpc.declare({
    object: 'multilogin',
    method: 'script_save_draft',
    params: ['content', 'base_sha256', 'expected_generation'],
    expect: { '': {} }
});

var callScriptDiscardDraft = rpc.declare({
    object: 'multilogin',
    method: 'script_discard_draft',
    params: ['expected_sha256', 'expected_generation'],
    expect: { '': {} }
});

function emptySummary() {
    return {
        present: false,
        status: 'none',
        version: '',
        sha256: ''
    };
}

function responseError(message) {
    return { ok: false, code: 'internal_error', message: message || _('请求未能完成。'), data: {} };
}

function compact(children) {
    return children.filter(function (child) { return child !== null && child !== undefined; });
}

function disabledAttr(value) { return value ? 'disabled' : null; }
function summary(data, name) {
    return data && data[name] ? data[name] : emptySummary();
}

function hash(summaryValue) {
    return summaryValue && summaryValue.sha256 ? summaryValue.sha256 : '';
}

function summaryText(summaryValue) {
    if (!summaryValue || !summaryValue.present)
        return _('不可用');

    return '%s — %s'.format(summaryValue.version || _('版本未知'), hash(summaryValue) || _('无指纹'));
}

function actionError(response) {
    var messages = {
        conflict: _('服务器状态已变化。已保留您输入的草稿，请查看最新服务器草稿后再保存。'),
        recovery_required: _('脚本需要恢复才能继续操作。请通过 root shell 修复保留的恢复数据，然后刷新页面。'),
        download_failed: _('无法连接固定更新源。请检查网络连接后重试。'),
        source_rejected: _('获取的脚本未通过静态安全检查，未被暂存或执行。'),
        invalid_state: _('当前脚本状态不允许此操作。请刷新页面并完成前一步。'),
        validation_failed: _('验证未通过，代码尚未激活。请修正后重新验证。'),
        activation_failed: _('激活未完成。此前的活动脚本已保留，或现在需要恢复。'),
        not_found: _('请求的脚本状态已不存在。请刷新页面。'),
        confirmation_required: _('此操作需要在本页面完成确认。'),
        invalid_request: _('提交的脚本状态无效。请刷新页面后重试。')
    };

    return messages[response && response.code] || _('操作失败。请刷新页面后重试。');
}

function preserveConflictDraft(state, response) {
    if (!response || response.code !== 'conflict')
        return { conflict: false, draftText: state.draftText, message: actionError(response) };

    return {
        conflict: true,
        draftText: state.draftText,
        message: _('服务器草稿已变化。已保留您输入的内容；准备替换时请使用“重新载入最新服务器草稿”。')
    };
}

function actionSuccess(label, response) {
    var validation = response && response.data && response.data.validation;

    if (validation && validation.status === 'offline')
        return _('%s已完成。配置的接口当前离线；网络恢复后请重新进行状态验证。').format(label);

    return response && response.code === 'no_change' ? _('无需更改。') : _('%s已完成。').format(label);
}

function nativeButton(label, handler, disabled, style) {
    return E('button', {
        'class': 'btn cbi-button ml-button ' + (style || 'cbi-button-action'),
        'type': 'button',
        'disabled': disabledAttr(disabled),
        'click': handler
    }, label);
}

function maintenanceNav(active) {
    return E('nav', { 'class': 'ml-subnav', 'aria-label': _('维护页面') }, [
        E('a', { 'class': 'ml-subnav__link' + (active === 'troubleshooting' ? ' ml-subnav__link--active' : ''), 'href': L.url('admin/services/multilogin/maintenance/troubleshooting'), 'aria-current': active === 'troubleshooting' ? 'page' : null }, _('故障排查')),
        E('a', { 'class': 'ml-subnav__link' + (active === 'scripts' ? ' ml-subnav__link--active' : ''), 'href': L.url('admin/services/multilogin/maintenance/scripts'), 'aria-current': active === 'scripts' ? 'page' : null }, _('脚本维护'))
    ]);
}

return view.extend({
    load: function () {
        return Promise.all([
            L.resolveDefault(callScriptInfo(), responseError()),
            L.resolveDefault(callScriptGetDraft(), responseError())
        ]);
    },

    render: function (responses) {
        var initialInfo = responses[0] || responseError();
        var initialDraft = responses[1] || responseError();
        var initialFailure = !initialInfo.ok ? actionError(initialInfo) :
            ((initialInfo.data || {}).recovery_required ? actionError({ code: 'recovery_required' }) :
                (!initialDraft.ok && initialDraft.code !== 'not_found' ? actionError(initialDraft) : ''));
        var state = {
            info: initialInfo,
            draft: initialDraft,
            draftText: initialDraft.ok ? (initialDraft.data.content || '') : '',
            savedDraftText: initialDraft.ok ? (initialDraft.data.content || '') : '',
            draftBaseHash: initialDraft.ok ? hash(summary(initialDraft.data, 'summary')) : '',
            conflict: false,
            check: null,
            path: 'managed',
            busy: false,
            busyKey: '',
            feedback: initialFailure,
            feedbackKind: initialFailure ? 'error' : 'status'
        };
        var root = E('div', { 'class': 'cbi-map multilogin-script-manager ml-page ml-page--script', 'aria-busy': 'false' });
        var feedback = E('div', { 'class': 'script-feedback', 'aria-live': 'polite', 'role': 'status' });
        var alert = E('div', { 'class': 'alert-message', 'aria-live': 'assertive', 'role': 'alert' });
        var content = E('div');

        function currentInfo() {
            return state.info && state.info.ok ? state.info.data : {};
        }

        function generation() {
            return Number(currentInfo().generation || 0);
        }

        function pending(key) {
            return state.busy && state.busyKey === key;
        }

        function operationDisabled(key, unavailable) {
            return !!unavailable || pending(key);
        }

        function setFeedback(kind, message) {
            state.feedbackKind = kind;
            state.feedback = message || '';
            feedback.textContent = kind === 'status' ? state.feedback : '';
            alert.textContent = kind === 'error' ? state.feedback : '';
        }

        function getDraftText() {
            var textarea = root.querySelector('textarea[name="custom-draft"]');
            if (textarea)
                state.draftText = textarea.value;
            return state.draftText;
        }

        function customDraftIsSaved() {
            return !state.conflict && getDraftText() === state.savedDraftText;
        }

        function requireCustomDraftSaved() {
            if (state.conflict) {
                setFeedback('error', _('服务器草稿已变化。请先重新载入最新服务器草稿。'));
                draw();
                return false;
            }

            if (!customDraftIsSaved()) {
                setFeedback('error', _('编辑器内容尚未保存。请先保存草稿或重新载入服务器草稿，再验证或激活。'));
                draw();
                return false;
            }

            return true;
        }

        function requireCustomMutationAllowed() {
            if (!state.conflict)
                return true;

            setFeedback('error', _('服务器草稿已变化。冲突解决前只能重新载入最新服务器草稿。'));
            draw();
            return false;
        }

        function refresh(options) {
            var preserveTypedDraft = options && options.preserveTypedDraft;
            var updateDraftBase = options && options.updateDraftBase;
            var typedDraft = preserveTypedDraft ? getDraftText() : null;

            return Promise.all([
                L.resolveDefault(callScriptInfo(), responseError()),
                L.resolveDefault(callScriptGetDraft(), responseError())
            ]).then(function (result) {
                state.info = result[0] || responseError();
                state.draft = result[1] || responseError();

                if (state.draft.ok) {
                    state.savedDraftText = state.draft.data.content || '';
                    if (!preserveTypedDraft || updateDraftBase)
                        state.draftBaseHash = hash(summary(state.draft.data, 'summary'));
                    state.draftText = preserveTypedDraft ? typedDraft : (state.draft.data.content || '');
                } else if (!preserveTypedDraft && state.draft.code === 'not_found') {
                    state.savedDraftText = '';
                    state.draftBaseHash = '';
                    state.draftText = '';
                }

                if (!state.info.ok)
                    setFeedback('error', actionError(state.info));
                else if (!state.draft.ok && state.draft.code !== 'not_found')
                    setFeedback('error', actionError(state.draft));
            });
        }

        function retryLoad() {
            if (state.busy)
                return;

            state.busy = true;
            state.busyKey = 'refresh';
            setFeedback('status', _('正在刷新脚本状态…'));
            draw();
            refresh({ preserveTypedDraft: true }).then(function () {
                state.busy = false;
                state.busyKey = '';
                if (!state.info.ok)
                    setFeedback('error', actionError(state.info));
                else if (currentInfo().recovery_required)
                    setFeedback('error', actionError({ code: 'recovery_required' }));
                else if (!state.draft.ok && state.draft.code !== 'not_found')
                    setFeedback('error', actionError(state.draft));
                else
                    setFeedback('status', _('脚本状态已刷新。'));
                draw();
            });
        }

        function runAction(label, request, options) {
            if (state.busy)
                return;

            var actionKey = options && options.actionKey ? options.actionKey : 'script-action';
            state.busy = true;
            state.busyKey = actionKey;
            setFeedback('status', _('正在处理：%s').format(label));
            draw();

            L.resolveDefault(request(), responseError()).then(function (response) {
                if (!response || !response.ok) {
                    var failure = preserveConflictDraft(state, response);
                    state.draftText = failure.draftText;
                    state.conflict = state.conflict || failure.conflict;
                    setFeedback('error', failure.message);
                    return refresh({ preserveTypedDraft: true });
                }

                if (options && options.storeCheck)
                    state.check = response.data || {};
                setFeedback('status', actionSuccess(label, response));
                return refresh(options || { preserveTypedDraft: true });
            }).catch(function () {
                setFeedback('error', _('操作未收到响应即失败。请刷新页面后重试。'));
            }).then(function () {
                state.busy = false;
                state.busyKey = '';
                draw();
            });
        }

        function reloadServerDraft() {
            if (!confirm(_('要用最新服务器草稿替换编辑器内容吗？请先复制未保存的输入。')))
                return;

            state.busy = true;
            state.busyKey = 'draft-reload';
            setFeedback('status', _('正在载入最新服务器草稿…'));
            draw();
            refresh({ preserveTypedDraft: false, updateDraftBase: true }).then(function () {
                var draftReloaded = state.draft && (state.draft.ok || state.draft.code === 'not_found');
                state.busy = false;
                state.busyKey = '';
                if (draftReloaded) {
                    state.conflict = false;
                    setFeedback('status', state.draft.ok ?
                        _('最新服务器草稿已载入编辑器。') : _('服务器没有草稿，编辑器已清空。'));
                } else {
                    setFeedback('error', actionError(state.draft));
                }
                draw();
            });
        }

        function metadataRow(label, value) {
            return E('div', { 'class': 'script-metadata-row' }, [
                E('dt', {}, label),
                E('dd', {}, value)
            ]);
        }

        function statusBadge(label, kind) {
            return E('span', { 'class': 'ml-status ml-status--' + (kind || 'neutral') }, label);
        }

        function operationButton(label, handler, key, unavailable, primary, negative) {
            var style = negative ? 'cbi-button-negative' : (primary ? 'cbi-button-apply' : 'cbi-button-action');
            return nativeButton(label, handler, operationDisabled(key, unavailable), style);
        }

        function compactChildren(children) {
            return compact(children);
        }

        function draw() {
            var info = currentInfo();
            var active = summary(info, 'active');
            var candidate = summary(info, 'candidate');
            var factory = summary(info, 'factory');
            var lkg = summary(info, 'last_known_good');
            var custom = summary(info, 'custom');
            var remote = state.check && state.check.remote ? state.check.remote : emptySummary();
            var draftState = state.draft && state.draft.ok ? summary(state.draft.data, 'summary') : custom;
            var draftLoadError = state.draft && !state.draft.ok && state.draft.code !== 'not_found';
            var canStageCandidate = !candidate.present && !!(state.check && state.check.available);
            var canValidateCandidate = candidate.present && candidate.status === 'staged';
            var canActivateCandidate = candidate.present && candidate.status === 'validated';
            var canValidateCustom = draftState.present && (draftState.status === 'draft' || draftState.status === 'validated');
            var canActivateCustom = draftState.present && draftState.status === 'validated';
            var draftMissing = !draftState.present;
            var disabled = state.busy || !state.info.ok || info.recovery_required;
            var managedUnavailable = !state.info.ok || info.recovery_required || state.busyKey === 'refresh';
            var customUnavailable = !state.info.ok || info.recovery_required || draftLoadError || state.busyKey === 'refresh' || state.busyKey === 'draft-reload';
            var textarea = E('textarea', {
                'id': 'custom-draft',
                'name': 'custom-draft',
                'class': 'cbi-input-text script-editor',
                'rows': 18,
                'spellcheck': 'false',
                'wrap': 'off',
                'aria-describedby': 'custom-draft-help custom-root-warning',
                'disabled': disabledAttr(draftLoadError || pending('custom-save') || pending('custom-validate') || pending('custom-activate') || pending('custom-discard') || pending('draft-reload'))
            }, state.draftText);

            textarea.addEventListener('input', function () {
                state.draftText = textarea.value;
            });

            var draftSaved = !state.conflict && textarea.value === state.savedDraftText;
            var managedPrimary = candidate.present && candidate.status === 'staged' ? 'validate' :
                (canActivateCandidate ? 'activate' : (canStageCandidate ? 'stage' : 'check'));
            var customPrimary = draftMissing || !draftSaved ? 'save' :
                (draftState.status === 'draft' ? 'validate' : (canActivateCustom ? 'activate' : 'save'));

            root.setAttribute('aria-busy', state.busy ? 'true' : 'false');

            content.replaceChildren.apply(content, compact([
                E('div', { 'class': 'ml-page__header script-page-header' }, [
                    E('div', { 'class': 'ml-page__heading' }, [
                        E('h2', { 'class': 'ml-page__title' }, _('脚本维护')),
                        E('p', { 'class': 'ml-page__description' }, _('按维护任务选择托管更新或自定义草稿；每一步完成后才显示下一步操作。'))
                    ]),
                    E('div', { 'class': 'ml-page__header-actions' }, [
                        nativeButton(state.busyKey === 'refresh' ? _('正在刷新…') : _('刷新脚本状态'), retryLoad, pending('refresh'))
                    ])
                ]),
                maintenanceNav('scripts'),
                E('aside', { 'class': 'script-boundary ml-section ml-card', 'role': 'note' }, [
                    E('strong', {}, _('软件包边界')),
                    E('p', {}, _('login_control.bash 始终由软件包管理，本页不提供替换入口。托管更新只允许更新 cqu-portal.sh；页面不会接受任意路径、命令、Portal 或服务调用。'))
                ]),
                E('div', { 'class': 'script-path-tabs', 'role': 'tablist', 'aria-label': _('选择脚本维护路径') }, [
                    E('button', {
                        'class': 'btn cbi-button ml-button script-path-tab' + (state.path === 'managed' ? ' script-path-tab--selected' : ''),
                        'id': 'managed-path-tab',
                        'type': 'button',
                        'role': 'tab',
                        'aria-selected': state.path === 'managed' ? 'true' : 'false',
                        'aria-controls': 'managed-path',
                        'click': function () { state.path = 'managed'; draw(); }
                    }, _('托管更新')),
                    E('button', {
                        'class': 'btn cbi-button ml-button script-path-tab' + (state.path === 'custom' ? ' script-path-tab--selected' : ''),
                        'id': 'custom-path-tab',
                        'type': 'button',
                        'role': 'tab',
                        'aria-selected': state.path === 'custom' ? 'true' : 'false',
                        'aria-controls': 'custom-path',
                        'click': function () { state.path = 'custom'; draw(); }
                    }, _('自定义草稿'))
                ]),
                (!state.info.ok || info.recovery_required || draftLoadError) ? E('div', { 'class': 'alert-message', 'role': 'alert', 'aria-live': 'assertive' }, [
                    E('p', {}, info.recovery_required ? actionError({ code: 'recovery_required' }) :
                        (!state.info.ok ? actionError(state.info) : actionError(state.draft))),
                    nativeButton(_('刷新脚本状态'), retryLoad, pending('refresh'))
                ]) : null,
                state.path === 'managed' ? E('div', { 'id': 'managed-path', 'role': 'tabpanel', 'aria-labelledby': 'managed-path-tab' }, [
                    E('section', { 'class': 'ml-section ml-card script-panel', 'aria-labelledby': 'managed-heading' }, [
                        E('div', { 'class': 'ml-section__header' }, [
                            E('div', {}, [
                                E('h3', { 'id': 'managed-heading' }, _('托管更新')),
                                E('p', { 'class': 'ml-help' }, _('只从固定来源检查 cqu-portal.sh；当前活动脚本不会被检查或下载动作直接覆盖。'))
                            ]),
                            statusBadge(info.mode === 'managed' ? _('当前为托管') : _('当前为自定义'), info.mode === 'managed' ? 'success' : 'neutral')
                        ]),
                        E('ol', { 'class': 'script-steps' }, [
                            E('li', { 'class': 'script-step script-step--current' }, [
                                E('h4', {}, _('1. 当前脚本摘要')),
                                E('dl', { 'class': 'script-metadata' }, compact([
                                    metadataRow(_('活动脚本来源'), active.source || _('未知')),
                                    metadataRow(_('当前版本和指纹'), summaryText(active)),
                                    metadataRow(_('固定更新源'), info.raw_url || _('离线时不可用'))
                                ]))
                            ]),
                            E('li', { 'class': 'script-step' }, compactChildren([
                                E('h4', {}, _('2. 检查更新')),
                                state.check ? E('p', { 'class': 'script-step__result' }, [
                                    statusBadge(state.check.available ? _('发现候选版本') : _('暂无新版本'), state.check.available ? 'warning' : 'success'),
                                    E('span', {}, ' ' + (state.check.relation || _('版本关系未知')))
                                ]) : E('p', { 'class': 'ml-help' }, _('先检查固定更新源，页面只会显示版本和指纹摘要。')),
                                state.check ? E('dl', { 'class': 'script-metadata' }, compact([
                                    metadataRow(_('远程版本和指纹'), summaryText(remote)),
                                    metadataRow(_('需要确认降级'), state.check.downgrade ? _('是') : _('否'))
                                ])) : null,
                                E('div', { 'class': 'script-actions' }, [
                                    operationButton(_('检查更新'), function () {
                                        runAction(_('检查更新'), callScriptCheck, { preserveTypedDraft: true, storeCheck: true, actionKey: 'managed-check' });
                                    }, 'managed-check', managedUnavailable, managedPrimary === 'check')
                                ])
                            ])),
                            E('li', { 'class': 'script-step' }, compactChildren([
                                E('h4', {}, _('3. 候选版本')),
                                candidate.present ? E('dl', { 'class': 'script-metadata' }, [
                                    metadataRow(_('候选状态'), '%s — %s'.format(candidate.status, summaryText(candidate))),
                                    metadataRow(_('候选来源'), candidate.source || _('固定更新源'))
                                ]) : E('p', { 'class': 'ml-help' }, state.check && state.check.available ? _('检查到新版本后，下载候选版本并继续验证。') : _('检查更新后，有候选版本时才可下载。')),
                                canStageCandidate ? E('div', { 'class': 'script-actions' }, [
                                    operationButton(_('下载候选版本'), function () {
                                        runAction(_('下载候选版本'), function () {
                                            return callScriptStage(generation());
                                        }, { preserveTypedDraft: true, actionKey: 'managed-stage' });
                                    }, 'managed-stage', managedUnavailable, managedPrimary === 'stage')
                                ]) : null
                            ])),
                            E('li', { 'class': 'script-step' }, compactChildren([
                                E('h4', {}, _('4. 验证候选版本')),
                                candidate.present && candidate.status === 'validated' ? E('p', { 'class': 'script-step__result' }, statusBadge(_('候选版本已验证'), 'success')) :
                                    (canValidateCandidate ? E('p', { 'class': 'ml-help' }, _('验证会以 root 权限执行候选脚本的 self-test；验证通过前不能切换。')) : E('p', { 'class': 'ml-help' }, _('下载候选版本后，此处才会开放验证。'))),
                                canValidateCandidate ? E('div', { 'class': 'script-actions' }, [
                                    operationButton(_('验证候选版本'), function () {
                                        if (!confirm(_('验证会以 root 权限执行此候选代码。指纹：%s').format(hash(candidate))))
                                            return;
                                        runAction(_('验证候选版本'), function () {
                                            return callScriptValidate('candidate', hash(candidate), generation(), true);
                                        }, { preserveTypedDraft: true, actionKey: 'managed-validate' });
                                    }, 'managed-validate', managedUnavailable, managedPrimary === 'validate')
                                ]) : null
                            ])),
                            E('li', { 'class': 'script-step' }, [
                                E('h4', {}, _('5. 明确确认切换')),
                                canActivateCandidate ? E('div', {}, [
                                    E('p', { 'class': 'ml-help' }, _('候选版本已验证。切换会替换活动 cqu-portal.sh，并保留上一版本以便回滚。')),
                                    E('label', { 'class': 'script-checkbox' }, [
                                        E('input', { 'type': 'checkbox', 'name': 'allow-downgrade', 'disabled': disabledAttr(operationDisabled('managed-activate', managedUnavailable)) }),
                                        E('span', {}, _('如适用，我明确同意激活较低版本的托管候选脚本。'))
                                    ]),
                                    E('div', { 'class': 'script-actions' }, [
                                        operationButton(_('切换到候选版本'), function () {
                                            var downgrade = root.querySelector('input[name="allow-downgrade"]');
                                            if (!confirm(_('要切换到指纹为 %s 的已验证候选版本吗？这会替换活动脚本。').format(hash(candidate))))
                                                return;
                                            runAction(_('切换到候选版本'), function () {
                                                return callScriptActivate('candidate', hash(candidate), generation(), true, !!(downgrade && downgrade.checked));
                                            }, { preserveTypedDraft: true, actionKey: 'managed-activate' });
                                        }, 'managed-activate', managedUnavailable, managedPrimary === 'activate')
                                    ])
                                ]) : E('p', { 'class': 'ml-help' }, _('候选版本验证通过后，此处才会开放切换。'))
                            ])
                        ])
                    ]),
                    E('section', { 'class': 'ml-section ml-card script-recovery-actions', 'aria-labelledby': 'managed-recovery-heading' }, [
                        E('div', { 'class': 'ml-section__header' }, [
                            E('div', {}, [
                                E('h3', { 'id': 'managed-recovery-heading' }, _('回滚 / 恢复')),
                                E('p', { 'class': 'ml-help' }, _('这些操作独立于更新流程，只在明确确认后替换活动脚本。'))
                            ])
                        ]),
                        E('dl', { 'class': 'script-metadata' }, [
                            metadataRow(_('上一版本'), lkg.present ? summaryText(lkg) : _('没有可回滚版本')),
                            metadataRow(_('软件包内置脚本'), factory.present ? summaryText(factory) : _('不可用'))
                        ]),
                        E('div', { 'class': 'script-actions' }, [
                            operationButton(_('回滚到上一版本'), function () {
                                if (!confirm(_('要回滚到指纹为 %s 的上一版本吗？这会替换活动脚本。').format(hash(lkg))))
                                    return;
                                runAction(_('回滚到上一版本'), function () {
                                    return callScriptRollback(hash(lkg), generation(), true);
                                }, { preserveTypedDraft: true, actionKey: 'managed-rollback' });
                            }, 'managed-rollback', managedUnavailable || !lkg.present, false, true),
                            operationButton(_('恢复软件包内置脚本'), function () {
                                if (!confirm(_('要恢复指纹为 %s 的软件包内置脚本吗？这会替换活动脚本。').format(hash(factory))))
                                    return;
                                runAction(_('恢复软件包内置脚本'), function () {
                                    return callScriptRestore(hash(factory), generation(), true);
                                }, { preserveTypedDraft: true, actionKey: 'managed-restore' });
                            }, 'managed-restore', managedUnavailable || !factory.present, false, true)
                        ])
                    ])
                ]) : E('div', { 'id': 'custom-path', 'role': 'tabpanel', 'aria-labelledby': 'custom-path-tab' }, [
                    E('section', { 'class': 'ml-section ml-card script-panel', 'aria-labelledby': 'custom-heading' }, compact([
                        E('div', { 'class': 'ml-section__header' }, [
                            E('div', {}, [
                                E('h3', { 'id': 'custom-heading' }, _('自定义草稿')),
                                E('p', { 'class': 'ml-help' }, _('自定义内容始终先保存为服务器端草稿，再验证和明确激活；它不会直接编辑活动脚本。'))
                            ]),
                            statusBadge(draftMissing ? _('没有草稿') : (draftSaved ? _('已保存') : _('有未保存修改')), draftMissing || !draftSaved ? 'warning' : 'success')
                        ]),
                        E('p', { 'id': 'custom-root-warning', 'class': 'alert-message', 'role': 'alert' }, _('安全警告：这是 root 级代码编辑器。请勿写入账户凭据或其他机密；验证会以 root 权限执行保存的精确草稿。')),
                        E('ol', { 'class': 'script-steps' }, [
                            E('li', { 'class': 'script-step script-step--current' }, [
                                E('h4', {}, _('1. 编辑草稿')),
                                E('label', { 'for': 'custom-draft' }, _('自定义草稿')),
                                textarea,
                                E('p', { 'id': 'custom-draft-help', 'class': 'cbi-section-descr' }, _('代码文本可在编辑器内滚动；保存只写入服务器端草稿，验证不会自动激活。'))
                            ]),
                            E('li', { 'class': 'script-step' }, compactChildren([
                                E('h4', {}, _('2. 草稿状态')),
                                E('dl', { 'class': 'script-metadata' }, [
                                    metadataRow(_('草稿状态'), draftMissing ? _('没有已保存草稿') : '%s — %s'.format(draftState.status, summaryText(draftState))),
                                    metadataRow(_('草稿基准指纹'), state.draftBaseHash || _('没有已保存基准'))
                                ]),
                                state.conflict ? E('p', { 'class': 'alert-message', 'role': 'alert' }, _('服务器上的草稿已变化。已保留您的输入；解决冲突前不能保存、验证、激活或丢弃。')) : null,
                                !draftMissing && draftSaved ? null : E('p', { 'class': 'ml-help' }, draftMissing ? _('当前没有保存草稿；先保存草稿，后续危险操作才会显示。') : _('检测到未保存修改；先保存草稿，后续危险操作才会显示。'))
                            ])),
                            E('li', { 'class': 'script-step' }, [
                                E('h4', {}, _('3. 保存草稿')),
                                E('div', { 'class': 'script-actions' }, [
                                    operationButton(_('保存草稿'), function () {
                                        if (!requireCustomMutationAllowed())
                                            return;
                                        runAction(_('保存草稿'), function () {
                                            return callScriptSaveDraft(getDraftText(), state.draftBaseHash, generation());
                                        }, { preserveTypedDraft: true, updateDraftBase: true, actionKey: 'custom-save' });
                                    }, 'custom-save', customUnavailable || state.conflict, customPrimary === 'save')
                                ])
                            ]),
                            E('li', { 'class': 'script-step' }, compactChildren([
                                E('h4', {}, _('4. 验证草稿')),
                                !draftMissing && draftSaved && draftState.status === 'validated' ? E('p', { 'class': 'script-step__result' }, statusBadge(_('草稿已验证'), 'success')) :
                                    (canValidateCustom && draftSaved ? E('p', { 'class': 'ml-help' }, _('验证会以 root 权限执行已保存草稿；验证通过前不能激活。')) : E('p', { 'class': 'ml-help' }, _('保存草稿后，此处才会开放验证。'))),
                                canValidateCustom && draftSaved && draftState.status === 'draft' ? E('div', { 'class': 'script-actions' }, [
                                    operationButton(_('验证草稿'), function () {
                                        if (!requireCustomDraftSaved())
                                            return;
                                        if (!confirm(_('验证会以 root 权限执行此已保存草稿。指纹：%s').format(hash(draftState))))
                                            return;
                                        runAction(_('验证草稿'), function () {
                                            return callScriptValidate('custom', hash(draftState), generation(), true);
                                        }, { preserveTypedDraft: true, actionKey: 'custom-validate' });
                                    }, 'custom-validate', customUnavailable || state.conflict, customPrimary === 'validate')
                                ]) : null
                            ])),
                            E('li', { 'class': 'script-step' }, [
                                E('h4', {}, _('5. 明确确认激活')),
                                canActivateCustom && draftSaved ? E('div', {}, [
                                    E('p', { 'class': 'ml-help' }, _('草稿已验证。激活会替换活动脚本，并保留上一版本以便回滚。')),
                                    E('div', { 'class': 'script-actions' }, [
                                        operationButton(_('确认激活草稿'), function () {
                                            if (!requireCustomDraftSaved())
                                                return;
                                            if (!confirm(_('要激活指纹为 %s 的已验证自定义草稿吗？这会替换活动脚本。').format(hash(draftState))))
                                                return;
                                            runAction(_('确认激活草稿'), function () {
                                                return callScriptActivate('custom', hash(draftState), generation(), true, false);
                                            }, { preserveTypedDraft: true, actionKey: 'custom-activate' });
                                        }, 'custom-activate', customUnavailable || state.conflict, customPrimary === 'activate')
                                    ])
                                ]) : E('p', { 'class': 'ml-help' }, _('验证通过后，此处才会开放激活确认。'))
                            ]),
                            E('li', { 'class': 'script-step' }, [
                                E('h4', {}, _('6. 丢弃')),
                                !draftMissing ? E('div', {}, [
                                    E('p', { 'class': 'ml-help' }, _('丢弃服务器端草稿不可撤销；不会删除保留的迁移备份。')),
                                    E('div', { 'class': 'script-actions' }, [
                                        operationButton(_('丢弃草稿'), function () {
                                            if (!requireCustomMutationAllowed())
                                                return;
                                            if (!confirm(_('要丢弃已保存的自定义草稿吗？无法通过浏览器撤销。')))
                                                return;
                                            runAction(_('丢弃草稿'), function () {
                                                return callScriptDiscardDraft(hash(draftState), generation());
                                            }, { preserveTypedDraft: false, updateDraftBase: true, actionKey: 'custom-discard' });
                                        }, 'custom-discard', customUnavailable || state.conflict, false, true)
                                    ])
                                ]) : E('p', { 'class': 'ml-help' }, _('没有草稿可丢弃。保存草稿后才会显示此危险操作。'))
                            ])
                        ]),
                        nativeButton(_('重新载入最新服务器草稿'), reloadServerDraft, customUnavailable || !state.draft.ok)
                    ]))
                ])
            ]));
            setFeedback(state.feedbackKind, state.feedback);
        }

        root.appendChild(E('link', { rel: 'stylesheet', href: L.resource('view/multilogin/multi-login.css') }));
        root.appendChild(E('style', {}, [
            '.multilogin-script-manager { max-width: 72rem; min-width: 0; }',
            '.multilogin-script-manager .script-grid { display: block; min-width: 0; }',
            '.multilogin-script-manager .script-panel { min-width: 0; }',
            '.multilogin-script-manager .script-path-tabs { display: flex; flex-wrap: wrap; gap: .5rem; margin: 0 0 1rem; min-width: 0; }',
            '.multilogin-script-manager .script-path-tab { min-height: 44px; flex: 1 1 12rem; text-align: center; }',
            '.multilogin-script-manager .script-path-tab--selected { border-color: var(--primary-color-high, #1677ff); box-shadow: inset 0 -3px 0 var(--primary-color-high, #1677ff); font-weight: 600; }',
            '.multilogin-script-manager .script-boundary { border-inline-start: .3rem solid var(--warning-color-high, #8a5a00); }',
            '.multilogin-script-manager .script-boundary p { margin: .35rem 0 0; }',
            '.multilogin-script-manager .script-steps { margin: 0; padding-inline-start: 1.5rem; min-width: 0; }',
            '.multilogin-script-manager .script-step { min-width: 0; margin: 0 0 1rem; padding: 1rem; border: 1px solid var(--border-color-medium, rgba(127, 127, 127, .28)); border-radius: .5rem; background: var(--background-color-low, rgba(127, 127, 127, .035)); }',
            '.multilogin-script-manager .script-step:last-child { margin-bottom: 0; }',
            '.multilogin-script-manager .script-step h4 { margin-bottom: .5rem; }',
            '.multilogin-script-manager .script-step__result { display: flex; flex-wrap: wrap; align-items: center; gap: .5rem; min-width: 0; }',
            '.multilogin-script-manager .script-actions { display: flex; flex-wrap: wrap; gap: .5rem; margin: 1rem 0; min-width: 0; }',
            '.multilogin-script-manager .script-actions .cbi-button { min-height: 44px; touch-action: manipulation; }',
            '.multilogin-script-manager .script-checkbox { display: flex; align-items: flex-start; gap: .5rem; min-width: 0; }',
            '.multilogin-script-manager .script-checkbox input { min-width: 1.25rem; min-height: 1.25rem; margin-top: .15rem; }',
            '.multilogin-script-manager .script-metadata { margin: 0; min-width: 0; }',
            '.multilogin-script-manager .script-metadata-row { display: grid; grid-template-columns: minmax(9rem, 1fr) minmax(0, 2fr); gap: .5rem; padding: .35rem 0; min-width: 0; }',
            '.multilogin-script-manager .script-metadata dd { margin: 0; overflow-wrap: anywhere; min-width: 0; }',
            '.multilogin-script-manager .script-editor { box-sizing: border-box; display: block; width: 100%; max-width: 100%; min-width: 0; min-height: 18rem; max-height: 70vh; overflow: auto; white-space: pre; font-family: monospace; }',
            '.multilogin-script-manager .script-feedback:empty, .multilogin-script-manager > .alert-message:empty { display: none; }',
            '@media (max-width: 600px) { .multilogin-script-manager .script-path-tab { flex-basis: 100%; } .multilogin-script-manager .script-step { padding: .75rem; } }',
            '@media (max-width: 375px) { .multilogin-script-manager .script-metadata-row { grid-template-columns: minmax(0, 1fr); } .multilogin-script-manager .script-actions .cbi-button { flex: 1 1 100%; } }'
        ].join('\n')));
        root.appendChild(content);
        root.appendChild(feedback);
        root.appendChild(alert);
        draw();

        return root;
    },

    handleSaveApply: null,
    handleSave: null,
    handleReset: null
});

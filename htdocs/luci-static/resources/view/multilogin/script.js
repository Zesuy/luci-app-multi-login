'use strict';
'require view';
'require rpc';

var callScriptInfo = rpc.declare({
    object: 'multilogin',
    method: 'script_info',
    expect: {}
});

var callScriptCheck = rpc.declare({
    object: 'multilogin',
    method: 'script_check',
    expect: {}
});

var callScriptStage = rpc.declare({
    object: 'multilogin',
    method: 'script_stage',
    params: ['expected_generation'],
    expect: {}
});

var callScriptValidate = rpc.declare({
    object: 'multilogin',
    method: 'script_validate',
    params: ['source', 'expected_sha256', 'expected_generation', 'confirm_execute'],
    expect: {}
});

var callScriptActivate = rpc.declare({
    object: 'multilogin',
    method: 'script_activate',
    params: ['source', 'expected_sha256', 'expected_generation', 'confirm_activate', 'allow_downgrade'],
    expect: {}
});

var callScriptRollback = rpc.declare({
    object: 'multilogin',
    method: 'script_rollback',
    params: ['expected_sha256', 'expected_generation', 'confirm_activate'],
    expect: {}
});

var callScriptRestore = rpc.declare({
    object: 'multilogin',
    method: 'script_restore',
    params: ['expected_sha256', 'expected_generation', 'confirm_activate'],
    expect: {}
});

var callScriptGetDraft = rpc.declare({
    object: 'multilogin',
    method: 'script_get_draft',
    expect: {}
});

var callScriptSaveDraft = rpc.declare({
    object: 'multilogin',
    method: 'script_save_draft',
    params: ['content', 'base_sha256', 'expected_generation'],
    expect: {}
});

var callScriptDiscardDraft = rpc.declare({
    object: 'multilogin',
    method: 'script_discard_draft',
    params: ['expected_sha256', 'expected_generation'],
    expect: {}
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
        'class': 'btn cbi-button ' + (style || 'cbi-button-action'),
        'type': 'button',
        'disabled': disabled,
        'click': handler
    }, label);
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
            busy: false,
            feedback: initialFailure,
            feedbackKind: initialFailure ? 'error' : 'status'
        };
        var root = E('div', { 'class': 'cbi-map multilogin-script-manager', 'aria-busy': 'false' });
        var feedback = E('div', { 'class': 'script-feedback', 'aria-live': 'polite', 'role': 'status' });
        var alert = E('div', { 'class': 'alert-message', 'aria-live': 'assertive', 'role': 'alert' });
        var content = E('div');

        function currentInfo() {
            return state.info && state.info.ok ? state.info.data : {};
        }

        function generation() {
            return Number(currentInfo().generation || 0);
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
            setFeedback('status', _('正在刷新脚本状态…'));
            draw();
            refresh({ preserveTypedDraft: true }).then(function () {
                state.busy = false;
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

            state.busy = true;
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
                draw();
            });
        }

        function reloadServerDraft() {
            if (!confirm(_('要用最新服务器草稿替换编辑器内容吗？请先复制未保存的输入。')))
                return;

            state.busy = true;
            setFeedback('status', _('正在载入最新服务器草稿…'));
            draw();
            refresh({ preserveTypedDraft: false, updateDraftBase: true }).then(function () {
                var draftReloaded = state.draft && (state.draft.ok || state.draft.code === 'not_found');
                state.busy = false;
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
            var canValidateCandidate = candidate.present && (candidate.status === 'staged' || candidate.status === 'validated');
            var canActivateCandidate = candidate.present && candidate.status === 'validated';
            var canValidateCustom = draftState.present && (draftState.status === 'draft' || draftState.status === 'validated');
            var canActivateCustom = draftState.present && draftState.status === 'validated';
            var draftMissing = !draftState.present;
            var disabled = state.busy || !state.info.ok || info.recovery_required;
            var managedDowngrade = E('label', { 'class': 'script-checkbox' }, [
                E('input', { 'type': 'checkbox', 'name': 'allow-downgrade', 'disabled': disabled }),
                E('span', {}, _('如适用，我明确同意激活较低版本的托管候选脚本。'))
            ]);
            var textarea = E('textarea', {
                'id': 'custom-draft',
                'name': 'custom-draft',
                'class': 'cbi-input-text script-editor',
                'rows': 18,
                'spellcheck': 'false',
                'wrap': 'off',
                'aria-describedby': 'custom-draft-help custom-root-warning',
                'disabled': state.busy || draftLoadError
            }, state.draftText);

            textarea.addEventListener('input', function () {
                state.draftText = textarea.value;
            });

            root.setAttribute('aria-busy', state.busy ? 'true' : 'false');

            content.replaceChildren(
                E('div', { 'class': 'cbi-section' }, [
                    E('h3', {}, _('脚本管理器')),
                    E('p', { 'class': 'cbi-section-descr' }, _('管理固定更新通道或独立的自定义草稿。所有更改都不会直接编辑正在运行的脚本。')),
                    (!state.info.ok || info.recovery_required || draftLoadError) ? E('div', { 'class': 'alert-message', 'role': 'alert' }, [
                        E('p', {}, info.recovery_required ? actionError({ code: 'recovery_required' }) :
                            (!state.info.ok ? actionError(state.info) : actionError(state.draft))),
                        nativeButton(_('刷新脚本状态'), retryLoad, state.busy)
                    ]) : null,
                    E('div', { 'class': 'script-grid' }, [
                        E('section', { 'class': 'cbi-section-node script-panel', 'aria-labelledby': 'managed-heading' }, [
                            E('h4', { 'id': 'managed-heading' }, _('托管')),
                            E('dl', { 'class': 'script-metadata' }, [
                                metadataRow(_('模式'), info.mode || _('未知')),
                                metadataRow(_('固定更新 URL'), info.raw_url || _('离线时不可用')),
                                metadataRow(_('活动脚本来源'), active.source || _('未知')),
                                metadataRow(_('当前版本和指纹'), summaryText(active)),
                                metadataRow(_('候选状态'), candidate.present ? '%s — %s'.format(candidate.status, summaryText(candidate)) : _('没有已暂存更新')),
                                state.check ? metadataRow(_('最近检查结果'), '%s — %s'.format(state.check.available ? _('有可用更新') : _('没有可用更新'), state.check.relation || _('关系未知'))) : null,
                                state.check ? metadataRow(_('远程版本和指纹'), summaryText(remote)) : null,
                                state.check ? metadataRow(_('需要确认降级'), state.check.downgrade ? _('是') : _('否')) : null
                            ]),
                            E('div', { 'class': 'script-actions' }, [
                                nativeButton(_('检查更新'), function () {
                                    runAction(_('检查更新'), callScriptCheck, { preserveTypedDraft: true, storeCheck: true });
                                }, disabled),
                                nativeButton(_('暂存更新'), function () {
                                    runAction(_('暂存'), function () {
                                        return callScriptStage(generation());
                                    });
                                }, disabled),
                                nativeButton(_('验证候选脚本'), function () {
                                    if (!confirm(_('验证会以 root 权限执行此暂存代码。指纹：%s').format(hash(candidate))))
                                        return;
                                    runAction(_('验证候选脚本'), function () {
                                        return callScriptValidate('candidate', hash(candidate), generation(), true);
                                    });
                                }, disabled || !canValidateCandidate),
                                nativeButton(_('激活候选脚本'), function () {
                                    var downgrade = root.querySelector('input[name="allow-downgrade"]');
                                    if (!confirm(_('要激活指纹为 %s 的已验证候选脚本吗？这会替换活动脚本，需单独确认。').format(hash(candidate))))
                                        return;
                                    runAction(_('激活候选脚本'), function () {
                                        return callScriptActivate('candidate', hash(candidate), generation(), true, !!(downgrade && downgrade.checked));
                                    });
                                }, disabled || !canActivateCandidate, 'cbi-button-apply')
                            ]),
                            managedDowngrade,
                            E('div', { 'class': 'script-actions script-recovery-actions' }, [
                                nativeButton(_('回滚'), function () {
                                    if (!confirm(_('要回滚到指纹为 %s 的上一个已知可用脚本吗？这会替换活动脚本。').format(hash(lkg))))
                                        return;
                                    runAction(_('回滚'), function () {
                                        return callScriptRollback(hash(lkg), generation(), true);
                                    });
                                }, disabled || !lkg.present, 'cbi-button-negative'),
                                nativeButton(_('恢复出厂脚本'), function () {
                                    if (!confirm(_('要恢复指纹为 %s 的软件包出厂脚本吗？这会替换活动脚本。').format(hash(factory))))
                                        return;
                                    runAction(_('恢复出厂脚本'), function () {
                                        return callScriptRestore(hash(factory), generation(), true);
                                    });
                                }, disabled || !factory.present, 'cbi-button-negative')
                            ])
                        ]),
                        E('section', { 'class': 'cbi-section-node script-panel', 'aria-labelledby': 'custom-heading' }, [
                            E('h4', { 'id': 'custom-heading' }, _('自定义')),
                            E('p', { 'id': 'custom-root-warning', 'class': 'alert-message', 'role': 'alert' }, _('警告：此编辑器保存 root 级代码。请勿写入账户凭据或其他机密；验证会以 root 权限执行保存的精确草稿。')),
                            E('label', { 'for': 'custom-draft' }, _('自定义草稿')),
                            textarea,
                            E('p', { 'id': 'custom-draft-help', 'class': 'cbi-section-descr' }, _('这是仅保存在服务器端的草稿。验证前请先保存；验证不会激活脚本。')),
                            E('dl', { 'class': 'script-metadata' }, [
                                metadataRow(_('草稿状态'), draftMissing ? _('没有已保存草稿') : '%s — %s'.format(draftState.status, summaryText(draftState))),
                                metadataRow(_('草稿基准指纹'), state.draftBaseHash || _('没有已保存基准'))
                            ]),
                            E('div', { 'class': 'script-actions' }, [
                                nativeButton(_('保存草稿'), function () {
                                    if (!requireCustomMutationAllowed())
                                        return;
                                    runAction(_('保存草稿'), function () {
                                        return callScriptSaveDraft(getDraftText(), state.draftBaseHash, generation());
                                    }, { preserveTypedDraft: true, updateDraftBase: true });
                                }, disabled || draftLoadError || state.conflict),
                                nativeButton(_('验证草稿'), function () {
                                    if (!requireCustomDraftSaved())
                                        return;
                                    if (!confirm(_('验证会以 root 权限执行此已保存草稿。指纹：%s').format(hash(draftState))))
                                        return;
                                    runAction(_('验证草稿'), function () {
                                        return callScriptValidate('custom', hash(draftState), generation(), true);
                                    }, { preserveTypedDraft: true });
                                }, disabled || draftLoadError || state.conflict || !canValidateCustom),
                                nativeButton(_('激活草稿'), function () {
                                    if (!requireCustomDraftSaved())
                                        return;
                                    if (!confirm(_('要激活指纹为 %s 的已验证自定义草稿吗？这会替换活动脚本，需单独确认。').format(hash(draftState))))
                                        return;
                                    runAction(_('激活草稿'), function () {
                                        return callScriptActivate('custom', hash(draftState), generation(), true, false);
                                    }, { preserveTypedDraft: true });
                                }, disabled || draftLoadError || state.conflict || !canActivateCustom, 'cbi-button-apply'),
                                nativeButton(_('丢弃草稿'), function () {
                                    if (!requireCustomMutationAllowed())
                                        return;
                                    if (!confirm(_('要丢弃已保存的自定义草稿吗？无法通过浏览器撤销。')))
                                        return;
                                    runAction(_('丢弃草稿'), function () {
                                        return callScriptDiscardDraft(hash(draftState), generation());
                                    }, { preserveTypedDraft: false, updateDraftBase: true });
                                }, disabled || draftLoadError || state.conflict || draftMissing, 'cbi-button-negative')
                            ]),
                            state.conflict ? E('p', { 'class': 'alert-message', 'role': 'alert' }, _('服务器上的草稿已变化。已保留您的输入，但重新载入最新服务器草稿前不能保存。')) : null,
                            nativeButton(_('重新载入最新服务器草稿'), reloadServerDraft, disabled || draftLoadError || !state.draft.ok)
                        ])
                    ])
                ])
            );
            setFeedback(state.feedbackKind, state.feedback);
        }

        root.appendChild(E('style', {}, [
            '.multilogin-script-manager { max-width: 72rem; min-width: 0; }',
            '.multilogin-script-manager .script-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 22rem), 1fr)); gap: 1rem; min-width: 0; }',
            '.multilogin-script-manager .script-panel { min-width: 0; }',
            '.multilogin-script-manager .script-actions { display: flex; flex-wrap: wrap; gap: .5rem; margin: 1rem 0; min-width: 0; }',
            '.multilogin-script-manager .script-actions .cbi-button { min-height: 44px; touch-action: manipulation; }',
            '.multilogin-script-manager .script-checkbox { display: flex; align-items: flex-start; gap: .5rem; min-width: 0; }',
            '.multilogin-script-manager .script-checkbox input { min-width: 1.25rem; min-height: 1.25rem; margin-top: .15rem; }',
            '.multilogin-script-manager .script-metadata { margin: 0; min-width: 0; }',
            '.multilogin-script-manager .script-metadata-row { display: grid; grid-template-columns: minmax(9rem, 1fr) minmax(0, 2fr); gap: .5rem; padding: .35rem 0; min-width: 0; }',
            '.multilogin-script-manager .script-metadata dd { margin: 0; overflow-wrap: anywhere; min-width: 0; }',
            '.multilogin-script-manager .script-editor { box-sizing: border-box; display: block; width: 100%; max-width: 100%; min-width: 0; min-height: 18rem; font-family: monospace; }',
            '.multilogin-script-manager .script-feedback:empty, .multilogin-script-manager > .alert-message:empty { display: none; }',
            '@media (max-width: 375px) { .multilogin-script-manager .script-metadata-row { grid-template-columns: minmax(0, 1fr); } .multilogin-script-manager .script-actions .cbi-button { flex: 1 1 100%; } }'
        ].join('\n')));
        root.appendChild(feedback);
        root.appendChild(alert);
        root.appendChild(content);
        draw();

        return root;
    },

    handleSaveApply: null,
    handleSave: null,
    handleReset: null
});

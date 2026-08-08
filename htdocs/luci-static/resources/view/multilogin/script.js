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

var callScriptCreateDraft = rpc.declare({
    object: 'multilogin',
    method: 'script_create_draft',
    params: ['expected_sha256', 'expected_generation'],
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
            return !!unavailable || state.busy || pending(key);
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

        function runManagedUpdate() {
            if (state.busy)
                return;

            if (!confirm(_('确认检查并更新托管脚本吗？这会先检查固定来源，再验证并切换通过检查的 cqu-portal.sh。不会自动降级。')))
                return;

            var expectedGeneration = generation();
            var outcome = { kind: 'status', message: _('正在检查并更新托管脚本…') };

            function fail(response, fallback, kind) {
                var code = response && response.code;
                var messages = {
                    download_failed: _('无法连接固定更新源，未更新。'),
                    source_rejected: _('更新脚本未通过安全检查，未更新。'),
                    validation_failed: _('更新验证失败，当前脚本未改变。'),
                    activation_failed: _('更新未激活，当前脚本仍保留。'),
                    recovery_required: _('脚本需要先恢复，托管更新已停止。'),
                    conflict: _('脚本状态已变化，托管更新已停止。请刷新后重试。'),
                    invalid_state: _('当前脚本状态不允许更新，请刷新后重试。')
                };
                outcome = { kind: kind || 'error', message: messages[code] || fallback || _('托管更新未完成，当前脚本未改变。') };
                return null;
            }

            function validGeneration(value) {
                var number = Number(value);
                return Number.isInteger(number) && number >= 0;
            }

            state.busy = true;
            state.busyKey = 'managed-update';
            setFeedback('status', outcome.message);
            draw();

            L.resolveDefault(callScriptCheck(), responseError()).then(function (checkResponse) {
                if (!checkResponse || !checkResponse.ok)
                    return fail(checkResponse);

                state.check = checkResponse.data || {};
                if (!state.check.available)
                    return fail(null, _('当前已是最新版本，无需更新。'), 'status');

                if (state.check.downgrade || state.check.relation === 'older')
                    return fail(null, _('发现较旧版本，未更新；不会自动降级。'));

                if (state.check.relation !== 'newer' && state.check.relation !== 'same_version_changed')
                    return fail(null, _('无法确认更新版本，未更新。'));

                return L.resolveDefault(callScriptStage(expectedGeneration), responseError()).then(function (stageResponse) {
                    if (!stageResponse || !stageResponse.ok)
                        return fail(stageResponse);

                    var stageData = stageResponse.data || {};
                    var candidate = stageData.candidate || {};
                    var candidateHash = hash(candidate);
                    var stageGeneration = Number(stageData.generation);
                    if (!candidateHash || !validGeneration(stageGeneration))
                        return fail(null, _('更新状态无效，未更新。'));

                    return L.resolveDefault(callScriptValidate('candidate', candidateHash, stageGeneration, true), responseError()).then(function (validateResponse) {
                        if (!validateResponse || !validateResponse.ok)
                            return fail(validateResponse);

                        var validateData = validateResponse.data || {};
                        var validatedHash = hash(validateData.summary) || candidateHash;
                        var validateGeneration = Number(validateData.generation);
                        if (!validatedHash || !validGeneration(validateGeneration))
                            return fail(null, _('更新验证状态无效，未更新。'));

                        return L.resolveDefault(callScriptActivate('candidate', validatedHash, validateGeneration, true, false), responseError()).then(function (activateResponse) {
                            if (!activateResponse || !activateResponse.ok)
                                return fail(activateResponse);

                            var validation = activateResponse.data && activateResponse.data.validation;
                            outcome = {
                                kind: 'status',
                                message: validation && validation.status === 'offline' ?
                                    _('托管脚本已更新；当前接口离线。') : _('托管脚本已更新。')
                            };
                            return activateResponse;
                        });
                    });
                });
            }).then(function () {
                return refresh({ preserveTypedDraft: true });
            }).catch(function () {
                outcome = { kind: 'error', message: _('托管更新未完成，当前脚本未改变。') };
            }).then(function () {
                state.busy = false;
                state.busyKey = '';
                setFeedback(outcome.kind, outcome.message);
                draw();
            });
        }

        function runCustomApply() {
            if (state.busy || !requireCustomMutationAllowed())
                return;
            if (!getDraftText()) {
                setFeedback('error', _('脚本内容不能为空。'));
                draw();
                return;
            }
            if (!confirm(_('确认保存并启用这个自定义脚本吗？系统会先保存，再以 root 权限执行自检；只有验证通过才会替换当前活动脚本。')))
                return;

            var draftState = state.draft && state.draft.ok ? summary(state.draft.data, 'summary') : emptySummary();
            var draftSaved = customDraftIsSaved();
            var workGeneration = generation();
            var workSummary = draftState;
            var savedDuringApply = false;
            var outcome = { kind: 'status', message: _('正在保存并验证自定义脚本…') };

            function accept(response, summaryName) {
                if (!response || !response.ok)
                    return Promise.reject(response || responseError());
                var data = response.data || {};
                workGeneration = Number(data.generation);
                workSummary = summary(data, summaryName);
                if (!Number.isInteger(workGeneration) || workGeneration < 0 || !hash(workSummary))
                    return Promise.reject({ ok: false, code: 'invalid_state', data: {} });
                return response;
            }

            state.busy = true;
            state.busyKey = 'custom-apply';
            setFeedback(outcome.kind, outcome.message);
            draw();

            var sequence = draftSaved ? Promise.resolve() :
                L.resolveDefault(callScriptSaveDraft(getDraftText(), state.draftBaseHash, workGeneration), responseError())
                    .then(function (response) { return accept(response, 'custom'); })
                    .then(function (response) { savedDuringApply = true; return response; });

            sequence.then(function () {
                if (workSummary.status === 'validated')
                    return null;
                return L.resolveDefault(callScriptValidate('custom', hash(workSummary), workGeneration, true), responseError())
                    .then(function (response) { return accept(response, 'summary'); });
            }).then(function () {
                return L.resolveDefault(callScriptActivate('custom', hash(workSummary), workGeneration, true, false), responseError());
            }).then(function (response) {
                if (!response || !response.ok)
                    return Promise.reject(response || responseError());
                outcome = { kind: 'status', message: _('自定义脚本已保存、验证并启用。') };
                return refresh({ preserveTypedDraft: true, updateDraftBase: true });
            }).catch(function (response) {
                var failure = preserveConflictDraft(state, response);
                var adoptSavedBase = savedDuringApply && (!response || response.code !== 'conflict');
                state.conflict = state.conflict || failure.conflict;
                outcome = { kind: 'error', message: failure.message };
                return refresh({ preserveTypedDraft: true, updateDraftBase: adoptSavedBase });
            }).then(function () {
                state.busy = false;
                state.busyKey = '';
                setFeedback(outcome.kind, outcome.message);
                draw();
            });
        }

        function createDraftFromActive() {
            var active = summary(currentInfo(), 'active');
            var typedText = getDraftText();
            if (!active.present || !hash(active) || currentInfo().mode !== 'managed') {
                setFeedback('error', _('当前活动脚本不能作为浏览器草稿载入。您仍可在编辑器中粘贴完整脚本。'));
                draw();
                return;
            }
            if (!confirm(typedText ?
                _('编辑器中尚未保存的内容将被当前托管脚本替换。确认继续吗？当前活动脚本不会被修改。') :
                _('要把当前托管脚本复制为可编辑的自定义脚本吗？当前活动脚本不会被修改。')))
                return;
            runAction(_('载入当前脚本'), function () {
                return callScriptCreateDraft(hash(active), generation());
            }, { preserveTypedDraft: false, updateDraftBase: true, actionKey: 'custom-create' });
        }

        function discardCustomChanges(draftState, draftSaved) {
            if (!requireCustomMutationAllowed())
                return;
            if (!draftSaved) {
                if (!confirm(_('放弃编辑器中尚未保存的修改吗？')))
                    return;
                state.draftText = state.savedDraftText;
                setFeedback('status', _('未保存的修改已放弃。'));
                draw();
                return;
            }
            if (!draftState.present)
                return;
            if (!confirm(_('删除已保存的自定义脚本吗？当前活动脚本不会被删除。')))
                return;
            runAction(_('删除自定义脚本'), function () {
                return callScriptDiscardDraft(hash(draftState), generation());
            }, { preserveTypedDraft: false, updateDraftBase: true, actionKey: 'custom-discard' });
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
            var factory = summary(info, 'factory');
            var active = summary(info, 'active');
            var custom = summary(info, 'custom');
            var draftState = state.draft && state.draft.ok ? summary(state.draft.data, 'summary') : custom;
            var draftLoadError = state.draft && !state.draft.ok && state.draft.code !== 'not_found';
            var draftMissing = !draftState.present;
            var customActive = info.mode === 'custom' && hash(active) && hash(active) === hash(draftState);
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
                'disabled': disabledAttr(draftLoadError || state.busy)
            }, state.draftText);

            textarea.addEventListener('input', function () {
                state.draftText = textarea.value;
            });

            var draftSaved = !state.conflict && textarea.value === state.savedDraftText;
            function draftStatusLabel() {
                if (customActive && draftSaved)
                    return _('正在使用');
                if (draftMissing)
                    return _('尚未保存');
                if (!draftSaved)
                    return _('有未保存修改');
                if (draftState.status === 'validated')
                    return _('已验证，可启用');
                if (draftState.status === 'draft')
                    return _('已保存');
                return _('已保存');
            }

            root.setAttribute('aria-busy', state.busy ? 'true' : 'false');

            content.replaceChildren.apply(content, compact([
                E('div', { 'class': 'ml-page__header script-page-header' }, [
                    E('div', { 'class': 'ml-page__heading' }, [
                        E('h2', { 'class': 'ml-page__title' }, _('脚本维护')),
                        E('p', { 'class': 'ml-page__description' }, _('更新托管脚本，或手动维护一个自定义 cqu-portal.sh。'))
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
                    }, _('自定义脚本'))
                ]),
                (!state.info.ok || info.recovery_required || draftLoadError) ? E('div', { 'class': 'alert-message', 'role': 'alert', 'aria-live': 'assertive' }, [
                    E('p', {}, info.recovery_required ? actionError({ code: 'recovery_required' }) :
                        (!state.info.ok ? actionError(state.info) : actionError(state.draft))),
                    nativeButton(_('刷新脚本状态'), retryLoad, pending('refresh'))
                ]) : null,
                state.path === 'managed' ? E('div', { 'id': 'managed-path', 'role': 'tabpanel', 'aria-labelledby': 'managed-path-tab' }, [
                    E('section', { 'class': 'ml-section ml-card script-panel script-managed-panel', 'aria-labelledby': 'managed-heading' }, [
                        E('div', { 'class': 'ml-section__header' }, [
                            E('div', {}, [
                                E('h3', { 'id': 'managed-heading' }, _('托管更新')),
                                E('p', { 'class': 'ml-help' }, _('一次点击并确认后，页面会检查固定来源、暂存、验证并切换通过检查的 cqu-portal.sh。发现无更新、较旧版本或任一步失败时，当前脚本保持不变。'))
                            ])
                        ]),
                        E('div', { 'class': 'script-actions script-managed-actions' }, [
                            operationButton(_('检查并更新'), runManagedUpdate, 'managed-update', managedUnavailable, true)
                        ])
                    ]),
                    E('section', { 'class': 'ml-section ml-card script-recovery-actions', 'aria-labelledby': 'managed-recovery-heading' }, compact([
                        E('div', { 'class': 'ml-section__header' }, [
                            E('div', {}, [
                                E('h3', { 'id': 'managed-recovery-heading' }, _('恢复软件包内置脚本')),
                                E('p', { 'class': 'ml-help' }, _('恢复固定的软件包内置脚本会替换当前活动脚本；此操作需要单独确认。'))
                            ])
                        ]),
                        E('div', { 'class': 'script-actions' }, [
                            operationButton(_('恢复软件包内置脚本'), function () {
                                if (!confirm(_('确认恢复软件包内置脚本吗？这会替换当前活动脚本。')))
                                    return;
                                runAction(_('恢复软件包内置脚本'), function () {
                                    return callScriptRestore(hash(factory), generation(), true);
                                }, { preserveTypedDraft: true, actionKey: 'managed-restore' });
                            }, 'managed-restore', managedUnavailable || !factory.present, false, true)
                        ]),
                        !factory.present ? E('p', { 'class': 'ml-help' }, _('软件包内置脚本当前不可用。')) : null
                    ]))
                ]) : E('div', { 'id': 'custom-path', 'role': 'tabpanel', 'aria-labelledby': 'custom-path-tab' }, [
                    E('section', { 'class': 'ml-section ml-card script-panel', 'aria-labelledby': 'custom-heading' }, compact([
                        E('div', { 'class': 'ml-section__header' }, [
                            E('div', {}, [
                                E('h3', { 'id': 'custom-heading' }, _('自定义脚本')),
                                E('p', { 'class': 'ml-help' }, _('在这里粘贴或修改完整脚本。保存不会改变当前运行脚本；“保存并启用”会先验证，验证通过后才切换。'))
                            ]),
                            statusBadge(draftStatusLabel(), draftMissing || !draftSaved ? 'warning' : (customActive || draftState.status === 'validated' ? 'success' : 'neutral'))
                        ]),
                        E('p', { 'id': 'custom-root-warning', 'class': 'script-root-warning', 'role': 'note' }, _('此处执行 root 级代码。不要把账号、密码或其他机密写入脚本。')),
                        draftMissing ? E('div', { 'class': 'ml-feedback ml-feedback--empty' }, compactChildren([
                            E('p', {}, _('当前没有已保存的自定义脚本。可以直接粘贴完整脚本，或载入当前托管脚本作为修改起点。')),
                            info.mode === 'managed' && active.present ? operationButton(_('载入当前脚本'), createDraftFromActive, 'custom-create', customUnavailable, false) : null
                        ])) : null,
                        E('div', { 'class': 'script-editor-shell' }, [
                            E('label', { 'for': 'custom-draft', 'class': 'ml-field__label' }, _('脚本内容')),
                            textarea,
                            E('p', { 'id': 'custom-draft-help', 'class': 'cbi-section-descr' }, _('编辑器内可横向滚动；保存后仍不会自动启用。'))
                        ]),
                        state.conflict ? E('p', { 'class': 'alert-message', 'role': 'alert' }, _('服务器上的自定义脚本已变化。您的输入仍在编辑器中；请重新载入后再继续。')) : null,
                        E('div', { 'class': 'script-actions script-custom-actions' }, [
                            operationButton(_('保存'), function () {
                                if (!requireCustomMutationAllowed())
                                    return;
                                runAction(_('保存自定义脚本'), function () {
                                    return callScriptSaveDraft(getDraftText(), state.draftBaseHash, generation());
                                }, { preserveTypedDraft: true, updateDraftBase: true, actionKey: 'custom-save' });
                            }, 'custom-save', customUnavailable || state.conflict || draftSaved || !textarea.value, !customActive),
                            operationButton(customActive && draftSaved ? _('已启用') : _('保存并启用'), runCustomApply, 'custom-apply', customUnavailable || state.conflict || !textarea.value || (customActive && draftSaved), true),
                            nativeButton(_('重新载入'), reloadServerDraft, customUnavailable || !state.draft.ok),
                            operationButton(draftSaved ? _('删除自定义脚本') : _('放弃修改'), function () {
                                discardCustomChanges(draftState, draftSaved);
                            }, 'custom-discard', customUnavailable || state.conflict || (draftMissing && draftSaved), false, true)
                        ])
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
            '.multilogin-script-manager .script-actions { display: flex; flex-wrap: wrap; gap: .5rem; margin: 1rem 0; min-width: 0; }',
            '.multilogin-script-manager .script-actions .cbi-button { min-height: 44px; touch-action: manipulation; }',
            '.multilogin-script-manager .script-checkbox { display: flex; align-items: flex-start; gap: .5rem; min-width: 0; }',
            '.multilogin-script-manager .script-checkbox input { min-width: 1.25rem; min-height: 1.25rem; margin-top: .15rem; }',
            '.multilogin-script-manager .script-metadata { margin: 0; min-width: 0; }',
            '.multilogin-script-manager .script-metadata-row { display: grid; grid-template-columns: minmax(9rem, 1fr) minmax(0, 2fr); gap: .5rem; padding: .35rem 0; min-width: 0; }',
            '.multilogin-script-manager .script-metadata dd { margin: 0; overflow-wrap: anywhere; min-width: 0; }',
            '.multilogin-script-manager .script-editor { box-sizing: border-box; display: block; width: 100%; max-width: 100%; min-width: 0; min-height: 18rem; max-height: 70vh; overflow: auto; white-space: pre; font-family: monospace; }',
            '.multilogin-script-manager .script-feedback:empty, .multilogin-script-manager > .alert-message:empty { display: none; }',
            '@media (max-width: 600px) { .multilogin-script-manager .script-path-tab { flex-basis: 100%; } }',
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

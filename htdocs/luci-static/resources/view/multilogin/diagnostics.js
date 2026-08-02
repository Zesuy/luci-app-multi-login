'use strict';
'require view';
'require rpc';
'require ui';

var callDiagnostics = rpc.declare({ object: 'multilogin', method: 'get_diagnostics', expect: { '': {} } });
var callLogs = rpc.declare({ object: 'multilogin', method: 'get_logs', expect: { '': {} } });
var callClearLogs = rpc.declare({ object: 'multilogin', method: 'clear_logs', expect: { '': {} } });

function compact(children) {
    return children.filter(function (child) { return child !== null && child !== undefined; });
}

function disabledAttr(value) { return value ? 'disabled' : null; }
function failed(message) { return { ok: false, code: 'internal_error', message: message || _('无法读取诊断信息。'), data: {} }; }
function button(label, click, disabled, kind) { return E('button', { class: 'btn cbi-button ml-button ' + (kind || 'cbi-button-action'), type: 'button', disabled: disabledAttr(disabled), click: click }, label); }
function text(response) { return (response && response.message) || _('操作未完成，请重试。'); }
function availabilityText(value) { return value ? _('可用') : _('不可用'); }
function status(label, kind) { return E('span', { class: 'ml-status ml-status--' + (kind || 'neutral') }, label); }
function badge(value) { return status(availabilityText(value), value ? 'success' : 'error'); }
function kv(label, value) { return E('div', { class: 'ml-kv' }, [E('dt', {}, label), E('dd', {}, value)]); }

return view.extend({
    load: function () { return Promise.all([L.resolveDefault(callDiagnostics(), failed()), L.resolveDefault(callLogs(), failed())]); },
    render: function (initial) {
        var state = { diagnostics: initial[0] || failed(), logs: initial[1] || failed(), busy: false, feedback: '', error: false };
        var root = E('div', { class: 'cbi-map multilogin-page ml-page ml-page--diagnostics', 'aria-busy': 'false' });
        function refresh(message) {
            state.busy = true; state.feedback = message || _('正在刷新诊断信息…'); state.error = false; draw();
            return Promise.all([L.resolveDefault(callDiagnostics(), failed()), L.resolveDefault(callLogs(), failed())]).then(function (results) {
                state.diagnostics = results[0] || failed(); state.logs = results[1] || failed(); state.busy = false;
                if (!state.diagnostics.ok || !state.logs.ok) { state.feedback = _('部分诊断信息无法读取。请重试。'); state.error = true; }
                else { state.feedback = _('诊断信息已刷新。'); }
                draw();
            });
        }
        function clear() {
            ui.showModal(_('清理日志'), [E('p', {}, _('确认清理 MultiLogin 的固定诊断日志吗？此操作不能撤销。')), E('div', { class: 'right' }, [button(_('取消'), ui.hideModal, false, 'cbi-button'), button(_('清理日志'), function () {
                ui.hideModal(); state.busy = true; state.feedback = _('正在清理日志…'); state.error = false; draw();
                L.resolveDefault(callClearLogs(), failed()).then(function (response) { if (!response.ok) { state.busy = false; state.feedback = text(response); state.error = true; draw(); } else refresh(_('日志已清理。')); });
            }, false, 'cbi-button-negative')])]);
        }
        function dependencyRows(dependencies) {
            return [kv(_('bash'), badge(dependencies.bash)), kv(_('curl'), badge(dependencies.curl)), kv(_('mwan3'), badge(dependencies.mwan3)), kv(_('jsonfilter'), badge(dependencies.jsonfilter))];
        }
        function recoveryRows(diagnostics) {
            return [kv(_('脚本恢复'), E('span', {}, [badge(!diagnostics.script_recovery_required), E('span', { class: 'ml-help' }, diagnostics.script_recovery_required ? _('需要处理') : _('正常'))])), kv(_('网络恢复'), E('span', {}, [badge(!diagnostics.network_recovery_required), E('span', { class: 'ml-help' }, diagnostics.network_recovery_required ? _('需要处理') : _('正常'))])), kv(_('受管代次'), diagnostics.owned_generation == null ? status(_('不可用'), 'neutral') : E('span', { class: 'ml-code' }, String(diagnostics.owned_generation)))];
        }
        function draw() {
            var diagnostics = state.diagnostics.ok ? state.diagnostics.data : null, logs = state.logs.ok ? state.logs.data : null;
            var hasLogContent = !!(logs && logs.content);
            root.replaceChildren.apply(root, compact([
                E('link', { rel: 'stylesheet', href: L.resource('view/multilogin/multi-login.css') }),
                E('div', { class: 'ml-page__header' }, [E('div', { class: 'ml-page__heading' }, [E('h2', { class: 'ml-page__title' }, _('诊断')), E('p', { class: 'ml-page__description' }, _('显示固定 MultiLogin 日志的有界、经过服务器端脱敏的内容。不会读取任意文件或显示原始命令输出。'))]), E('div', { class: 'ml-page__header-actions' }, [button(state.busy ? _('正在刷新…') : _('刷新诊断与日志'), function () { refresh(); }, state.busy)])]),
                state.feedback ? E('div', { class: state.error ? 'ml-feedback ml-feedback--error' : 'ml-feedback ml-feedback--success', role: state.error ? 'alert' : 'status', 'aria-live': state.error ? 'assertive' : 'polite', 'aria-atomic': 'true' }, compact([E('p', {}, state.feedback), state.error ? button(_('重试'), function () { refresh(); }, state.busy) : null])) : null,
                diagnostics ? E('section', { class: 'ml-section ml-card', 'aria-labelledby': 'ml-diagnostics-summary-heading' }, [E('div', { class: 'ml-section__header' }, [E('div', {}, [E('h3', { id: 'ml-diagnostics-summary-heading' }, _('环境摘要')), E('p', { class: 'ml-help' }, _('状态只反映当前只读检查结果；它不会启动服务或发起门户请求。'))])]), E('div', { class: 'ml-grid ml-grid--3' }, [E('div', { class: 'ml-card' }, [E('h4', {}, _('依赖')), E('dl', { class: 'ml-kv-list' }, dependencyRows(diagnostics.dependencies))]), E('div', { class: 'ml-card' }, [E('h4', {}, _('服务')), E('dl', { class: 'ml-kv-list' }, [kv(_('运行状态'), E('span', {}, [badge(diagnostics.service.running), E('span', { class: 'ml-help' }, diagnostics.service.running ? _('运行中') : _('未运行'))])), kv(_('开机状态'), E('span', {}, [badge(diagnostics.service.enabled), E('span', { class: 'ml-help' }, diagnostics.service.enabled ? _('已启用') : _('未启用'))]))])]), E('div', { class: 'ml-card' }, [E('h4', {}, _('恢复状态')), E('dl', { class: 'ml-kv-list' }, recoveryRows(diagnostics))])])]) : E('div', { class: 'ml-feedback ml-feedback--error', role: 'alert', 'aria-live': 'assertive' }, [E('p', {}, text(state.diagnostics)), button(_('重试'), function () { refresh(); }, state.busy)]),
                logs ? E('section', { class: 'ml-section ml-card', 'aria-labelledby': 'ml-logs-heading' }, [E('div', { class: 'ml-section__header' }, [E('div', {}, [E('h3', { id: 'ml-logs-heading' }, _('已脱敏日志')), E('p', { class: 'ml-help' }, logs.truncated ? _('仅显示已验证脱敏后的末尾内容，较早内容已截断。') : _('日志已在服务器端进行有界读取和脱敏。'))]), E('div', { class: 'ml-actions' }, [status(_('已脱敏'), 'success'), logs.truncated ? status(_('已截断'), 'warning') : status(_('完整范围'), 'neutral')])]), hasLogContent ? E('pre', { id: 'ml-log-content', class: 'ml-code-output', tabindex: '0', role: 'region', 'aria-label': _('已脱敏 MultiLogin 日志') }, logs.content) : E('div', { class: 'ml-empty', role: 'status' }, E('p', {}, _('暂无日志。日志产生后会显示在这里。'))), E('div', { class: 'ml-toolbar' }, [button(_('刷新诊断与日志'), function () { refresh(); }, state.busy), button(_('清理日志'), clear, state.busy, 'cbi-button-negative')])]) : E('div', { class: 'ml-feedback ml-feedback--error', role: 'alert', 'aria-live': 'assertive' }, [E('p', {}, text(state.logs)), button(_('重试'), function () { refresh(); }, state.busy)]),
                E('div', { class: 'ml-help', role: 'note' }, _('日志清理不可撤销；页面不会显示账号密码、Cookie 或任意命令输出。'))
            ]));
            root.setAttribute('aria-busy', state.busy ? 'true' : 'false');
        }
        draw(); return root;
    }, handleSave: null, handleSaveApply: null, handleReset: null
});

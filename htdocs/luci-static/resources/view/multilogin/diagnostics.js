'use strict';
'require view';
'require rpc';
'require ui';

var callDiagnostics = rpc.declare({ object: 'multilogin', method: 'get_diagnostics', expect: {} });
var callLogs = rpc.declare({ object: 'multilogin', method: 'get_logs', expect: {} });
var callClearLogs = rpc.declare({ object: 'multilogin', method: 'clear_logs', expect: {} });

function failed(message) { return { ok: false, code: 'internal_error', message: message || _('无法读取诊断信息。'), data: {} }; }
function button(label, click, disabled, kind) { return E('button', { class: 'btn cbi-button ' + (kind || 'cbi-button-action'), type: 'button', style: 'min-height:44px;margin:.2em', disabled: disabled, click: click }, label); }
function text(response) { return (response && response.message) || _('操作未完成，请重试。'); }
function status(value) { return value ? _('可用') : _('不可用'); }

return view.extend({
    load: function () { return Promise.all([L.resolveDefault(callDiagnostics(), failed()), L.resolveDefault(callLogs(), failed())]); },
    render: function (initial) {
        var state = { diagnostics: initial[0] || failed(), logs: initial[1] || failed(), busy: false, feedback: '', error: false };
        var root = E('div', { class: 'cbi-map multilogin-page', 'aria-live': 'polite' });
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
        function draw() {
            var diagnostics = state.diagnostics.ok ? state.diagnostics.data : null, logs = state.logs.ok ? state.logs.data : null;
            root.replaceChildren(E('h2', {}, _('诊断')), E('p', { class: 'cbi-map-descr' }, _('显示固定 MultiLogin 日志的有界、经过服务器端脱敏的内容。不会读取任意文件或显示原始命令输出。')),
                state.feedback ? E('div', { class: state.error ? 'alert-message' : 'alert-message notice', role: state.error ? 'alert' : 'status' }, [E('p', {}, state.feedback), state.error ? button(_('重试'), function () { refresh(); }, state.busy) : null]) : null,
                diagnostics ? E('div', { class: 'cbi-section' }, [E('legend', {}, _('环境摘要')), E('div', { class: 'cbi-value' }, [E('div', { class: 'cbi-value-title' }, _('依赖')), E('div', { class: 'cbi-value-field' }, _('bash：%s；curl：%s；mwan3：%s；jsonfilter：%s').format(status(diagnostics.dependencies.bash), status(diagnostics.dependencies.curl), status(diagnostics.dependencies.mwan3), status(diagnostics.dependencies.jsonfilter)))]), E('div', { class: 'cbi-value' }, [E('div', { class: 'cbi-value-title' }, _('服务')), E('div', { class: 'cbi-value-field' }, _('%s；%s').format(diagnostics.service.enabled ? _('已启用') : _('未启用'), diagnostics.service.running ? _('运行中') : _('未运行')))]), E('div', { class: 'cbi-value' }, [E('div', { class: 'cbi-value-title' }, _('恢复状态')), E('div', { class: 'cbi-value-field' }, _('脚本：%s；网络：%s；受管代次：%s').format(diagnostics.script_recovery_required ? _('需要处理') : _('正常'), diagnostics.network_recovery_required ? _('需要处理') : _('正常'), diagnostics.owned_generation == null ? _('不可用') : String(diagnostics.owned_generation)))] )]) : E('div', { class: 'alert-message', role: 'alert' }, [E('p', {}, text(state.diagnostics)), button(_('重试'), function () { refresh(); }, state.busy)]),
                logs ? E('div', { class: 'cbi-section' }, [E('legend', {}, _('已脱敏日志')), E('p', { class: 'cbi-section-descr' }, logs.truncated ? _('仅显示已验证脱敏后的末尾内容，较早内容已截断。') : _('日志已在服务器端进行有界读取和脱敏。')), E('label', { for: 'ml-log-content' }, _('日志内容')), E('textarea', { id: 'ml-log-content', class: 'cbi-input-text', readonly: 'readonly', rows: 18, wrap: 'off', style: 'box-sizing:border-box;width:100%;max-width:100%;min-height:18em;overflow:auto', 'aria-label': _('已脱敏 MultiLogin 日志') }, logs.content || _('暂无日志。')), E('div', { class: 'right' }, [button(_('刷新日志'), function () { refresh(); }, state.busy), button(_('清理日志'), clear, state.busy, 'cbi-button-negative')])]) : E('div', { class: 'alert-message', role: 'alert' }, [E('p', {}, text(state.logs)), button(_('重试'), function () { refresh(); }, state.busy)]));
            root.setAttribute('aria-busy', state.busy ? 'true' : 'false');
        }
        draw(); return root;
    }, handleSave: null, handleSaveApply: null, handleReset: null
});

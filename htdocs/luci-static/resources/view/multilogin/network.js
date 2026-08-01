'use strict';
'require view';
'require rpc';
'require ui';

var callListAuto = rpc.declare({ object: 'multilogin', method: 'list_auto', expect: {} });
var callQuickSetup = rpc.declare({ object: 'multilogin', method: 'quick_setup', params: ['base_iface', 'count'], expect: {} });
var callRemoveAuto = rpc.declare({ object: 'multilogin', method: 'remove_auto', expect: {} });
var callRecover = rpc.declare({ object: 'multilogin', method: 'network_recover', expect: {} });

function failure() { return { ok: false, code: 'internal_error', message: _('无法读取受管网络状态。'), data: {} }; }
function button(label, click, disabled, kind) { return E('button', { class: 'btn cbi-button ' + (kind || 'cbi-button-action'), type: 'button', style: 'min-height:44px;margin:.2em', disabled: disabled, click: click }, label); }
function message(response) { return (response && response.message) || _('操作未完成，请重试。'); }

return view.extend({
    load: function () { return L.resolveDefault(callListAuto(), failure()); },
    render: function (initial) {
        var state = { response: initial || failure(), busy: false, feedback: '', error: false };
        var root = E('div', { class: 'cbi-map multilogin-page', 'aria-live': 'polite' });
        function reload(text) {
            state.busy = true; state.feedback = text || _('正在读取受管网络状态…'); state.error = false; draw();
            L.resolveDefault(callListAuto(), failure()).then(function (response) {
                state.response = response || failure(); state.busy = false;
                if (!state.response.ok) { state.feedback = message(state.response); state.error = true; }
                else { state.feedback = _('受管网络状态已刷新。'); state.error = false; }
                draw();
            });
        }
        function run(request, success) {
            if (state.busy) return;
            state.busy = true; state.feedback = _('正在处理受管网络事务…'); state.error = false; draw();
            L.resolveDefault(request(), failure()).then(function (response) {
                if (!response.ok) { state.busy = false; state.feedback = message(response); state.error = true; draw(); return; }
                state.feedback = success; state.error = false; reload(success);
            });
        }
        function confirm(title, text, request, success, negative) {
            ui.showModal(title, [E('p', {}, text), E('div', { class: 'right' }, [button(_('取消'), ui.hideModal, false, 'cbi-button'), button(_('确认'), function () { ui.hideModal(); run(request, success); }, false, negative ? 'cbi-button-negative' : 'cbi-button-action')])]);
        }
        function draw() {
            var response = state.response, data = response.ok ? response.data : { interfaces: [], count: 0 }, recovery = response.ok && data.recovery_required;
            var rows = data.interfaces && data.interfaces.length ? data.interfaces.map(function (iface) { return E('tr', { class: 'tr' }, [E('td', { class: 'td' }, iface.name), E('td', { class: 'td' }, iface.device), E('td', { class: 'td' }, String(iface.metric))]); }) : [E('tr', { class: 'tr' }, E('td', { class: 'td', colspan: '3' }, _('没有由 MultiLogin 记录为已拥有的接口。未记录的 auto_* 或同名对象不会显示、更不会被删除。')))];
            root.replaceChildren(
                E('h2', {}, _('网络')),
                E('p', { class: 'cbi-map-descr' }, _('仅管理由 MultiLogin 精确记录的 ml3 资源。页面不会扫描、认领或按名称前缀删除其他网络、防火墙或 mwan3 配置。')),
                state.feedback ? E('div', { class: state.error ? 'alert-message' : 'alert-message notice', role: state.error ? 'alert' : 'status' }, [E('p', {}, state.feedback), state.error ? button(_('重试'), function () { reload(); }, state.busy) : null]) : null,
                recovery ? E('div', { class: 'alert-message', role: 'alert' }, [E('p', {}, _('检测到未完成或需要人工处理的网络恢复记录。新的生成和删除已被阻止。')), button(_('执行固定恢复检查'), function () { run(callRecover, _('恢复检查已完成。')); }, state.busy)]) : null,
                response.ok ? E('div', { class: 'cbi-section' }, [E('legend', {}, _('受管资源')), E('p', { class: 'cbi-section-descr' }, data.count ? _('当前基于 %s 管理 %s 个接口。').format(data.base_iface, data.count) : _('尚未创建受管网络资源。')), E('div', { style: 'overflow-x:auto' }, E('table', { class: 'table cbi-section-table' }, [E('thead', {}, E('tr', { class: 'tr table-titles' }, [E('th', { class: 'th' }, _('逻辑接口')), E('th', { class: 'th' }, _('设备')), E('th', { class: 'th' }, _('路由跃点'))])), E('tbody', {}, rows)])), data.count ? E('div', { class: 'right' }, button(_('删除受管资源'), function () { confirm(_('删除受管资源'), _('仅删除精确记录在 MultiLogin 所有权状态中的资源；不会按 auto_* 前缀清理其他对象。'), callRemoveAuto, _('受管资源已删除。'), true); }, state.busy, 'cbi-button-negative')) : null]) : null,
                response.ok && !recovery ? E('div', { class: 'cbi-section' }, [
                    E('legend', {}, _('创建受管资源')),
                    E('p', { class: 'cbi-section-descr' }, _('输入基础接口名称和数量（1–10）。提交前后端都会验证所有权、碰撞和恢复状态；不会覆盖未拥有的对象。')),
                    E('div', { class: 'cbi-value' }, [
                        E('label', { class: 'cbi-value-title', for: 'ml-base-iface' }, _('基础接口')),
                        E('div', { class: 'cbi-value-field' }, [
                            E('input', { id: 'ml-base-iface', type: 'text', class: 'cbi-input-text', value: data.base_iface || '', style: 'min-height:38px;max-width:20em;width:100%', 'aria-describedby': 'ml-base-help' }),
                            E('div', { id: 'ml-base-help', class: 'cbi-value-description' }, _('例如 eth0。此页面不从浏览器读取设备配置。'))
                        ])
                    ]),
                    E('div', { class: 'cbi-value' }, [
                        E('label', { class: 'cbi-value-title', for: 'ml-count' }, _('数量')),
                        E('div', { class: 'cbi-value-field' }, E('select', { id: 'ml-count', class: 'cbi-input-select', style: 'min-height:38px' }, Array.from({ length: 10 }, function (_, index) { var value = index + 1; return E('option', { value: String(value), selected: value === data.count ? 'selected' : null }, String(value)); })))
                    ]),
                    E('div', { class: 'right' }, button(_('创建或更新受管资源'), function () {
                        var iface = document.getElementById('ml-base-iface').value, count = Number(document.getElementById('ml-count').value);
                        if (!iface) { state.feedback = _('请输入基础接口名称。'); state.error = true; draw(); return; }
                        confirm(_('确认网络事务'), _('将创建或更新由 MultiLogin 精确拥有的资源。未拥有或冲突的资源会使操作安全失败。'), function () { return callQuickSetup(iface, count); }, _('受管网络事务已完成。'));
                    }, state.busy))
                ]) : null,
                E('div', { class: 'right' }, button(state.busy ? _('正在刷新…') : _('刷新'), function () { reload(); }, state.busy))
            );
            root.setAttribute('aria-busy', state.busy ? 'true' : 'false');
        }
        draw(); return root;
    }, handleSave: null, handleSaveApply: null, handleReset: null
});

'use strict';
'require view';
'require rpc';
'require ui';

var callListAuto = rpc.declare({ object: 'multilogin', method: 'list_auto', expect: { '': {} } });
var callQuickSetup = rpc.declare({ object: 'multilogin', method: 'quick_setup', params: ['base_iface', 'count'], expect: { '': {} } });
var callRemoveAuto = rpc.declare({ object: 'multilogin', method: 'remove_auto', expect: { '': {} } });
var callRecover = rpc.declare({ object: 'multilogin', method: 'network_recover', expect: { '': {} } });

function compact(children) {
    return children.filter(function (child) { return child !== null && child !== undefined; });
}

function disabledAttr(value) { return value ? 'disabled' : null; }
function failure() { return { ok: false, code: 'internal_error', message: _('无法读取受管网络状态。'), data: {} }; }
function button(label, click, disabled, kind) { return E('button', { class: 'btn cbi-button ml-button ' + (kind || 'cbi-button-action'), type: 'button', disabled: disabledAttr(disabled), click: click }, label); }
function message(response) { return (response && response.message) || _('操作未完成，请重试。'); }
function status(label, kind) { return E('span', { class: 'ml-status ml-status--' + (kind || 'neutral') }, label); }
function tableWrap(label, table) { return E('div', { class: 'ml-table-wrap', tabindex: '0', role: 'region', 'aria-label': label }, table); }

return view.extend({
    load: function () { return L.resolveDefault(callListAuto(), failure()); },
    render: function (initial) {
        var state = { response: initial || failure(), busy: false, feedback: '', error: false };
        var root = E('div', { class: 'cbi-map multilogin-page ml-page ml-page--network', 'aria-busy': 'false' });
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
            var hasResources = data.interfaces && data.interfaces.length;
            var resourceLabel = data.recovery_required ? _('需要恢复') : (data.count ? _('已记录') : _('尚未配置'));
            var resourceKind = data.recovery_required ? 'warning' : (data.count ? 'success' : 'neutral');
            var rows = hasResources ? data.interfaces.map(function (iface) { return E('tr', { class: 'tr' }, [E('td', { class: 'td', 'data-label': _('逻辑接口') }, E('span', { class: 'ml-code' }, iface.name)), E('td', { class: 'td', 'data-label': _('设备') }, E('span', { class: 'ml-code' }, iface.device)), E('td', { class: 'td', 'data-label': _('路由优先级（Metric）') }, String(iface.metric))]); }) : [];
            root.replaceChildren.apply(root, compact([
                E('link', { rel: 'stylesheet', href: L.resource('view/multilogin/multi-login.css') }),
                E('div', { class: 'ml-page__header' }, [E('div', { class: 'ml-page__heading' }, [E('h2', { class: 'ml-page__title' }, _('网络')), E('p', { class: 'ml-page__description' }, _('仅管理由 MultiLogin 精确记录的 ml3 资源。页面不会扫描、认领或按名称前缀删除其他网络、防火墙或 mwan3 配置。'))]), E('div', { class: 'ml-page__header-actions' }, [button(state.busy ? _('正在刷新…') : _('刷新网络状态'), function () { reload(); }, state.busy)])]),
                state.feedback ? E('div', { class: state.error ? 'ml-feedback ml-feedback--error' : 'ml-feedback ml-feedback--success', role: state.error ? 'alert' : 'status', 'aria-live': state.error ? 'assertive' : 'polite', 'aria-atomic': 'true' }, compact([E('p', {}, state.feedback), state.error ? button(_('重试'), function () { reload(); }, state.busy) : null])) : null,
                recovery ? E('div', { class: 'ml-feedback ml-feedback--error', role: 'alert', 'aria-live': 'assertive' }, [E('p', {}, _('检测到未完成或需要人工处理的网络恢复记录。新的生成和删除已被阻止。')), button(_('执行固定恢复检查'), function () { run(callRecover, _('恢复检查已完成。')); }, state.busy)]) : null,
                response.ok ? E('section', { class: 'ml-section ml-card', 'aria-labelledby': 'ml-network-owned-heading' }, compact([E('div', { class: 'ml-section__header' }, [E('div', {}, [E('h3', { id: 'ml-network-owned-heading' }, _('受管资源')), E('p', { class: 'ml-help' }, data.count ? _('当前基于 %s 管理 %s 个接口。').format(data.base_iface, data.count) : _('尚未创建受管网络资源。'))]), status(resourceLabel, resourceKind)]), hasResources ? tableWrap(_('受管网络资源列表'), E('table', { class: 'table cbi-section-table ml-table', 'aria-label': _('受管网络资源列表') }, [E('caption', { class: 'ml-visually-hidden' }, _('受管网络资源列表')), E('thead', {}, E('tr', { class: 'tr table-titles' }, [E('th', { class: 'th', scope: 'col' }, _('逻辑接口')), E('th', { class: 'th', scope: 'col' }, _('设备')), E('th', { class: 'th', scope: 'col' }, _('路由优先级（Metric）'))])), E('tbody', {}, rows)])) : E('div', { class: 'ml-empty', role: 'status' }, [E('p', {}, _('没有由 MultiLogin 记录为已拥有的接口。未记录的 auto_* 或同名对象不会显示、更不会被删除。')), button(_('创建受管资源'), function () { var field = document.getElementById('ml-base-iface'); if (field) field.focus(); }, state.busy)]), data.count ? E('div', { class: 'right' }, button(_('删除受管资源'), function () { confirm(_('删除受管资源'), _('仅删除精确记录在 MultiLogin 所有权状态中的资源；不会按 auto_* 前缀清理其他对象。'), callRemoveAuto, _('受管资源已删除。'), true); }, state.busy, 'cbi-button-negative')) : null])) : null,
                response.ok && !recovery ? E('section', { class: 'ml-section ml-card', 'aria-labelledby': 'ml-network-create-heading' }, [E('div', { class: 'ml-section__header' }, [E('div', {}, [E('h3', { id: 'ml-network-create-heading' }, _('创建受管资源')), E('p', { class: 'ml-help' }, _('输入基础接口名称和数量（1–10）。提交前后端都会验证所有权、碰撞和恢复状态；不会覆盖未拥有的对象。'))])]), E('div', { class: 'ml-form-grid' }, [E('div', { class: 'ml-field ml-field--wide' }, [E('label', { class: 'ml-field__label', for: 'ml-base-iface' }, _('基础接口')), E('div', { class: 'ml-field__control' }, [E('input', { id: 'ml-base-iface', type: 'text', class: 'cbi-input-text', value: data.base_iface || '', 'aria-describedby': 'ml-base-help' }), E('div', { id: 'ml-base-help', class: 'ml-field__help' }, _('例如 eth0。此页面不从浏览器读取设备配置。'))])]), E('div', { class: 'ml-field' }, [E('label', { class: 'ml-field__label', for: 'ml-count' }, _('数量')), E('div', { class: 'ml-field__control' }, E('select', { id: 'ml-count', class: 'cbi-input-select' }, Array.from({ length: 10 }, function (_, index) { var value = index + 1; return E('option', { value: String(value), selected: value === data.count ? 'selected' : null }, String(value)); })))])]), E('div', { class: 'right' }, button(_('创建或更新受管资源'), function () { var iface = document.getElementById('ml-base-iface').value, count = Number(document.getElementById('ml-count').value); if (!iface) { state.feedback = _('请输入基础接口名称。'); state.error = true; draw(); return; } confirm(_('确认网络事务'), _('将创建或更新由 MultiLogin 精确拥有的资源。未拥有或冲突的资源会使操作安全失败。'), function () { return callQuickSetup(iface, count); }, _('受管网络事务已完成。')); }, state.busy))]) : null
            ]));
            root.setAttribute('aria-busy', state.busy ? 'true' : 'false');
        }
        draw(); return root;
    }, handleSave: null, handleSaveApply: null, handleReset: null
});

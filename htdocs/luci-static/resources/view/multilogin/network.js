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
function failure() { return { ok: false, code: 'internal_error', message: _('无法读取受管网络资源状态。'), data: {} }; }
function button(label, click, disabled, kind, extra) {
    var attrs = { class: 'btn cbi-button ml-button ' + (kind || 'cbi-button-action'), type: 'button', disabled: disabledAttr(disabled), click: click };
    Object.keys(extra || {}).forEach(function (key) { attrs[key] = extra[key]; });
    return E('button', attrs, label);
}
function message(response) { return (response && response.message) || _('操作未完成，请重试。'); }
function status(label, kind) { return E('span', { class: 'ml-status ml-status--' + (kind || 'neutral') }, label); }
function tableWrap(label, table) { return E('div', { class: 'ml-table-wrap', tabindex: '0', role: 'region', 'aria-label': label }, table); }

function resourcePlan(existing, desired, baseIface) {
    var current = Number(existing) || 0;
    var count = Number(desired) || 1;
    var plan = { label: '', title: '', description: '', success: '', negative: false };

    if (!current) {
        plan.label = _('创建 %s 个受管接口').format(count);
        plan.title = _('创建受管接口');
        plan.description = _('将基于基础接口“%s”创建 %s 个由 MultiLogin 明确拥有的 ml3 受管接口。未拥有的网络、防火墙或 mwan3 对象不会被覆盖。').format(baseIface, count);
        plan.success = _('%s 个受管接口已创建。').format(count);
    } else if (count > current) {
        plan.label = _('补齐缺少的受管接口');
        plan.title = _('补齐受管接口');
        plan.description = _('将基于基础接口“%s”把受管接口补齐到 %s 个；只处理 MultiLogin 所有权记录中的 ml3 资源。未拥有的对象不会被覆盖。').format(baseIface, count);
        plan.success = _('缺少的受管接口已补齐。');
    } else {
        plan.label = _('重建为 %s 个受管接口').format(count);
        plan.title = _('重建受管接口');
        plan.description = _('将基于基础接口“%s”重建为 %s 个由 MultiLogin 明确拥有的 ml3 受管接口；不会按名称前缀处理未拥有的对象。').format(baseIface, count);
        plan.success = _('受管接口已重建为 %s 个。').format(count);
        plan.negative = true;
    }

    return plan;
}

return view.extend({
    load: function () { return L.resolveDefault(callListAuto(), failure()); },
    render: function (initial) {
        var firstResponse = initial || failure();
        var state = { response: firstResponse, busy: false, feedback: firstResponse.ok ? '' : message(firstResponse), error: !firstResponse.ok, formOpen: false };
        var root = E('div', { class: 'cbi-map multilogin-page ml-page ml-page--network', 'aria-busy': 'false' });
        function reload(text) {
            state.busy = true; state.feedback = text || _('正在读取受管网络资源…'); state.error = false; draw();
            L.resolveDefault(callListAuto(), failure()).then(function (response) {
                state.response = response || failure(); state.busy = false;
                if (!state.response.ok) { state.feedback = message(state.response); state.error = true; }
                else { state.feedback = _('受管网络资源已刷新。'); state.error = false; }
                draw();
            });
        }
        function run(request, success) {
            if (state.busy) return;
            state.busy = true; state.feedback = _('正在处理受管网络资源事务…'); state.error = false; draw();
            L.resolveDefault(request(), failure()).then(function (response) {
                if (!response.ok) { state.busy = false; state.feedback = message(response); state.error = true; draw(); return; }
                state.feedback = success; state.error = false; reload(success);
            });
        }
        function confirm(title, text, request, success, negative) {
            ui.showModal(title, [E('p', {}, text), E('div', { class: 'right' }, [button(_('取消'), ui.hideModal, false, 'cbi-button'), button(_('确认'), function () { ui.hideModal(); run(request, success); }, false, negative ? 'cbi-button-negative' : 'cbi-button-action')])]);
        }
        function openBuilder() {
            var response = state.response;
            if (state.busy || (response && response.ok && response.data && response.data.recovery_required)) return;
            state.formOpen = true;
            draw();
            var field = document.getElementById('ml-base-iface');
            if (field) field.focus();
        }
        function closeBuilder() {
            if (state.busy) return;
            state.formOpen = false;
            draw();
        }
        function confirmRecovery() {
            confirm(_('确认恢复受管网络资源'), _('确认后将写入 UCI，执行 commit，并 reload network、firewall、mwan3；仅处理 MultiLogin 受管网络资源，不会触碰未记录的对象。'), callRecover, _('网络资源恢复检查已完成。'), true);
        }
        function draw() {
            var response = state.response, data = response.ok && response.data ? response.data : { interfaces: [], count: 0 }, interfaces = data.interfaces || [];
            var hasResources = interfaces.length > 0, recovery = !!(response.ok && data.recovery_required), resourceCount = Number(data.count) || 0;
            var resourceLabel = recovery ? _('需要恢复') : (resourceCount ? _('%s 个已记录').format(resourceCount) : _('尚未配置'));
            var resourceKind = recovery ? 'warning' : (resourceCount ? 'success' : 'neutral');
            var rows = hasResources ? interfaces.map(function (iface) { return E('tr', { class: 'tr' }, [E('td', { class: 'td', 'data-label': _('逻辑接口') }, E('span', { class: 'ml-code' }, iface.name)), E('td', { class: 'td', 'data-label': _('设备') }, E('span', { class: 'ml-code' }, iface.device)), E('td', { class: 'td', 'data-label': _('路由优先级（Metric）') }, String(iface.metric))]); }) : [];
            var builderTriggerAttrs = { 'aria-controls': 'ml-network-builder', 'aria-expanded': state.formOpen ? 'true' : 'false' };
            var builderTrigger = hasResources && !state.formOpen ? button(_('添加受管接口'), openBuilder, state.busy || recovery, 'cbi-button-action', builderTriggerAttrs) : null;
            var emptyAction = !hasResources && !state.formOpen ? button(_('添加受管接口'), openBuilder, state.busy || recovery, 'cbi-button-action', builderTriggerAttrs) : null;
            var resourceDelete = resourceCount ? E('div', { class: 'right' }, button(_('删除这些受管接口'), function () {
                confirm(_('删除受管接口'), _('仅删除当前受管接口列表中已记录的 MultiLogin ml3 资源；不会按 auto_* 前缀或名称清理其他网络、防火墙或 mwan3 对象。'), callRemoveAuto, _('已删除当前受管接口。'), true);
            }, state.busy || recovery, 'cbi-button-negative')) : null;
            var resourceHeaderChildren = [E('div', {}, [E('h3', { id: 'ml-network-owned-heading' }, _('受管接口')), E('p', { class: 'ml-help' }, resourceCount ? _('当前基于“%s”记录 %s 个由 MultiLogin 拥有的 ml3 受管接口。').format(data.base_iface, resourceCount) : _('尚未记录由 MultiLogin 拥有的 ml3 受管接口。'))]), builderTrigger];
            var emptyStateChildren = [E('p', {}, _('尚未创建由 MultiLogin 拥有的受管接口。未记录的 auto_* 或同名对象不会显示、更不会被删除。')), emptyAction];
            var resourceSection = response.ok ? E('section', { class: 'ml-section ml-card', 'aria-labelledby': 'ml-network-owned-heading' }, compact([
                E('div', { class: 'ml-section__header' }, compact(resourceHeaderChildren)),
                hasResources ? tableWrap(_('受管接口列表'), E('table', { class: 'table cbi-section-table ml-table', 'aria-label': _('受管接口列表') }, [E('caption', { class: 'ml-visually-hidden' }, _('受管接口列表（仅 MultiLogin 所有权）')), E('thead', {}, E('tr', { class: 'tr table-titles' }, [E('th', { class: 'th', scope: 'col' }, _('逻辑接口')), E('th', { class: 'th', scope: 'col' }, _('设备')), E('th', { class: 'th', scope: 'col' }, _('路由优先级（Metric）'))])), E('tbody', {}, rows)])) : E('div', { class: 'ml-empty', role: 'status' }, compact(emptyStateChildren)),
                resourceDelete
            ])) : null;
            var recoverySection = recovery ? E('section', { class: 'ml-section ml-card', 'aria-labelledby': 'ml-network-recovery-heading' }, [E('div', { class: 'ml-section__header' }, [E('div', {}, [E('h3', { id: 'ml-network-recovery-heading' }, _('网络资源恢复区')), E('p', { class: 'ml-help' }, _('仅处理上一笔受管网络资源事务留下的恢复记录；不会触碰未记录的网络、防火墙或 mwan3 对象。'))]), status(_('需要处理'), 'warning')]), E('div', { class: 'ml-feedback ml-feedback--error', role: 'alert', 'aria-live': 'assertive' }, [E('p', {}, _('检测到未完成或需要人工处理的受管网络资源恢复记录。新的生成、重建和删除已被阻止。')), E('div', { class: 'right' }, button(_('执行固定恢复检查'), confirmRecovery, state.busy, 'cbi-button-negative'))])]) : null;
            var builderSection = response.ok && !recovery && state.formOpen ? (function () {
                var selectedCount = resourceCount > 0 ? resourceCount : 1, countSelect, builderButton;
                function updateBuilderAction() {
                    if (builderButton) builderButton.textContent = resourcePlan(resourceCount, Number(countSelect.value) || 1, '').label;
                }
                countSelect = E('select', { id: 'ml-count', class: 'cbi-input-select', 'aria-describedby': 'ml-count-help', change: updateBuilderAction }, Array.from({ length: 10 }, function (_, index) {
                    var value = index + 1;
                    return E('option', { value: String(value), selected: value === selectedCount ? 'selected' : null }, String(value));
                }));
                builderButton = button(resourcePlan(resourceCount, selectedCount, '').label, function () {
                    var ifaceField = document.getElementById('ml-base-iface'), countField = document.getElementById('ml-count'), iface = ifaceField ? ifaceField.value : '', count = countField ? Number(countField.value) : 0;
                    if (!iface) { state.feedback = _('请输入基础接口名称。'); state.error = true; draw(); return; }
                    var plan = resourcePlan(resourceCount, count, iface);
                    confirm(plan.title, plan.description, function () { return callQuickSetup(iface, count); }, plan.success, plan.negative);
                }, state.busy);
                return E('section', { id: 'ml-network-builder', class: 'ml-section ml-card', 'aria-labelledby': 'ml-network-builder-heading' }, [E('div', { class: 'ml-section__header' }, [E('div', {}, [E('h3', { id: 'ml-network-builder-heading' }, _('批量生成器')), E('p', { class: 'ml-help' }, _('基础接口与数量共同指定一批 ml3 受管接口。选择目标总数（1–10）；只处理 MultiLogin 所有权记录，不会覆盖未拥有的对象。'))]), button(_('收起批量生成器'), closeBuilder, state.busy, 'cbi-button', { 'aria-controls': 'ml-network-builder', 'aria-expanded': 'true' })]), E('div', { class: 'ml-form-grid' }, [E('div', { class: 'ml-field ml-field--wide' }, [E('label', { class: 'ml-field__label', for: 'ml-base-iface' }, _('基础接口')), E('div', { class: 'ml-field__control' }, [E('input', { id: 'ml-base-iface', type: 'text', class: 'cbi-input-text', value: data.base_iface || '', 'aria-describedby': 'ml-base-iface-help' }), E('div', { id: 'ml-base-iface-help', class: 'ml-field__help' }, _('例如 eth0。页面不会从浏览器读取设备配置。'))])]), E('div', { class: 'ml-field' }, [E('label', { class: 'ml-field__label', for: 'ml-count' }, _('目标数量')), E('div', { class: 'ml-field__control' }, [countSelect, E('div', { id: 'ml-count-help', class: 'ml-field__help' }, _('数量是这一批受管接口的目标总数。'))])])]), E('div', { class: 'right' }, builderButton)])})() : null;
            root.replaceChildren.apply(root, compact([
                E('link', { rel: 'stylesheet', href: L.resource('view/multilogin/multi-login.css') }),
                E('div', { class: 'ml-page__header' }, [E('div', { class: 'ml-page__heading' }, [E('h2', { class: 'ml-page__title' }, _('网络资源')), E('p', { class: 'ml-page__description' }, _('仅管理由 MultiLogin 明确记录的 ml3 网络资源。页面不会扫描、认领或按名称前缀删除其他网络、防火墙或 mwan3 配置。'))]), E('div', { class: 'ml-page__header-actions' }, [button(state.busy ? _('正在刷新…') : _('刷新网络资源'), function () { reload(); }, state.busy)])]),
                state.feedback ? E('div', { class: state.error ? 'ml-feedback ml-feedback--error' : 'ml-feedback ml-feedback--success', role: state.error ? 'alert' : 'status', 'aria-live': state.error ? 'assertive' : 'polite', 'aria-atomic': 'true' }, compact([E('p', {}, state.feedback), state.error ? button(_('重试'), function () { reload(); }, state.busy) : null])) : null,
                recoverySection,
                resourceSection,
                builderSection
            ]));
            root.setAttribute('aria-busy', state.busy ? 'true' : 'false');
        }
        draw(); return root;
    }, handleSave: null, handleSaveApply: null, handleReset: null
});

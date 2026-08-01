'use strict';
'require view';
'require rpc';

var callOverview = rpc.declare({ object: 'multilogin', method: 'get_overview', expect: {} });

function failure() {
    return { ok: false, code: 'internal_error', message: _('无法读取概览。'), data: {} };
}

function button(label, click, disabled) {
    return E('button', {
        'class': 'btn cbi-button cbi-button-action',
        'type': 'button',
        'style': 'min-height:44px',
        'disabled': disabled,
        'click': click
    }, label);
}

function item(label, value) {
    return E('div', { 'class': 'cbi-value' }, [
        E('div', { 'class': 'cbi-value-title' }, label),
        E('div', { 'class': 'cbi-value-field' }, value)
    ]);
}

return view.extend({
    load: function () {
        return L.resolveDefault(callOverview(), failure());
    },

    render: function (initial) {
        var state = { response: initial || failure(), busy: false };
        var root = E('div', { 'class': 'cbi-map multilogin-page', 'aria-live': 'polite' });

        function refresh() {
            if (state.busy)
                return;
            state.busy = true;
            draw();
            L.resolveDefault(callOverview(), failure()).then(function (response) {
                state.response = response || failure();
                state.busy = false;
                draw();
            });
        }

        function draw() {
            var response = state.response;
            var data = response.ok ? response.data : {};
            var error = !response.ok ? (response.message || _('概览请求失败，请重试。')) : '';
            root.replaceChildren(
                E('h2', {}, _('概览')),
                E('p', { 'class': 'cbi-map-descr' }, _('查看多拨自动登录的服务、配置与受管网络状态。配置保存后需在“配置”页面明确应用服务操作。')),
                error ? E('div', { 'class': 'alert-message', 'role': 'alert' }, [
                    E('p', {}, error), button(_('重试'), refresh, state.busy)
                ]) : null,
                !error ? E('div', { 'class': 'cbi-section' }, [
                    E('legend', {}, _('当前状态')),
                    item(_('自动登录设置'), data.settings_enabled ? _('已启用') : _('已停用')),
                    item(_('服务'), '%s / %s'.format(data.service_enabled ? _('已启用') : _('未启用'), data.service_running ? _('运行中') : _('未运行'))),
                    item(_('账户与实例'), _('%s 个账户，%s 个实例（%s 个启用）').format(data.account_count, data.instance_count, data.enabled_instance_count)),
                    item(_('受管网络'), _('%s 个接口').format(data.owned_network_count)),
                    data.network_recovery_required ? E('div', { 'class': 'alert-message', 'role': 'alert' },
                        _('网络恢复需要处理。请前往“网络”查看受管状态并执行固定恢复操作。')) : null,
                    E('div', { 'class': 'right' }, [button(state.busy ? _('正在刷新…') : _('刷新'), refresh, state.busy)])
                ]) : null
            );
            root.setAttribute('aria-busy', state.busy ? 'true' : 'false');
        }

        draw();
        return root;
    },

    handleSave: null,
    handleSaveApply: null,
    handleReset: null
});

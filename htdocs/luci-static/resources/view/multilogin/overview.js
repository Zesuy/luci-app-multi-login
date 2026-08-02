'use strict';
'require view';
'require rpc';

var callOverview = rpc.declare({ object: 'multilogin', method: 'get_overview', expect: { '': {} } });

function failure() {
    return { ok: false, code: 'internal_error', message: _('无法读取概览。'), data: {} };
}

function compact(children) {
    return children.filter(function (child) { return child !== null && child !== undefined; });
}

function disabledAttr(value) {
    return value ? 'disabled' : null;
}

function button(label, click, disabled, kind) {
    return E('button', {
        'class': 'btn cbi-button ml-button ' + (kind || 'cbi-button-action'),
        'type': 'button',
        'disabled': disabledAttr(disabled),
        'click': click
    }, label);
}

function status(label, kind) {
    return E('span', { 'class': 'ml-status ml-status--' + (kind || 'neutral') }, label);
}

function stat(label, value, meta, badge, kind) {
    return E('article', { 'class': 'ml-stat' }, [
        E('div', { 'class': 'ml-stat__label' }, label),
        E('div', { 'class': 'ml-stat__value' }, value),
        badge || null,
        E('p', { 'class': 'ml-stat__meta' }, meta)
    ]);
}

function styleLink() {
    return E('link', { 'rel': 'stylesheet', 'href': L.resource('view/multilogin/multi-login.css') });
}

return view.extend({
    load: function () {
        return L.resolveDefault(callOverview(), failure());
    },

    render: function (initial) {
        var state = { response: initial || failure(), busy: false };
        var root = E('div', { 'class': 'cbi-map multilogin-page ml-page ml-page--overview', 'aria-busy': 'false' });

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
            var serviceLabel = data.service_running ? _('运行中') : (data.service_enabled ? _('已启用但未运行') : _('未启用'));
            var serviceKind = data.service_running ? 'success' : (data.service_enabled ? 'warning' : 'neutral');
            var autoLabel = data.settings_enabled ? _('已启用') : _('已停用');
            var autoKind = data.settings_enabled ? 'success' : 'neutral';
            var nextText = data.network_recovery_required ?
                _('网络资源需要恢复检查。请先确认“网络”页面中的受管资源状态。') :
                (!data.settings_enabled ? _('自动登录当前停用。需要时可前往“配置”启用。') :
                    (!data.instance_count ? _('尚未创建登录实例。请先在“配置”中新增实例。') :
                        _('配置已就绪；服务操作仍需在“配置”页面明确执行。')));
            var nextUrl = data.network_recovery_required ? 'network' :
                (!data.settings_enabled || !data.instance_count ? 'configuration' : 'configuration');

            root.replaceChildren.apply(root, compact([
                styleLink(),
                E('div', { 'class': 'ml-page__header' }, [
                    E('div', { 'class': 'ml-page__heading' }, [
                        E('h2', { 'class': 'ml-page__title' }, _('概览')),
                        E('p', { 'class': 'ml-page__description' }, _('查看多拨自动登录的服务、配置与受管网络状态。配置保存后需在“配置”页面明确应用服务操作。'))
                    ]),
                    E('div', { 'class': 'ml-page__header-actions' }, [
                        button(state.busy ? _('正在刷新…') : _('刷新概览'), refresh, state.busy)
                    ])
                ]),
                error ? E('div', { 'class': 'ml-feedback ml-feedback--error', 'role': 'alert', 'aria-live': 'assertive' }, [
                    E('p', {}, error),
                    E('div', { 'class': 'ml-actions' }, [
                        button(_('重试'), refresh, state.busy),
                        E('a', { 'class': 'btn cbi-button ml-button', 'href': L.url('admin/services/multilogin/diagnostics') }, _('打开诊断'))
                    ])
                ]) : null,
                !error ? E('div', { 'class': 'ml-grid ml-grid--stats', 'aria-label': _('MultiLogin 当前状态') }, compact([
                    stat(_('服务状态'), serviceLabel, serviceLabel === _('运行中') ? _('后台服务正在运行。') : _('配置不会自动启动服务。'), status(serviceLabel, serviceKind), serviceKind),
                    stat(_('自动登录'), autoLabel, data.settings_enabled ? _('登录策略已允许执行。') : _('需要在配置页明确启用。'), status(autoLabel, autoKind), autoKind),
                    stat(_('账户与实例'), _('%s 个账户').format(data.account_count), _('%s 个实例，其中 %s 个启用。').format(data.instance_count, data.enabled_instance_count), status(_('%s 个实例').format(data.instance_count), data.instance_count ? 'success' : 'neutral'), 'neutral'),
                    stat(_('受管网络'), _('%s 个接口').format(data.owned_network_count), data.network_recovery_required ? _('存在待处理的恢复状态。') : _('只显示 MultiLogin 明确记录的资源。'), status(data.network_recovery_required ? _('需要恢复') : _('状态正常'), data.network_recovery_required ? 'warning' : 'success'), data.network_recovery_required ? 'warning' : 'success')
                ])) : null,
                !error ? E('section', { 'class': 'ml-section', 'aria-labelledby': 'overview-next-heading' }, [
                    E('div', { 'class': 'ml-section__header' }, [
                        E('div', {}, [E('h3', { 'id': 'overview-next-heading' }, _('下一步')),
                            E('p', { 'class': 'ml-help' }, _('把状态信息和需要执行的操作分开，避免刷新或保存时误触发服务动作。'))]),
                        status(data.network_recovery_required ? _('需要处理') : _('可继续配置'), data.network_recovery_required ? 'warning' : 'neutral')
                    ]),
                    E('div', { 'class': 'ml-section__body' }, [
                        E('p', {}, nextText),
                        E('div', { 'class': 'ml-actions' }, [
                            E('a', { 'class': 'btn cbi-button ml-button cbi-button-action', 'href': L.url('admin/services/multilogin/' + nextUrl) }, data.network_recovery_required ? _('查看网络状态') : _('打开配置'))
                        ])
                    ])
                ]) : null,
                !error ? E('div', { 'class': 'ml-feedback ml-feedback--empty', 'hidden': data.network_recovery_required ? null : 'hidden', 'role': 'status' }, _('网络恢复需要处理。请前往“网络”查看受管状态并执行固定恢复操作。')) : null
            ]));
            root.setAttribute('aria-busy', state.busy ? 'true' : 'false');
        }

        draw();
        return root;
    },

    handleSave: null,
    handleSaveApply: null,
    handleReset: null
});

'use strict';
'require view';
'require rpc';
'require ui';

var callSettings = rpc.declare({ object: 'multilogin', method: 'get_settings', expect: {} });
var callSaveSettings = rpc.declare({ object: 'multilogin', method: 'save_settings', params: ['enabled', 'log_level', 'retry_interval', 'check_interval', 'max_retry_delay', 'already_logged_delay'], expect: {} });
var callAccounts = rpc.declare({ object: 'multilogin', method: 'list_accounts', expect: {} });
var callSaveAccount = rpc.declare({ object: 'multilogin', method: 'save_account', params: ['section', 'alias', 'username', 'password'], expect: {} });
var callDeleteAccount = rpc.declare({ object: 'multilogin', method: 'delete_account', params: ['section'], expect: {} });
var callInstances = rpc.declare({ object: 'multilogin', method: 'list_instances', expect: {} });
var callSaveInstance = rpc.declare({ object: 'multilogin', method: 'save_instance', params: ['section', 'enabled', 'alias', 'interface', 'v6face', 'account', 'ua_type'], expect: {} });
var callDeleteInstance = rpc.declare({ object: 'multilogin', method: 'delete_instance', params: ['section'], expect: {} });
var callServiceStatus = rpc.declare({ object: 'multilogin', method: 'service_status', expect: {} });
var callServiceAction = rpc.declare({ object: 'multilogin', method: 'service_action', params: ['action'], expect: {} });
var callCheckInstance = rpc.declare({ object: 'multilogin', method: 'check_instance', params: ['section'], expect: {} });
var callTestInstance = rpc.declare({ object: 'multilogin', method: 'test_instance', params: ['section'], expect: {} });
var callLogoutInstance = rpc.declare({ object: 'multilogin', method: 'logout_instance', params: ['section'], expect: {} });

function failed(message) { return { ok: false, code: 'internal_error', message: message || _('请求失败。'), data: {} }; }
function button(label, handler, disabled, kind) {
    return E('button', { 'class': 'btn cbi-button ' + (kind || 'cbi-button-action'), 'type': 'button', 'style': 'min-height:44px;margin:.2em', 'disabled': disabled, 'click': handler }, label);
}
function input(id, label, value, type, help) {
    return E('div', { 'class': 'cbi-value' }, [
        E('label', { 'class': 'cbi-value-title', 'for': id }, label),
        E('div', { 'class': 'cbi-value-field' }, [
            E('input', { 'id': id, 'class': 'cbi-input-text', 'type': type || 'text', 'value': value || '', 'style': 'min-height:38px;max-width:28em;width:100%' }),
            help ? E('div', { 'class': 'cbi-value-description' }, help) : null
        ])
    ]);
}
function notice(state, error) {
    return state.feedback ? E('div', { 'class': state.feedbackKind === 'error' ? 'alert-message' : 'alert-message notice', 'role': error ? 'alert' : 'status', 'aria-live': 'polite' }, state.feedback) : null;
}
function responseMessage(response, fallback) {
    return (response && response.message) || fallback || _('操作未完成，请刷新后重试。');
}

return view.extend({
    load: function () {
        return Promise.all([
            L.resolveDefault(callSettings(), failed()), L.resolveDefault(callAccounts(), failed()),
            L.resolveDefault(callInstances(), failed()), L.resolveDefault(callServiceStatus(), failed())
        ]);
    },

    render: function (initial) {
        var state = { settings: initial[0] || failed(), accounts: initial[1] || failed(), instances: initial[2] || failed(), service: initial[3] || failed(), busy: false, feedback: '', feedbackKind: 'status' };
        var root = E('div', { 'class': 'cbi-map multilogin-page', 'aria-live': 'polite' });

        function refresh(message) {
            state.busy = true;
            state.feedback = message || _('正在刷新配置…');
            state.feedbackKind = 'status';
            draw();
            return Promise.all([
                L.resolveDefault(callSettings(), failed()), L.resolveDefault(callAccounts(), failed()),
                L.resolveDefault(callInstances(), failed()), L.resolveDefault(callServiceStatus(), failed())
            ]).then(function (responses) {
                state.settings = responses[0] || failed(); state.accounts = responses[1] || failed();
                state.instances = responses[2] || failed(); state.service = responses[3] || failed();
                state.busy = false;
                if (responses.some(function (response) { return !response.ok; })) {
                    state.feedback = _('部分配置无法读取。请重试；未显示的数据不会被修改。');
                    state.feedbackKind = 'error';
                } else {
                    state.feedback = _('配置已刷新。');
                }
                draw();
            });
        }

        function run(request, success) {
            if (state.busy)
                return;
            state.busy = true; state.feedback = _('正在处理…'); state.feedbackKind = 'status'; draw();
            L.resolveDefault(request(), failed()).then(function (response) {
                if (!response.ok) {
                    state.feedback = responseMessage(response); state.feedbackKind = 'error'; state.busy = false; draw();
                    return;
                }
                state.feedback = success || _('操作已完成。'); state.feedbackKind = 'status';
                return refresh(state.feedback);
            });
        }

        function modal(title, body) { ui.showModal(title, body); }
        function closeModal() { ui.hideModal(); }
        function accountEditor(account) {
            var key = String(Date.now()), edit = !!account.section;
            var alias = 'ml-account-alias-' + key, username = 'ml-account-username-' + key, password = 'ml-account-password-' + key;
            modal(edit ? _('编辑账户') : _('新增账户'), [
                E('div', { 'class': 'cbi-section' }, [
                    input(alias, _('别名'), account.alias), input(username, _('账号'), account.username),
                    input(password, _('密码'), '', 'password', edit ? _('留空即保持当前密码；密码只在提交时发送，页面不会读取或显示它。') : _('创建账户时必须设置密码；密码不会再次显示。')),
                    E('div', { 'class': 'right' }, [button(_('取消'), closeModal, false, 'cbi-button'), button(_('保存'), function () {
                        var accountAlias = document.getElementById(alias).value;
                        var name = document.getElementById(username).value;
                        var secret = document.getElementById(password).value;
                        if (!name || (!edit && !secret)) { ui.addNotification(null, E('p', _('请填写账号，并为新账户设置密码。')), 'error'); return; }
                        closeModal(); run(function () { return callSaveAccount(account.section || '', accountAlias, name, secret); }, _('账户已保存。'));
                    }, false)])
                ])
            ]);
        }
        function instanceEditor(instance, accounts, interfaces) {
            var key = String(Date.now()), edit = !!instance.section;
            var alias = 'ml-instance-alias-' + key, iface = 'ml-instance-iface-' + key, v6 = 'ml-instance-v6-' + key, account = 'ml-instance-account-' + key, enabled = 'ml-instance-enabled-' + key, ua = 'ml-instance-ua-' + key;
            function choices(values, selected, emptyLabel) { return [E('option', { value: '' }, emptyLabel || _('请选择'))].concat(values.map(function (value) { return E('option', { value: value[0], selected: value[0] === selected ? 'selected' : null }, value[1]); })); }
            modal(edit ? _('编辑登录实例') : _('新增登录实例'), [
                E('div', { 'class': 'cbi-section' }, [
                    E('p', { 'class': 'cbi-section-descr' }, _('保存实例不会重启服务。请在页面下方明确选择“重启服务”后再应用运行时变更。')),
                    E('div', { 'class': 'cbi-value' }, [E('label', { 'class': 'cbi-value-title', 'for': enabled }, _('启用')), E('div', { 'class': 'cbi-value-field' }, E('input', { id: enabled, type: 'checkbox', checked: instance.enabled === '1' ? 'checked' : null }))]),
                    input(alias, _('别名'), instance.alias),
                    E('div', { 'class': 'cbi-value' }, [E('label', { 'class': 'cbi-value-title', 'for': iface }, _('IPv4 接口')), E('div', { 'class': 'cbi-value-field' }, E('select', { id: iface, class: 'cbi-input-select', style: 'min-height:38px;max-width:28em;width:100%' }, choices(interfaces.map(function (name) { return [name, name]; }), instance.interface)))]),
                    input(v6, _('IPv6 接口（可选）'), instance.v6face),
                    E('div', { 'class': 'cbi-value' }, [E('label', { 'class': 'cbi-value-title', 'for': account }, _('账户')), E('div', { 'class': 'cbi-value-field' }, E('select', { id: account, class: 'cbi-input-select', style: 'min-height:38px;max-width:28em;width:100%' }, choices(accounts.map(function (entry) { return [entry.section, entry.alias || entry.username || entry.section]; }), instance.account)))]),
                    E('div', { 'class': 'cbi-value' }, [E('label', { 'class': 'cbi-value-title', 'for': ua }, _('UA 类型')), E('div', { 'class': 'cbi-value-field' }, E('select', { id: ua, class: 'cbi-input-select', style: 'min-height:38px' }, [E('option', { value: 'pc', selected: instance.ua_type !== 'mobile' ? 'selected' : null }, 'PC'), E('option', { value: 'mobile', selected: instance.ua_type === 'mobile' ? 'selected' : null }, _('移动端'))]))]),
                    E('div', { 'class': 'right' }, [button(_('取消'), closeModal, false, 'cbi-button'), button(_('保存'), function () {
                        var values = { section: instance.section || '', enabled: document.getElementById(enabled).checked ? '1' : '0', alias: document.getElementById(alias).value, interface: document.getElementById(iface).value, v6face: document.getElementById(v6).value, account: document.getElementById(account).value, ua_type: document.getElementById(ua).value };
                        if (!values.interface || !values.account) { ui.addNotification(null, E('p', _('请选择接口和账户。')), 'error'); return; }
                        closeModal(); run(function () { return callSaveInstance(values.section, values.enabled, values.alias, values.interface, values.v6face, values.account, values.ua_type); }, _('实例已保存；请明确重启服务以应用运行时变更。'));
                    }, false)])
                ])
            ]);
        }
        function confirmAction(title, description, request, success, negative) {
            modal(title, [E('p', {}, description), E('div', { 'class': 'right' }, [button(_('取消'), closeModal, false, 'cbi-button'), button(_('确认'), function () { closeModal(); run(request, success); }, false, negative ? 'cbi-button-negative' : 'cbi-button-action')])]);
        }

        function draw() {
            var settings = state.settings.ok ? state.settings.data : null, accounts = state.accounts.ok ? state.accounts.data.accounts || [] : [], instanceData = state.instances.ok ? state.instances.data : { instances: [], interfaces: [] }, service = state.service.ok ? state.service.data : null;
            var unavailable = !settings || !state.accounts.ok || !state.instances.ok || !service;
            function accountRows() { return accounts.length ? accounts.map(function (account) { return E('tr', { class: 'tr' }, [E('td', { class: 'td' }, account.alias || '—'), E('td', { class: 'td' }, account.username), E('td', { class: 'td' }, account.password_set ? _('已设置') : _('未设置')), E('td', { class: 'td' }, String(account.reference_count)), E('td', { class: 'td' }, [button(_('编辑'), function () { accountEditor(account); }, state.busy), button(_('删除'), function () { confirmAction(_('删除账户'), _('删除“%s”吗？被实例引用的账户不会被删除。').format(account.alias || account.username), function () { return callDeleteAccount(account.section); }, _('账户已删除。'), true); }, state.busy, 'cbi-button-negative')])]); }) : [E('tr', { class: 'tr' }, E('td', { class: 'td', colspan: '5' }, _('尚未创建账户。请新增账户，再将其分配给登录实例。')))]; }
            function instanceRows() { return instanceData.instances.length ? instanceData.instances.map(function (instance) { return E('tr', { class: 'tr' }, [E('td', { class: 'td' }, instance.enabled === '1' ? _('是') : _('否')), E('td', { class: 'td' }, instance.alias || instance.section), E('td', { class: 'td' }, instance.interface), E('td', { class: 'td' }, instance.account_label || instance.account), E('td', { class: 'td' }, instance.ua_type === 'mobile' ? _('移动端') : 'PC'), E('td', { class: 'td' }, [button(_('编辑'), function () { instanceEditor(instance, accounts, instanceData.interfaces); }, state.busy), button(_('状态'), function () { run(function () { return callCheckInstance(instance.section); }, _('状态检查已完成。')); }, state.busy, 'cbi-button'), button(_('登录'), function () { confirmAction(_('登录测试'), _('将对“%s”执行一次登录操作。').format(instance.alias || instance.section), function () { return callTestInstance(instance.section); }, _('登录操作已完成。')); }, state.busy), button(_('注销'), function () { confirmAction(_('注销测试'), _('将对“%s”执行一次注销操作。').format(instance.alias || instance.section), function () { return callLogoutInstance(instance.section); }, _('注销操作已完成。'), true); }, state.busy, 'cbi-button-negative'), button(_('删除'), function () { confirmAction(_('删除实例'), _('删除“%s”吗？').format(instance.alias || instance.section), function () { return callDeleteInstance(instance.section); }, _('实例已删除。'), true); }, state.busy, 'cbi-button-negative')])]); }) : [E('tr', { class: 'tr' }, E('td', { class: 'td', colspan: '6' }, _('尚未创建登录实例。请先创建账户并选择可用接口。')))]; }
            root.replaceChildren(E('h2', {}, _('配置')), E('p', { class: 'cbi-map-descr' }, _('统一管理全局参数、账户与登录实例。密码为只写字段；保存不会隐式重启服务。')), notice(state, state.feedbackKind === 'error'), unavailable ? E('div', { class: 'alert-message', role: 'alert' }, [E('p', {}, _('无法加载全部配置。未显示的数据不会被修改。')), button(_('重试'), function () { refresh(); }, state.busy)]) : null,
                settings ? E('div', { class: 'cbi-section' }, [
                    E('legend', {}, _('全局设置')),
                    E('div', { class: 'cbi-value' }, [
                        E('label', { class: 'cbi-value-title', for: 'ml-enabled' }, _('启用自动登录')),
                        E('div', { class: 'cbi-value-field' }, E('input', { id: 'ml-enabled', type: 'checkbox', checked: settings.enabled === '1' ? 'checked' : null }))
                    ]),
                    input('ml-log-level', _('日志级别'), settings.log_level),
                    input('ml-retry', _('初始重试间隔（秒）'), settings.retry_interval, 'number'),
                    input('ml-check', _('状态检查间隔（秒）'), settings.check_interval, 'number'),
                    input('ml-max-retry', _('最大重试间隔（秒）'), settings.max_retry_delay, 'number'),
                    input('ml-already', _('已登录状态间隔（秒）'), settings.already_logged_delay, 'number'),
                    E('div', { class: 'right' }, button(_('保存设置'), function () {
                        var enabled = document.getElementById('ml-enabled').checked ? '1' : '0';
                        var logLevel = document.getElementById('ml-log-level').value;
                        var retryInterval = Number(document.getElementById('ml-retry').value);
                        var checkInterval = Number(document.getElementById('ml-check').value);
                        var maxRetryDelay = Number(document.getElementById('ml-max-retry').value);
                        var alreadyLoggedDelay = Number(document.getElementById('ml-already').value);
                        run(function () {
                            return callSaveSettings(enabled, logLevel, retryInterval, checkInterval, maxRetryDelay, alreadyLoggedDelay);
                        }, _('设置已保存；请明确选择服务操作以应用运行时变更。'));
                    }, state.busy))
                ]) : null,
                state.accounts.ok ? E('div', { class: 'cbi-section' }, [E('legend', {}, _('账户')), E('p', { class: 'cbi-section-descr' }, _('页面只显示密码是否已设置；编辑现有账户时留空密码即可保持原值。')), button(_('新增账户'), function () { accountEditor({ section: '', alias: '', username: '' }); }, state.busy), E('div', { style: 'overflow-x:auto' }, E('table', { class: 'table cbi-section-table' }, [E('thead', {}, E('tr', { class: 'tr table-titles' }, [E('th', { class: 'th' }, _('别名')), E('th', { class: 'th' }, _('账号')), E('th', { class: 'th' }, _('密码')), E('th', { class: 'th' }, _('引用')), E('th', { class: 'th' }, _('操作'))])), E('tbody', {}, accountRows())]))]) : null,
                state.instances.ok ? E('div', { class: 'cbi-section' }, [E('legend', {}, _('登录实例')), button(_('新增实例'), function () { instanceEditor({ section: '', enabled: '1', alias: '', interface: '', v6face: '', account: '', ua_type: 'pc' }, accounts, instanceData.interfaces); }, state.busy), E('div', { style: 'overflow-x:auto' }, E('table', { class: 'table cbi-section-table' }, [E('thead', {}, E('tr', { class: 'tr table-titles' }, [E('th', { class: 'th' }, _('启用')), E('th', { class: 'th' }, _('别名')), E('th', { class: 'th' }, _('接口')), E('th', { class: 'th' }, _('账户')), E('th', { class: 'th' }, _('UA')), E('th', { class: 'th' }, _('操作'))])), E('tbody', {}, instanceRows())]))]) : null,
                service ? E('div', { class: 'cbi-section' }, [E('legend', {}, _('服务应用')), E('p', { class: 'cbi-section-descr' }, _('服务当前：%s，%s。配置更改不会自动执行这些操作。').format(service.enabled ? _('已启用') : _('未启用'), service.running ? _('运行中') : _('未运行'))), E('div', {}, ['start', 'stop', 'restart', 'enable', 'disable'].map(function (action) { return button(_(action), function () { confirmAction(_('服务操作'), _('确认对 MultiLogin 服务执行“%s”吗？').format(action), function () { return callServiceAction(action); }, _('服务状态已更新。'), action === 'stop' || action === 'disable'); }, state.busy, action === 'stop' || action === 'disable' ? 'cbi-button-negative' : 'cbi-button-action'); }))]) : null,
                E('div', { class: 'right' }, button(state.busy ? _('正在刷新…') : _('刷新页面'), function () { refresh(); }, state.busy)));
            root.setAttribute('aria-busy', state.busy ? 'true' : 'false');
        }
        draw(); return root;
    }, handleSave: null, handleSaveApply: null, handleReset: null
});

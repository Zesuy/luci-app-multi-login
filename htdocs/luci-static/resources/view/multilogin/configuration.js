'use strict';
'require view';
'require rpc';
'require ui';

var callSettings = rpc.declare({ object: 'multilogin', method: 'get_settings', expect: { '': {} } });
var callSaveSettings = rpc.declare({ object: 'multilogin', method: 'save_settings', params: ['enabled', 'log_level', 'retry_interval', 'check_interval', 'max_retry_delay', 'already_logged_delay'], expect: { '': {} } });
var callAccounts = rpc.declare({ object: 'multilogin', method: 'list_accounts', expect: { '': {} } });
var callSaveAccount = rpc.declare({ object: 'multilogin', method: 'save_account', params: ['section', 'alias', 'username', 'password'], expect: { '': {} } });
var callDeleteAccount = rpc.declare({ object: 'multilogin', method: 'delete_account', params: ['section'], expect: { '': {} } });
var callInstances = rpc.declare({ object: 'multilogin', method: 'list_instances', expect: { '': {} } });
var callSaveInstance = rpc.declare({ object: 'multilogin', method: 'save_instance', params: ['section', 'enabled', 'alias', 'interface', 'v6face', 'account', 'ua_type'], expect: { '': {} } });
var callDeleteInstance = rpc.declare({ object: 'multilogin', method: 'delete_instance', params: ['section'], expect: { '': {} } });
var callServiceStatus = rpc.declare({ object: 'multilogin', method: 'service_status', expect: { '': {} } });
var callServiceAction = rpc.declare({ object: 'multilogin', method: 'service_action', params: ['action'], expect: { '': {} } });
var callCheckInstance = rpc.declare({ object: 'multilogin', method: 'check_instance', params: ['section'], expect: { '': {} } });
var callTestInstance = rpc.declare({ object: 'multilogin', method: 'test_instance', params: ['section'], expect: { '': {} } });
var callLogoutInstance = rpc.declare({ object: 'multilogin', method: 'logout_instance', params: ['section'], expect: { '': {} } });

function compact(children) {
    return children.filter(function (child) { return child !== null && child !== undefined; });
}

function disabledAttr(value) { return value ? 'disabled' : null; }
function failed(message) { return { ok: false, code: 'internal_error', message: message || _('请求失败。'), data: {} }; }
function button(label, handler, disabled, kind) {
    return E('button', { 'class': 'btn cbi-button ml-button ' + (kind || 'cbi-button-action'), 'type': 'button', 'disabled': disabledAttr(disabled), 'click': handler }, label);
}
function status(label, kind) {
    return E('span', { 'class': 'ml-status ml-status--' + (kind || 'neutral') }, label);
}
function input(id, label, value, type, help) {
    return E('div', { 'class': 'ml-field' }, [
        E('label', { 'class': 'ml-field__label', 'for': id }, label),
        E('div', { 'class': 'ml-field__control' }, compact([
            E('input', { 'id': id, 'class': 'cbi-input-text', 'type': type || 'text', 'value': value || '', 'aria-describedby': help ? id + '-help' : null }),
            help ? E('div', { 'id': id + '-help', 'class': 'ml-field__help' }, help) : null
        ]))
    ]);
}
function notice(state, error) {
    return state.feedback ? E('div', { 'class': 'ml-feedback ' + (error ? 'ml-feedback--error' : 'ml-feedback--success'), 'role': error ? 'alert' : 'status', 'aria-live': error ? 'assertive' : 'polite', 'aria-atomic': 'true' }, E('p', {}, state.feedback)) : null;
}
function responseMessage(response, fallback) {
    return (response && response.message) || fallback || _('操作未完成，请刷新后重试。');
}
function tableWrap(label, table) {
    return E('div', { 'class': 'ml-table-wrap', 'tabindex': '0', 'role': 'region', 'aria-label': label }, table);
}
function th(label) {
    return E('th', { 'class': 'th', 'scope': 'col' }, label);
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
        var root = E('div', { 'class': 'cbi-map multilogin-page ml-page ml-page--configuration', 'aria-busy': 'false' });

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
                E('div', { 'class': 'ml-page ml-section ml-card ml-modal' }, [
                    E('p', { 'class': 'ml-help' }, edit ? _('修改别名或账号；密码字段保持为空即可保留现有密码。') : _('新增账户时必须设置密码；密码不会再次显示。')),
                    input(alias, _('别名'), account.alias), input(username, _('账号'), account.username),
                    input(password, _('密码'), '', 'password', edit ? _('留空即保持当前密码；密码只在提交时发送，页面不会读取或显示它。') : _('创建账户时必须设置密码；密码不会再次显示。')),
                    E('div', { 'class': 'right' }, [button(_('取消'), closeModal, false, 'cbi-button'), button(_('保存账户'), function () {
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
                E('div', { 'class': 'ml-page ml-section ml-card ml-modal' }, [
                    E('p', { 'class': 'ml-help' }, _('保存实例不会重启服务。请在页面下方明确选择服务操作后再应用运行时变更。')),
                    E('div', { 'class': 'ml-form-grid' }, [
                        E('div', { 'class': 'cbi-value' }, [E('label', { 'class': 'cbi-value-title', 'for': enabled }, _('启用')), E('div', { 'class': 'cbi-value-field' }, E('input', { id: enabled, type: 'checkbox', checked: instance.enabled === '1' ? 'checked' : null }))]),
                        input(alias, _('别名'), instance.alias),
                        E('div', { 'class': 'cbi-value' }, [E('label', { 'class': 'cbi-value-title', 'for': iface }, _('IPv4 接口')), E('div', { 'class': 'cbi-value-field' }, E('select', { id: iface, class: 'cbi-input-select' }, choices(interfaces.map(function (name) { return [name, name]; }), instance.interface)))]),
                        input(v6, _('IPv6 接口（可选）'), instance.v6face),
                        E('div', { 'class': 'cbi-value' }, [E('label', { 'class': 'cbi-value-title', 'for': account }, _('账户')), E('div', { 'class': 'cbi-value-field' }, E('select', { id: account, class: 'cbi-input-select' }, choices(accounts.map(function (entry) { return [entry.section, entry.alias || entry.username || entry.section]; }), instance.account)))]),
                        E('div', { 'class': 'cbi-value' }, [E('label', { 'class': 'cbi-value-title', 'for': ua }, _('UA 类型')), E('div', { 'class': 'cbi-value-field' }, E('select', { id: ua, class: 'cbi-input-select' }, [E('option', { value: 'pc', selected: instance.ua_type !== 'mobile' ? 'selected' : null }, 'PC'), E('option', { value: 'mobile', selected: instance.ua_type === 'mobile' ? 'selected' : null }, _('移动端'))]))])
                    ]),
                    E('div', { 'class': 'right' }, [button(_('取消'), closeModal, false, 'cbi-button'), button(_('保存实例'), function () {
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
            function accountRows() { return accounts.length ? accounts.map(function (account) { return E('tr', { class: 'tr' }, [E('td', { class: 'td', 'data-label': _('别名') }, account.alias || '—'), E('td', { class: 'td', 'data-label': _('账号') }, account.username), E('td', { class: 'td', 'data-label': _('密码') }, status(account.password_set ? _('已设置') : _('未设置'), account.password_set ? 'success' : 'warning')), E('td', { class: 'td', 'data-label': _('引用') }, String(account.reference_count)), E('td', { class: 'td ml-table__actions', 'data-label': _('操作' ) }, E('div', { class: 'ml-actions' }, [button(_('编辑'), function () { accountEditor(account); }, state.busy), button(_('删除'), function () { confirmAction(_('删除账户'), _('删除“%s”吗？被实例引用的账户不会被删除。').format(account.alias || account.username), function () { return callDeleteAccount(account.section); }, _('账户已删除。'), true); }, state.busy, 'cbi-button-negative')]))]); }) : [E('tr', { class: 'tr' }, E('td', { class: 'td ml-empty', colspan: '5' }, _('尚未创建账户。请新增账户，再将其分配给登录实例。')))]; }
            function instanceRows() { return instanceData.instances.length ? instanceData.instances.map(function (instance) { return E('tr', { class: 'tr' }, [E('td', { class: 'td', 'data-label': _('启用') }, status(instance.enabled === '1' ? _('是') : _('否'), instance.enabled === '1' ? 'success' : 'neutral')), E('td', { class: 'td', 'data-label': _('别名') }, instance.alias || instance.section), E('td', { class: 'td', 'data-label': _('接口') }, E('span', { class: 'ml-code' }, instance.interface)), E('td', { class: 'td', 'data-label': _('账户') }, instance.account_label || instance.account), E('td', { class: 'td', 'data-label': _('UA') }, instance.ua_type === 'mobile' ? _('移动端') : 'PC'), E('td', { class: 'td ml-table__actions', 'data-label': _('操作') }, [E('div', { class: 'ml-actions' }, [button(_('编辑'), function () { instanceEditor(instance, accounts, instanceData.interfaces); }, state.busy), button(_('状态'), function () { run(function () { return callCheckInstance(instance.section); }, _('状态检查已完成。')); }, state.busy)]), E('div', { class: 'ml-actions ml-actions--danger' }, [button(_('登录'), function () { confirmAction(_('登录测试'), _('将对“%s”执行一次登录操作。').format(instance.alias || instance.section), function () { return callTestInstance(instance.section); }, _('登录操作已完成。')); }, state.busy), button(_('注销'), function () { confirmAction(_('注销测试'), _('将对“%s”执行一次注销操作。').format(instance.alias || instance.section), function () { return callLogoutInstance(instance.section); }, _('注销操作已完成。'), true); }, state.busy, 'cbi-button-negative'), button(_('删除'), function () { confirmAction(_('删除实例'), _('删除“%s”吗？').format(instance.alias || instance.section), function () { return callDeleteInstance(instance.section); }, _('实例已删除。'), true); }, state.busy, 'cbi-button-negative')])])]); }) : [E('tr', { class: 'tr' }, E('td', { class: 'td ml-empty', colspan: '6' }, _('尚未创建登录实例。请先创建账户并选择可用接口。')))]; }
            var serviceActions = [
                { action: 'start', label: _('启动服务'), danger: false },
                { action: 'stop', label: _('停止服务'), danger: true },
                { action: 'restart', label: _('重启服务'), danger: false },
                { action: 'enable', label: _('启用开机启动'), danger: false },
                { action: 'disable', label: _('停用开机启动'), danger: true }
            ];
            root.replaceChildren.apply(root, compact([
                E('link', { rel: 'stylesheet', href: L.resource('view/multilogin/multi-login.css') }),
                E('div', { 'class': 'ml-page__header' }, [E('div', { 'class': 'ml-page__heading' }, [E('h2', { 'class': 'ml-page__title' }, _('配置')), E('p', { 'class': 'ml-page__description' }, _('统一管理全局参数、账户与登录实例。密码为只写字段；保存不会隐式重启服务。'))]), E('div', { 'class': 'ml-page__header-actions' }, [button(state.busy ? _('正在刷新…') : _('刷新配置'), function () { refresh(); }, state.busy)])]),
                notice(state, state.feedbackKind === 'error'),
                unavailable ? E('div', { 'class': 'ml-feedback ml-feedback--error', 'role': 'alert', 'aria-live': 'assertive' }, [E('p', {}, _('无法加载全部配置。未显示的数据不会被修改。')), button(_('重试'), function () { refresh(); }, state.busy)]) : null,
                settings ? E('section', { 'class': 'ml-section ml-card', 'aria-labelledby': 'ml-settings-heading' }, [E('div', { class: 'ml-section__header' }, [E('div', {}, [E('h3', { id: 'ml-settings-heading' }, _('基础设置')), E('p', { class: 'ml-help' }, _('这些参数控制自动登录策略和重试节奏。'))])]), E('div', { class: 'ml-form-grid' }, [E('div', { class: 'cbi-value' }, [E('label', { class: 'cbi-value-title', for: 'ml-enabled' }, _('启用自动登录')), E('div', { class: 'cbi-value-field' }, E('input', { id: 'ml-enabled', type: 'checkbox', checked: settings.enabled === '1' ? 'checked' : null }))]), input('ml-log-level', _('日志级别'), settings.log_level, 'text', _('例如 info；日志内容仍会在服务器端脱敏。')), input('ml-retry', _('初始重试间隔（秒）'), settings.retry_interval, 'number'), input('ml-check', _('状态检查间隔（秒）'), settings.check_interval, 'number'), input('ml-max-retry', _('最大重试间隔（秒）'), settings.max_retry_delay, 'number'), input('ml-already', _('已登录状态间隔（秒）'), settings.already_logged_delay, 'number')]), E('div', { class: 'right' }, button(_('保存设置'), function () { var enabled = document.getElementById('ml-enabled').checked ? '1' : '0'; var logLevel = document.getElementById('ml-log-level').value; var retryInterval = Number(document.getElementById('ml-retry').value); var checkInterval = Number(document.getElementById('ml-check').value); var maxRetryDelay = Number(document.getElementById('ml-max-retry').value); var alreadyLoggedDelay = Number(document.getElementById('ml-already').value); run(function () { return callSaveSettings(enabled, logLevel, retryInterval, checkInterval, maxRetryDelay, alreadyLoggedDelay); }, _('设置已保存；请明确选择服务操作以应用运行时变更。')); }, state.busy))]) : null,
                state.accounts.ok ? E('section', { class: 'ml-section ml-card', 'aria-labelledby': 'ml-accounts-heading' }, [E('div', { class: 'ml-section__header' }, [E('div', {}, [E('h3', { id: 'ml-accounts-heading' }, _('账户')), E('p', { class: 'ml-help' }, _('页面只显示密码是否已设置；编辑现有账户时留空密码即可保持原值。'))]), button(_('新增账户'), function () { accountEditor({ section: '', alias: '', username: '' }); }, state.busy)]), tableWrap(_('账户列表'), E('table', { class: 'table cbi-section-table ml-table', 'aria-label': _('账户列表') }, [E('thead', {}, E('tr', { class: 'tr table-titles' }, [th(_('别名')), th(_('账号')), th(_('密码')), th(_('引用')), th(_('操作'))])), E('tbody', {}, accountRows())]))]) : null,
                state.instances.ok ? E('section', { class: 'ml-section ml-card', 'aria-labelledby': 'ml-instances-heading' }, [E('div', { class: 'ml-section__header' }, [E('div', {}, [E('h3', { id: 'ml-instances-heading' }, _('登录实例')), E('p', { class: 'ml-help' }, _('实例保存后不会自动登录或重启服务；请在服务卡中明确执行动作。'))]), button(_('新增实例'), function () { instanceEditor({ section: '', enabled: '1', alias: '', interface: '', v6face: '', account: '', ua_type: 'pc' }, accounts, instanceData.interfaces); }, state.busy)]), tableWrap(_('登录实例列表'), E('table', { class: 'table cbi-section-table ml-table', 'aria-label': _('登录实例列表') }, [E('thead', {}, E('tr', { class: 'tr table-titles' }, [th(_('启用')), th(_('别名')), th(_('接口')), th(_('账户')), th(_('UA')), th(_('操作'))])), E('tbody', {}, instanceRows())]))]) : null,
                service ? E('section', { class: 'ml-section ml-card', 'aria-labelledby': 'ml-service-heading' }, [E('div', { class: 'ml-section__header' }, [E('div', {}, [E('h3', { id: 'ml-service-heading' }, _('运行服务')), E('p', { class: 'ml-help' }, _('配置更改不会自动执行服务动作。')), E('div', { class: 'ml-actions' }, [status(service.running ? _('运行中') : _('未运行'), service.running ? 'success' : 'neutral'), status(service.enabled ? _('开机已启用') : _('开机未启用'), service.enabled ? 'success' : 'neutral')])])]), E('div', { class: 'ml-actions' }, serviceActions.map(function (entry) { return button(entry.label, function () { confirmAction(_('服务操作'), _('确认对 MultiLogin 服务执行“%s”吗？').format(entry.label), function () { return callServiceAction(entry.action); }, _('服务状态已更新。'), entry.danger); }, state.busy, entry.danger ? 'cbi-button-negative' : 'cbi-button-action'); }))]) : null
            ]));
            root.setAttribute('aria-busy', state.busy ? 'true' : 'false');
        }

        draw(); return root;
    }, handleSave: null, handleSaveApply: null, handleReset: null
});

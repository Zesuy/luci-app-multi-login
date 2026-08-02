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
            L.resolveDefault(callInstances(), failed())
        ]);
    },

    render: function (initial) {
        var state = { settings: initial[0] || failed(), accounts: initial[1] || failed(), instances: initial[2] || failed(), busy: false, feedback: '', feedbackKind: 'status', advancedOpen: false };
        var root = E('div', { 'class': 'cbi-map multilogin-page ml-page ml-page--configuration', 'aria-busy': 'false' });

        function refresh(message) {
            state.busy = true;
            state.feedback = message || _('正在刷新配置…');
            state.feedbackKind = 'status';
            draw();
            return Promise.all([
                L.resolveDefault(callSettings(), failed()), L.resolveDefault(callAccounts(), failed()),
                L.resolveDefault(callInstances(), failed())
            ]).then(function (responses) {
                state.settings = responses[0] || failed(); state.accounts = responses[1] || failed();
                state.instances = responses[2] || failed();
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

        function run(request, success, revealAdvanced) {
            if (state.busy)
                return;
            if (revealAdvanced)
                state.advancedOpen = true;
            state.busy = true; state.feedback = _('正在处理…'); state.feedbackKind = 'status'; draw();
            L.resolveDefault(request(), failed()).then(function (response) {
                if (!response.ok) {
                    if (revealAdvanced)
                        state.advancedOpen = true;
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
            modal(edit ? _('编辑账号') : _('新增账号'), [
                E('div', { 'class': 'ml-page ml-section ml-card ml-modal' }, [
                    E('p', { 'class': 'ml-help' }, edit ? _('修改别名或账号；密码字段保持为空即可保留现有密码。') : _('新增账号时必须设置密码；密码不会再次显示。')),
                    input(alias, _('别名'), account.alias), input(username, _('账号'), account.username),
                    input(password, _('密码'), '', 'password', edit ? _('留空即保持当前密码；密码只在提交时发送，页面不会读取或显示它。') : _('创建账号时必须设置密码；密码不会再次显示。')),
                    E('div', { 'class': 'right' }, [button(_('取消'), closeModal, false, 'cbi-button'), button(_('保存账号'), function () {
                        var accountAlias = document.getElementById(alias).value;
                        var name = document.getElementById(username).value;
                        var secret = document.getElementById(password).value;
                        if (!name || (!edit && !secret)) { ui.addNotification(null, E('p', _('请填写账号，并为新账号设置密码。')), 'error'); return; }
                        closeModal(); run(function () { return callSaveAccount(account.section || '', accountAlias, name, secret); }, _('账号已保存。'));
                    }, false)])
                ])
            ]);
        }
        function instanceEditor(instance, accounts, interfaces) {
            var key = String(Date.now()), edit = !!instance.section;
            var alias = 'ml-instance-alias-' + key, iface = 'ml-instance-iface-' + key, v6 = 'ml-instance-v6-' + key, account = 'ml-instance-account-' + key, enabled = 'ml-instance-enabled-' + key, ua = 'ml-instance-ua-' + key;
            function choices(values, selected, emptyLabel) { return [E('option', { value: '' }, emptyLabel || _('请选择'))].concat(values.map(function (value) { return E('option', { value: value[0], selected: value[0] === selected ? 'selected' : null }, value[1]); })); }
            modal(edit ? _('编辑登录任务') : _('新增登录任务'), [
                E('div', { 'class': 'ml-page ml-section ml-card ml-modal' }, [
                    E('p', { 'class': 'ml-help' }, _('保存登录任务不会自动登录或重启服务；可在任务列表中按需执行状态、登录或注销操作。')),
                    E('div', { 'class': 'ml-form-grid' }, [
                        E('div', { 'class': 'cbi-value' }, [E('label', { 'class': 'cbi-value-title', 'for': enabled }, _('启用')), E('div', { 'class': 'cbi-value-field' }, E('input', { id: enabled, type: 'checkbox', checked: instance.enabled === '1' ? 'checked' : null }))]),
                        input(alias, _('别名'), instance.alias),
                        E('div', { 'class': 'cbi-value' }, [E('label', { 'class': 'cbi-value-title', 'for': iface }, _('IPv4 接口')), E('div', { 'class': 'cbi-value-field' }, E('select', { id: iface, class: 'cbi-input-select' }, choices(interfaces.map(function (name) { return [name, name]; }), instance.interface)))]),
                        input(v6, _('IPv6 接口（可选）'), instance.v6face),
                        E('div', { 'class': 'cbi-value' }, [E('label', { 'class': 'cbi-value-title', 'for': account }, _('账号')), E('div', { 'class': 'cbi-value-field' }, E('select', { id: account, class: 'cbi-input-select' }, choices(accounts.map(function (entry) { return [entry.section, entry.alias || entry.username || entry.section]; }), instance.account)))]),
                        E('div', { 'class': 'cbi-value' }, [E('label', { 'class': 'cbi-value-title', 'for': ua }, _('UA 类型')), E('div', { 'class': 'cbi-value-field' }, E('select', { id: ua, class: 'cbi-input-select' }, [E('option', { value: 'pc', selected: instance.ua_type !== 'mobile' ? 'selected' : null }, 'PC'), E('option', { value: 'mobile', selected: instance.ua_type === 'mobile' ? 'selected' : null }, _('移动端'))]))])
                    ]),
                    E('div', { 'class': 'right' }, [button(_('取消'), closeModal, false, 'cbi-button'), button(_('保存登录任务'), function () {
                        var values = { section: instance.section || '', enabled: document.getElementById(enabled).checked ? '1' : '0', alias: document.getElementById(alias).value, interface: document.getElementById(iface).value, v6face: document.getElementById(v6).value, account: document.getElementById(account).value, ua_type: document.getElementById(ua).value };
                        if (!values.interface || !values.account) { ui.addNotification(null, E('p', _('请选择接口和账号。')), 'error'); return; }
                        closeModal(); run(function () { return callSaveInstance(values.section, values.enabled, values.alias, values.interface, values.v6face, values.account, values.ua_type); }, _('登录任务已保存。'));
                    }, false)])
                ])
            ]);
        }
        function confirmAction(title, description, request, success, negative) {
            modal(title, [E('p', {}, description), E('div', { 'class': 'right' }, [button(_('取消'), closeModal, false, 'cbi-button'), button(_('确认'), function () { closeModal(); run(request, success); }, false, negative ? 'cbi-button-negative' : 'cbi-button-action')])]);
        }

        function draw() {
            var settings = state.settings.ok ? state.settings.data : null,
                accountsData = state.accounts.ok ? state.accounts.data : null,
                accounts = accountsData ? accountsData.accounts || [] : [],
                instanceData = state.instances.ok ? state.instances.data || {} : { instances: [], interfaces: [] },
                instances = instanceData.instances || [], interfaces = instanceData.interfaces || [];
            var unavailable = !settings || !state.accounts.ok || !state.instances.ok,
                accountListReady = state.accounts.ok,
                hasAccounts = accountListReady && accounts.length > 0,
                hasInterfaces = state.instances.ok && interfaces.length > 0,
                hasTasks = instances.length > 0;

            function accountRows() {
                return accounts.map(function (account) {
                    return E('tr', { class: 'tr' }, [
                        E('td', { class: 'td', 'data-label': _('别名') }, account.alias || '—'),
                        E('td', { class: 'td', 'data-label': _('账号') }, account.username),
                        E('td', { class: 'td', 'data-label': _('密码') }, status(account.password_set ? _('已设置') : _('未设置'), account.password_set ? 'success' : 'warning')),
                        E('td', { class: 'td', 'data-label': _('引用') }, String(account.reference_count)),
                        E('td', { class: 'td ml-table__actions', 'data-label': _('操作') }, E('div', { class: 'ml-actions' }, [
                            button(_('编辑'), function () { accountEditor(account); }, state.busy),
                            button(_('删除'), function () { confirmAction(_('删除账号'), _('删除“%s”吗？被登录任务引用的账号不会被删除。').format(account.alias || account.username), function () { return callDeleteAccount(account.section); }, _('账号已删除。'), true); }, state.busy, 'cbi-button-negative')
                        ]))
                    ]);
                });
            }

            function instanceRows() {
                return instances.map(function (instance) {
                    var taskLabel = instance.alias || instance.section;
                    return E('tr', { class: 'tr' }, [
                        E('td', { class: 'td', 'data-label': _('任务名称') }, taskLabel),
                        E('td', { class: 'td', 'data-label': _('账号') }, instance.account_label || instance.account || '—'),
                        E('td', { class: 'td', 'data-label': _('接口') }, E('span', { class: 'ml-code' }, instance.interface || '—')),
                        E('td', { class: 'td', 'data-label': _('状态') }, status(instance.enabled === '1' ? _('已启用') : _('已停用'), instance.enabled === '1' ? 'success' : 'neutral')),
                        E('td', { class: 'td', 'data-label': _('UA') }, instance.ua_type === 'mobile' ? _('移动端') : 'PC'),
                        E('td', { class: 'td ml-table__actions', 'data-label': _('操作') }, [
                            E('div', { class: 'ml-actions' }, [
                                button(_('编辑'), function () { instanceEditor(instance, accounts, interfaces); }, state.busy),
                                button(_('检查状态'), function () { run(function () { return callCheckInstance(instance.section); }, _('状态检查已完成。')); }, state.busy)
                            ]),
                            E('div', { class: 'ml-actions ml-actions--danger' }, [
                                button(_('登录'), function () { confirmAction(_('登录测试'), _('将对“%s”执行一次登录操作。').format(taskLabel), function () { return callTestInstance(instance.section); }, _('登录操作已完成。')); }, state.busy),
                                button(_('注销'), function () { confirmAction(_('注销测试'), _('将对“%s”执行一次注销操作。').format(taskLabel), function () { return callLogoutInstance(instance.section); }, _('注销操作已完成。'), true); }, state.busy, 'cbi-button-negative'),
                                button(_('删除'), function () { confirmAction(_('删除登录任务'), _('删除“%s”吗？').format(taskLabel), function () { return callDeleteInstance(instance.section); }, _('登录任务已删除。'), true); }, state.busy, 'cbi-button-negative')
                            ])
                        ])
                    ]);
                });
            }

            function taskPrerequisite() {
                var messages = [], links = [];
                if (!accountListReady) {
                    messages.push(E('p', {}, _('账号列表暂不可用，请先刷新后再创建登录任务。')));
                } else if (!hasAccounts) {
                    messages.push(E('p', {}, _('登录任务需要至少一个账号。请先在上方账号区添加账号。')));
                    links.push(E('a', { href: '#ml-accounts-heading', class: 'btn cbi-button ml-button cbi-button-action' }, _('前往账号区')));
                }
                if (!hasInterfaces) {
                    messages.push(E('p', {}, _('登录任务需要可用接口。请先在网络页面配置接口，再回来创建任务。')));
                    links.push(E('a', { href: L.url('admin/services/multilogin/network'), class: 'btn cbi-button ml-button cbi-button-action' }, _('前往网络设置')));
                }
                return messages.length ? E('div', { class: 'ml-feedback ml-feedback--empty', role: 'status' }, compact(messages.concat(links.length ? [E('div', { class: 'ml-actions' }, links)] : []))) : null;
            }

            function saveSettings(scope) {
                var enabled = document.getElementById('ml-enabled').checked ? '1' : '0',
                    logLevel = settings.log_level,
                    retryInterval = Number(settings.retry_interval),
                    checkInterval = Number(settings.check_interval),
                    maxRetryDelay = Number(settings.max_retry_delay),
                    alreadyLoggedDelay = Number(settings.already_logged_delay);
                if (scope === 'policy') {
                    logLevel = document.getElementById('ml-log-level').value;
                    retryInterval = Number(document.getElementById('ml-retry').value);
                    checkInterval = Number(document.getElementById('ml-check').value);
                    maxRetryDelay = Number(document.getElementById('ml-max-retry').value);
                    alreadyLoggedDelay = Number(document.getElementById('ml-already').value);
                }
                return callSaveSettings(enabled, logLevel, retryInterval, checkInterval, maxRetryDelay, alreadyLoggedDelay);
            }

            root.replaceChildren.apply(root, compact([
                E('link', { rel: 'stylesheet', href: L.resource('view/multilogin/multi-login.css') }),
                E('div', { 'class': 'ml-page__header' }, [E('div', { 'class': 'ml-page__heading' }, [E('h2', { 'class': 'ml-page__title' }, _('登录管理')), E('p', { 'class': 'ml-page__description' }, _('按账号、登录任务和自动化策略完成配置。密码只在保存时发送，不会回显；配置保存不会隐式重启服务。'))]), E('div', { 'class': 'ml-page__header-actions' }, [button(state.busy ? _('正在刷新…') : _('刷新登录管理'), function () { refresh(); }, state.busy)])]),
                notice(state, state.feedbackKind === 'error'),
                unavailable ? E('div', { 'class': 'ml-feedback ml-feedback--error', 'role': 'alert', 'aria-live': 'assertive' }, [E('p', {}, _('部分登录管理数据暂不可用。未显示的数据不会被修改。')), button(_('重试'), function () { refresh(); }, state.busy)]) : null,
                state.accounts.ok ? E('section', { class: 'ml-section ml-card', 'aria-labelledby': 'ml-accounts-heading' }, [
                    E('div', { class: 'ml-section__header' }, [E('div', {}, [E('h3', { id: 'ml-accounts-heading' }, _('账号')), E('p', { class: 'ml-help' }, _('先添加账号，登录任务才能选择它。页面只显示密码是否已设置；编辑时留空密码即可保持原值。'))]), button(accounts.length ? _('添加账号') : _('添加第一个账号'), function () { accountEditor({ section: '', alias: '', username: '' }); }, state.busy)]),
                    accounts.length ? tableWrap(_('账号列表'), E('table', { class: 'table cbi-section-table ml-table', 'aria-label': _('账号列表') }, [E('thead', {}, E('tr', { class: 'tr table-titles' }, [th(_('别名')), th(_('账号')), th(_('密码')), th(_('引用')), th(_('操作'))])), E('tbody', {}, accountRows())])) : E('div', { class: 'ml-empty' }, E('p', {}, _('还没有账号。请先添加第一个账号，然后再创建登录任务。')))
                ]) : null,
                state.instances.ok ? E('section', { class: 'ml-section ml-card', 'aria-labelledby': 'ml-tasks-heading' }, compact(Array(
                    E('div', { class: 'ml-section__header' }, [E('div', {}, [E('h3', { id: 'ml-tasks-heading' }, _('登录任务')), E('p', { class: 'ml-help' }, _('每个登录任务关联一个账号和接口；保存任务不会自动登录或重启服务。'))]), button(hasTasks ? _('添加登录任务') : _('添加第一个登录任务'), function () { instanceEditor({ section: '', enabled: '1', alias: '', interface: '', v6face: '', account: '', ua_type: 'pc' }, accounts, interfaces); }, state.busy || !hasAccounts || !hasInterfaces)]),
                    taskPrerequisite(),
                    tableWrap(_('登录任务列表'), E('table', { class: 'table cbi-section-table ml-table', 'aria-label': _('登录任务列表') }, [
                        E('thead', {}, E('tr', { class: 'tr table-titles' }, [th(_('任务名称')), th(_('账号')), th(_('接口')), th(_('状态')), th(_('UA')), th(_('操作'))])),
                        E('tbody', {}, hasTasks ? instanceRows() : [E('tr', { class: 'tr' }, E('td', { class: 'td ml-empty', colspan: '6' }, _('还没有登录任务。添加任务后即可按需检查状态、登录或注销。')))])
                    ]))
                ))) : null,
                settings ? E('section', { class: 'ml-section ml-card', 'aria-labelledby': 'ml-automation-heading' }, [
                    E('div', { class: 'ml-section__header' }, E('div', {}, [E('h3', { id: 'ml-automation-heading' }, _('自动化设置')), E('p', { class: 'ml-help' }, _('在这里控制自动登录；重试与日志参数位于下方的高级区域。'))])),
                    E('div', { class: 'ml-form-grid' }, E('div', { class: 'cbi-value' }, [
                        E('label', { class: 'cbi-value-title', for: 'ml-enabled' }, _('启用自动登录')),
                        E('div', { class: 'cbi-value-field' }, [
                            E('input', { id: 'ml-enabled', type: 'checkbox', checked: settings.enabled === '1' ? 'checked' : null }),
                            E('p', { class: 'ml-help' }, _('启用后，后台会按登录任务和策略执行自动登录。'))
                        ])
                    ])),
                    E('div', { class: 'right' }, button(_('保存自动登录设置'), function () { run(function () { return saveSettings('automation'); }, _('自动登录设置已保存。')); }, state.busy))
                ]) : null,
                settings ? E('details', { class: 'ml-section ml-card', open: state.advancedOpen ? 'open' : null }, [
                    E('summary', {}, _('高级重试与日志参数')),
                    E('p', { class: 'ml-help' }, _('默认折叠。只有需要调整重试节奏或日志详细程度时才展开；保存失败时错误提示仍会显示。')),
                    E('div', { class: 'ml-form-grid' }, [
                        input('ml-log-level', _('日志级别'), settings.log_level, 'text', _('例如 info；日志内容仍会在服务器端脱敏。')),
                        input('ml-retry', _('初始重试间隔（秒）'), settings.retry_interval, 'number'),
                        input('ml-check', _('状态检查间隔（秒）'), settings.check_interval, 'number'),
                        input('ml-max-retry', _('最大重试间隔（秒）'), settings.max_retry_delay, 'number'),
                        input('ml-already', _('已登录状态间隔（秒）'), settings.already_logged_delay, 'number')
                    ]),
                    E('div', { class: 'right' }, button(_('保存重试与日志参数'), function () { run(function () { return saveSettings('policy'); }, _('重试与日志参数已保存。'), true); }, state.busy))
                ]) : null
            ]));
            root.setAttribute('aria-busy', state.busy ? 'true' : 'false');
        }

        draw(); return root;
    }, handleSave: null, handleSaveApply: null, handleReset: null
});

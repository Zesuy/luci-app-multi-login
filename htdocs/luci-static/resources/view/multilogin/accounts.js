'use strict';
'require view';
'require ui';
'require rpc';
'require uci';

var callSaveAccount = rpc.declare({
    object: 'multilogin',
    method: 'save_account',
    params: ['section', 'alias', 'username', 'password'],
    expect: {}
});

var callDeleteAccount = rpc.declare({
    object: 'multilogin',
    method: 'delete_account',
    params: ['section'],
    expect: {}
});

return view.extend({
    load: function () {
        return uci.load('multilogin');
    },

    openAccountEditor: function (account) {
        var uid = String(Date.now());
        var aliasId = 'account_alias_' + uid;
        var usernameId = 'account_username_' + uid;
        var passwordId = 'account_password_' + uid;
        var isEdit = !!(account && account.section);

        ui.showModal(isEdit ? _('编辑账户') : _('新增账户'), [
            E('div', { 'class': 'cbi-section' }, [
                E('div', { 'class': 'cbi-section-descr' },
                    _('账户保存后会立即写入配置。别名可留空，登录实例下拉框会优先显示别名。')),
                E('div', { 'class': 'cbi-value' }, [
                    E('label', { 'class': 'cbi-value-title', 'for': aliasId }, _('别名')),
                    E('div', { 'class': 'cbi-value-field' }, [
                        E('input', {
                            'id': aliasId,
                            'type': 'text',
                            'class': 'cbi-input-text',
                            'placeholder': '主账号',
                            'value': account.alias || ''
                        })
                    ])
                ]),
                E('div', { 'class': 'cbi-value' }, [
                    E('label', { 'class': 'cbi-value-title', 'for': usernameId }, _('账号')),
                    E('div', { 'class': 'cbi-value-field' }, [
                        E('input', {
                            'id': usernameId,
                            'type': 'text',
                            'class': 'cbi-input-text',
                            'placeholder': 'your_account',
                            'value': account.username || ''
                        })
                    ])
                ]),
                E('div', { 'class': 'cbi-value' }, [
                    E('label', { 'class': 'cbi-value-title', 'for': passwordId }, _('密码')),
                    E('div', { 'class': 'cbi-value-field' }, [
                        E('input', {
                            'id': passwordId,
                            'type': 'password',
                            'class': 'cbi-input-text',
                            'placeholder': isEdit ? _('留空则保持当前密码不变') : 'your_password',
                            'value': ''
                        })
                    ])
                ]),
                E('div', { 'class': 'right' }, [
                    E('button', {
                        'class': 'cbi-button',
                        'type': 'button',
                        'click': ui.hideModal
                    }, _('取消')),
                    ' ',
                    E('button', {
                        'class': 'cbi-button cbi-button-action',
                        'type': 'button',
                        'click': function () {
                            var alias = document.getElementById(aliasId).value.trim();
                            var username = document.getElementById(usernameId).value.trim();
                            var password = document.getElementById(passwordId).value;

                            if (!username) {
                                ui.addNotification(null, E('p', _('请输入账号。')), 'error');
                                return;
                            }

                            if (!isEdit && !password) {
                                ui.addNotification(null, E('p', _('请输入密码。')), 'error');
                                return;
                            }

                            ui.showModal(isEdit ? _('正在保存账户...') : _('正在创建账户...'), [
                                E('div', { 'class': 'spinning' }, _('正在写入配置，请稍候...'))
                            ]);

                            callSaveAccount(account.section || '', alias, username, password).then(function (res) {
                                if (res && res.error) {
                                    ui.hideModal();
                                    ui.addNotification(null, E('p', _('保存失败: ') + res.error), 'error');
                                    return;
                                }

                                ui.addNotification(null, E('p', isEdit ? _('账户已保存，正在刷新...') : _('账户已创建，正在刷新...')), 'info');
                                window.setTimeout(function () {
                                    ui.hideModal();
                                    location.reload();
                                }, 1200);
                            }).catch(function (err) {
                                ui.hideModal();
                                ui.addNotification(null, E('p', _('保存失败: ') + (err.message || err.toString())), 'error');
                            });
                        }
                    }, _('保存'))
                ])
            ])
        ]);
    },

    deleteAccount: function (account) {
        ui.showModal(_('确认删除'), [
            E('p', _('确定要删除账户“%s”吗？').format(account.alias || account.username || account.section)),
            E('div', { 'class': 'right' }, [
                E('button', {
                    'class': 'cbi-button',
                    'type': 'button',
                    'click': ui.hideModal
                }, _('取消')),
                ' ',
                E('button', {
                    'class': 'cbi-button cbi-button-negative',
                    'type': 'button',
                    'click': function () {
                        ui.showModal(_('正在删除账户...'), [
                            E('div', { 'class': 'spinning' }, _('正在删除配置，请稍候...'))
                        ]);

                        callDeleteAccount(account.section).then(function (res) {
                            if (res && res.error) {
                                ui.hideModal();
                                ui.addNotification(null, E('p', _('删除失败: ') + res.error), 'error');
                                return;
                            }

                            ui.addNotification(null, E('p', _('账户已删除，正在刷新...')), 'info');
                            window.setTimeout(function () {
                                ui.hideModal();
                                location.reload();
                            }, 1200);
                        }).catch(function (err) {
                            ui.hideModal();
                            ui.addNotification(null, E('p', _('删除失败: ') + (err.message || err.toString())), 'error');
                        });
                    }
                }, _('删除'))
            ])
        ]);
    },

    render: function () {
        var accounts = [];

        uci.sections('multilogin', 'account', function (section) {
            accounts.push({
                section: section['.name'],
                alias: section.alias || '',
                username: section.username || '',
                password: section.password || ''
            });
        });

        accounts.sort(function (a, b) {
            return (a.alias || a.username || a.section).localeCompare(b.alias || b.username || b.section);
        });

        var rows = [];

        if (accounts.length > 0) {
            accounts.forEach(function (account) {
                rows.push(E('tr', { 'class': 'tr' }, [
                    E('td', { 'class': 'td' }, account.alias || '-'),
                    E('td', { 'class': 'td' }, account.username || '-'),
                    E('td', { 'class': 'td' }, account.password ? '********' : '-'),
                    E('td', { 'class': 'td', 'style': 'white-space:normal;min-width:14em;' }, [
                        E('button', {
                            'class': 'cbi-button cbi-button-action',
                            'type': 'button',
                            'click': this.openAccountEditor.bind(this, account)
                        }, _('编辑')),
                        ' ',
                        E('button', {
                            'class': 'cbi-button cbi-button-negative',
                            'type': 'button',
                            'click': this.deleteAccount.bind(this, account)
                        }, _('删除'))
                    ])
                ]));
            }, this);
        } else {
            rows.push(E('tr', [
                E('td', {
                    'class': 'td',
                    'colspan': '4',
                    'style': 'text-align:center;color:#888;'
                }, _('尚未创建任何账户'))
            ]));
        }

        return E('div', { 'class': 'cbi-map' }, [
            E('h2', _('账户管理')),
            E('div', { 'class': 'cbi-map-descr' },
                _('在此统一管理校园网账户信息，密码以掩码形式存储于本地 UCI。账户创建后，可在“自动登录配置”页面的登录实例中通过下拉框直接引用，无需重复填写。')),
            E('div', { 'class': 'cbi-section' }, [
                E('legend', _('账户列表')),
                E('div', { 'style': 'margin:0 0 1em 0;' }, [
                    E('button', {
                        'class': 'cbi-button cbi-button-add',
                        'type': 'button',
                        'click': this.openAccountEditor.bind(this, {
                            section: '',
                            alias: '',
                            username: '',
                            password: ''
                        })
                    }, _('新增账户'))
                ]),
                E('table', { 'class': 'table cbi-section-table' }, [
                    E('thead', [
                        E('tr', { 'class': 'tr table-titles' }, [
                            E('th', { 'class': 'th' }, _('别名')),
                            E('th', { 'class': 'th' }, _('账号')),
                            E('th', { 'class': 'th' }, _('密码')),
                            E('th', { 'class': 'th' }, _('操作'))
                        ])
                    ]),
                    E('tbody', rows)
                ])
            ])
        ]);
    }
});

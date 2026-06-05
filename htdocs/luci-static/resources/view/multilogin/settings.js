'use strict';
'require view';
'require form';
'require ui';
'require rpc';
'require uci';

var callInitAction = rpc.declare({
    object: 'luci',
    method: 'setInitAction',
    params: ['name', 'action'],
    expect: { result: false }
});

var callSaveInstance = rpc.declare({
    object: 'multilogin',
    method: 'save_instance',
    params: ['section', 'enabled', 'alias', 'interface', 'v6face', 'account', 'ua_type'],
    expect: {}
});

var callDeleteInstance = rpc.declare({
    object: 'multilogin',
    method: 'delete_instance',
    params: ['section'],
    expect: {}
});

var callCheckInstance = rpc.declare({
    object: 'multilogin',
    method: 'check_instance',
    params: ['section'],
    expect: {}
});

var callTestInstance = rpc.declare({
    object: 'multilogin',
    method: 'test_instance',
    params: ['section'],
    expect: {}
});

var callLogoutInstance = rpc.declare({
    object: 'multilogin',
    method: 'logout_instance',
    params: ['section'],
    expect: {}
});

function optionNodes(values, current, placeholder) {
    var options = [];

    if (placeholder != null) {
        options.push(E('option', { 'value': '' }, placeholder));
    }

    values.forEach(function (entry) {
        options.push(E('option', {
            'value': entry[0],
            'selected': entry[0] === current ? 'selected' : null
        }, entry[1]));
    });

    return options;
}

return view.extend({
    load: function () {
        return Promise.all([
            uci.load('network'),
            uci.load('multilogin')
        ]);
    },

    renderResultModal: function (actionLabel, instance, result) {
        var output = (result && result.output) || '';
        var code = (result && result.code != null) ? String(result.code) : '-';
        var alias = (result && result.alias) || instance.alias || instance.section;
        var status = (result && result.status) || _('执行失败');
        var iface = (result && result.interface) || instance.interface || '-';
        var v6face = (result && result.v6face) || instance.v6face || '-';
        var username = (result && result.username) || instance.username || '-';
        var uaType = (result && result.ua_type) || instance.ua_type || '-';

        ui.showModal(actionLabel, [
            E('div', { 'class': 'cbi-section' }, [
                E('table', { 'class': 'table cbi-section-table' }, [
                    E('tbody', [
                        E('tr', [
                            E('td', { 'class': 'td left', 'style': 'width: 10em;' }, _('实例')),
                            E('td', { 'class': 'td left' }, alias + ' (' + instance.section + ')')
                        ]),
                        E('tr', [
                            E('td', { 'class': 'td left' }, _('结果')),
                            E('td', { 'class': 'td left' }, status)
                        ]),
                        E('tr', [
                            E('td', { 'class': 'td left' }, _('返回码')),
                            E('td', { 'class': 'td left' }, code)
                        ]),
                        E('tr', [
                            E('td', { 'class': 'td left' }, _('IPv4接口')),
                            E('td', { 'class': 'td left' }, iface)
                        ]),
                        E('tr', [
                            E('td', { 'class': 'td left' }, _('IPv6接口')),
                            E('td', { 'class': 'td left' }, v6face)
                        ]),
                        E('tr', [
                            E('td', { 'class': 'td left' }, _('账号')),
                            E('td', { 'class': 'td left' }, username)
                        ]),
                        E('tr', [
                            E('td', { 'class': 'td left' }, _('UA')),
                            E('td', { 'class': 'td left' }, uaType === 'mobile' ? _('移动端') : 'PC')
                        ])
                    ])
                ]),
                E('div', { 'class': 'cbi-value' }, [
                    E('label', { 'class': 'cbi-value-title' }, _('输出')),
                    E('div', { 'class': 'cbi-value-field' }, [
                        E('pre', {
                            'style': 'margin:0;max-height:18em;overflow:auto;white-space:pre-wrap;word-break:break-word;padding:0.75em;background:#111827;color:#f3f4f6;border-radius:4px;'
                        }, output || _('无输出'))
                    ])
                ]),
                E('div', { 'class': 'right' }, [
                    E('button', {
                        'class': 'cbi-button',
                        'type': 'button',
                        'click': ui.hideModal
                    }, _('关闭'))
                ])
            ])
        ]);
    },

    runInstanceAction: function (actionLabel, rpcCall, instance) {
        var self = this;

        ui.showModal(actionLabel, [
            E('div', { 'class': 'spinning' }, _('正在执行，请稍候...'))
        ]);

        return rpcCall(instance.section).then(function (res) {
            ui.hideModal();

            if (res && res.error) {
                ui.showModal(actionLabel, [
                    E('p', _('执行失败: ') + res.error),
                    E('div', { 'class': 'right' }, [
                        E('button', {
                            'class': 'cbi-button',
                            'type': 'button',
                            'click': ui.hideModal
                        }, _('关闭'))
                    ])
                ]);
                return;
            }

            self.renderResultModal(actionLabel, instance, res || {});
        }).catch(function (err) {
            ui.hideModal();
            ui.addNotification(null, E('p', _('调用失败: ') + (err.message || err.toString())), 'error');
        });
    },

    openInstanceEditor: function (instance, netInterfaces, accountOptions) {
        var self = this;
        var uid = String(Date.now());
        var enabledId = 'instance_enabled_' + uid;
        var aliasId = 'instance_alias_' + uid;
        var ifaceId = 'instance_iface_' + uid;
        var v6faceId = 'instance_v6face_' + uid;
        var accountId = 'instance_account_' + uid;
        var uaId = 'instance_ua_' + uid;
        var isEdit = !!(instance && instance.section);

        ui.showModal(isEdit ? _('编辑登录实例') : _('新增登录实例'), [
            E('div', { 'class': 'cbi-section' }, [
                E('div', { 'class': 'cbi-section-descr' },
                    _('实例保存后会立即写入配置并重启服务。全局设置的修改仍需使用页面底部的“保存并应用”。')),
                E('div', { 'class': 'cbi-value' }, [
                    E('label', { 'class': 'cbi-value-title', 'for': enabledId }, _('启用')),
                    E('div', { 'class': 'cbi-value-field' }, [
                        E('input', {
                            'id': enabledId,
                            'type': 'checkbox',
                            'class': 'cbi-input-checkbox',
                            'checked': instance.enabled === '1' ? 'checked' : null
                        })
                    ])
                ]),
                E('div', { 'class': 'cbi-value' }, [
                    E('label', { 'class': 'cbi-value-title', 'for': aliasId }, _('别名')),
                    E('div', { 'class': 'cbi-value-field' }, [
                        E('input', {
                            'id': aliasId,
                            'type': 'text',
                            'class': 'cbi-input-text',
                            'placeholder': 'PC登录1',
                            'value': instance.alias || ''
                        }),
                        E('div', { 'class': 'cbi-value-description' }, _('用于列表显示，可留空。'))
                    ])
                ]),
                E('div', { 'class': 'cbi-value' }, [
                    E('label', { 'class': 'cbi-value-title', 'for': ifaceId }, _('IPv4接口')),
                    E('div', { 'class': 'cbi-value-field' }, [
                        E('select', {
                            'id': ifaceId,
                            'class': 'cbi-input-select'
                        }, optionNodes(netInterfaces, instance.interface, _('— 请选择 —'))),
                        E('div', { 'class': 'cbi-value-description' }, _('选择当前实例使用的 mwan3 IPv4 逻辑接口。'))
                    ])
                ]),
                E('div', { 'class': 'cbi-value' }, [
                    E('label', { 'class': 'cbi-value-title', 'for': v6faceId }, _('IPv6接口')),
                    E('div', { 'class': 'cbi-value-field' }, [
                        E('select', {
                            'id': v6faceId,
                            'class': 'cbi-input-select'
                        }, optionNodes(netInterfaces, instance.v6face, _('— 可选，不启用请留空 —'))),
                        E('div', { 'class': 'cbi-value-description' }, _('预留给 IPv6 逻辑接口配置，本次仅保存与展示。'))
                    ])
                ]),
                E('div', { 'class': 'cbi-value' }, [
                    E('label', { 'class': 'cbi-value-title', 'for': accountId }, _('账号')),
                    E('div', { 'class': 'cbi-value-field' }, [
                        E('select', {
                            'id': accountId,
                            'class': 'cbi-input-select'
                        }, optionNodes(accountOptions, instance.account, _('— 请选择 —'))),
                        E('div', { 'class': 'cbi-value-description' }, _('账号来自“账户管理”页面。'))
                    ])
                ]),
                E('div', { 'class': 'cbi-value' }, [
                    E('label', { 'class': 'cbi-value-title', 'for': uaId }, _('UA类型')),
                    E('div', { 'class': 'cbi-value-field' }, [
                        E('select', {
                            'id': uaId,
                            'class': 'cbi-input-select'
                        }, [
                            E('option', {
                                'value': 'pc',
                                'selected': (instance.ua_type || 'pc') === 'pc' ? 'selected' : null
                            }, 'PC'),
                            E('option', {
                                'value': 'mobile',
                                'selected': instance.ua_type === 'mobile' ? 'selected' : null
                            }, _('移动端'))
                        ])
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
                            var enabled = document.getElementById(enabledId).checked ? '1' : '0';
                            var alias = document.getElementById(aliasId).value.trim();
                            var iface = document.getElementById(ifaceId).value;
                            var v6face = document.getElementById(v6faceId).value;
                            var account = document.getElementById(accountId).value;
                            var uaType = document.getElementById(uaId).value || 'pc';

                            if (!iface) {
                                ui.addNotification(null, E('p', _('请选择 IPv4 接口。')), 'error');
                                return;
                            }

                            if (!account) {
                                ui.addNotification(null, E('p', _('请选择账号。')), 'error');
                                return;
                            }

                            ui.showModal(isEdit ? _('正在保存实例...') : _('正在创建实例...'), [
                                E('div', { 'class': 'spinning' }, _('正在写入配置并重启服务，请稍候...'))
                            ]);

                            callSaveInstance(instance.section || '', enabled, alias, iface, v6face, account, uaType).then(function (res) {
                                if (res && res.error) {
                                    ui.hideModal();
                                    ui.addNotification(null, E('p', _('保存失败: ') + res.error), 'error');
                                    return;
                                }

                                ui.addNotification(null, E('p', isEdit ? _('实例已保存，正在刷新...') : _('实例已创建，正在刷新...')), 'info');
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

    deleteInstance: function (instance) {
        ui.showModal(_('确认删除'), [
            E('p', _('确定要删除实例“%s”吗？').format(instance.alias || instance.section)),
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
                        ui.showModal(_('正在删除实例...'), [
                            E('div', { 'class': 'spinning' }, _('正在删除配置并重启服务，请稍候...'))
                        ]);

                        callDeleteInstance(instance.section).then(function (res) {
                            if (res && res.error) {
                                ui.hideModal();
                                ui.addNotification(null, E('p', _('删除失败: ') + res.error), 'error');
                                return;
                            }

                            ui.addNotification(null, E('p', _('实例已删除，正在刷新...')), 'info');
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
        var self = this;
        var netInterfaces = [];
        var accountOptions = [];
        var accountLabelMap = {};
        var accountUsernameMap = {};
        var instances = [];
        var m, s, o;

        uci.sections('network', 'interface', function (section) {
            var name = section['.name'];
            if (name !== 'loopback') {
                netInterfaces.push([name, name]);
            }
        });

        uci.sections('multilogin', 'account', function (section) {
            var sname = section['.name'];
            var label = section.alias ? (section.alias + ' (' + (section.username || sname) + ')') : (section.username || sname);
            accountOptions.push([sname, label]);
            accountLabelMap[sname] = label;
            accountUsernameMap[sname] = section.username || sname;
        });

        uci.sections('multilogin', 'instance', function (section) {
            var accountRef = section.account || '';

            instances.push({
                section: section['.name'],
                enabled: section.enabled || '0',
                alias: section.alias || '',
                interface: section.interface || '',
                v6face: section.v6face || '',
                account: accountRef,
                account_label: accountLabelMap[accountRef] || accountRef || '-',
                username: accountUsernameMap[accountRef] || accountRef,
                ua_type: section.ua_type || 'pc'
            });
        });

        m = new form.Map('multilogin', _('自动登录配置'),
            _('配置各登录实例及全局参数。每个实例绑定一个逻辑接口与一个账户，由 mwan3 监控接口状态，离线时自动重新登录。请先在“账户管理”页添加账户，在“虚拟接口”页生成接口，再回此处创建实例。'));

        s = m.section(form.TypedSection, 'settings', _('全局设置'));
        s.anonymous = true;
        s.addremove = false;

        o = s.option(form.Flag, 'enabled', _('启用自动登录'), _('启用后，服务将在后台自动监控并登录配置的接口'));
        o.rmempty = false;

        o = s.option(form.Value, 'retry_interval', _('初始重试间隔(秒)'), _('登录失败后的初始重试延迟，失败后会指数增长'));
        o.datatype = 'uinteger';
        o.default = '4';

        o = s.option(form.Value, 'check_interval', _('状态检查间隔(秒)'), _('每隔多少秒检查一次 mwan3 接口状态'));
        o.datatype = 'uinteger';
        o.default = '5';

        o = s.option(form.Value, 'max_retry_delay', _('最大重试延迟(秒)'), _('重试延迟的最大值，防止无限增长'));
        o.datatype = 'uinteger';
        o.default = '16384';

        o = s.option(form.Value, 'already_logged_delay', _('已登录状态延迟(秒)'), _('当检测到已登录但接口离线时的重试延迟'));
        o.datatype = 'uinteger';
        o.default = '16';

        return Promise.resolve(m.render()).then(function (mapEl) {
            var rows = [];

            if (instances.length > 0) {
                instances.forEach(function (instance) {
                    rows.push(E('tr', { 'class': 'tr' }, [
                        E('td', { 'class': 'td' }, instance.enabled === '1' ? _('是') : _('否')),
                        E('td', { 'class': 'td' }, instance.alias || instance.section),
                        E('td', { 'class': 'td' }, instance.interface || '-'),
                        E('td', { 'class': 'td' }, instance.v6face || '-'),
                        E('td', { 'class': 'td' }, instance.account_label),
                        E('td', { 'class': 'td' }, instance.ua_type === 'mobile' ? _('移动端') : 'PC'),
                        E('td', { 'class': 'td', 'style': 'white-space:normal;min-width:18em;' }, [
                            E('button', {
                                'class': 'cbi-button cbi-button-action',
                                'type': 'button',
                                'click': function () { self.openInstanceEditor(instance, netInterfaces, accountOptions); }
                            }, _('编辑')),
                            ' ',
                            E('button', {
                                'class': 'cbi-button',
                                'type': 'button',
                                'click': function () { self.runInstanceAction(_('检测已登录'), callCheckInstance, instance); }
                            }, _('检测已登录')),
                            ' ',
                            E('button', {
                                'class': 'cbi-button cbi-button-apply',
                                'type': 'button',
                                'click': function () { self.runInstanceAction(_('登录测试'), callTestInstance, instance); }
                            }, _('登录测试')),
                            ' ',
                            E('button', {
                                'class': 'cbi-button',
                                'type': 'button',
                                'click': function () { self.runInstanceAction(_('注销测试'), callLogoutInstance, instance); }
                            }, _('注销测试')),
                            ' ',
                            E('button', {
                                'class': 'cbi-button cbi-button-negative',
                                'type': 'button',
                                'click': function () { self.deleteInstance(instance); }
                            }, _('删除'))
                        ])
                    ]));
                });
            }
            else {
                rows.push(E('tr', [
                    E('td', {
                        'class': 'td',
                        'colspan': '7',
                        'style': 'text-align:center;color:#888;'
                    }, _('尚未创建任何登录实例'))
                ]));
            }

            mapEl.appendChild(E('div', { 'class': 'cbi-section' }, [
                E('legend', _('登录实例配置')),
                E('div', { 'class': 'cbi-section-descr' },
                    _('实例的新增、编辑、删除会立即保存并重启服务。全局设置修改后仍需点击页面底部的“保存并应用”。手动检测与测试不受实例启用状态影响，可直接用于排障。')),
                E('div', { 'style': 'margin:0 0 1em 0;' }, [
                    E('button', {
                        'class': 'cbi-button cbi-button-add',
                        'type': 'button',
                        'click': function () {
                            self.openInstanceEditor({
                                section: '',
                                enabled: '1',
                                alias: '',
                                interface: '',
                                v6face: '',
                                account: '',
                                ua_type: 'pc'
                            }, netInterfaces, accountOptions);
                        }
                    }, _('新增实例'))
                ]),
                E('table', { 'class': 'table cbi-section-table' }, [
                    E('thead', [
                        E('tr', { 'class': 'tr table-titles' }, [
                            E('th', { 'class': 'th' }, _('启用')),
                            E('th', { 'class': 'th' }, _('别名')),
                            E('th', { 'class': 'th' }, _('IPv4接口')),
                            E('th', { 'class': 'th' }, _('IPv6接口')),
                            E('th', { 'class': 'th' }, _('账号')),
                            E('th', { 'class': 'th' }, _('UA')),
                            E('th', { 'class': 'th' }, _('操作'))
                        ])
                    ]),
                    E('tbody', rows)
                ])
            ]));

            return mapEl;
        });
    },

    handleSaveApply: function (ev, mode) {
        return this.handleSave(ev).then(function () {
            ui.changes.apply(mode == '0');
            return callInitAction('multilogin', 'restart');
        });
    }
});

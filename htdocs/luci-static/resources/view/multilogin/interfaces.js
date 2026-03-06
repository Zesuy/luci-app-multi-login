'use strict';
'require view';
'require rpc';
'require dom';
'require ui';

var callQuickSetup = rpc.declare({
    object: 'multilogin',
    method: 'quick_setup',
    params: ['base_iface', 'count'],
    expect: {}
});

var callListAuto = rpc.declare({
    object: 'multilogin',
    method: 'list_auto',
    expect: {}
});

var callRemoveAuto = rpc.declare({
    object: 'multilogin',
    method: 'remove_auto',
    expect: {}
});

return view.extend({
    load: function () {
        return L.resolveDefault(callListAuto(), {});
    },

    render: function (data) {
        var base_iface = data.base_iface || '';
        var count = data.count || 0;
        var interfaces = data.interfaces || [];

        var status_rows = [];
        if (interfaces.length > 0) {
            interfaces.forEach(function (iface) {
                status_rows.push(E('tr', [
                    E('td', { 'class': 'td' }, iface.name),
                    E('td', { 'class': 'td' }, iface.device),
                    E('td', { 'class': 'td' }, iface.metric)
                ]));
            });
        } else {
            status_rows.push(E('tr', [
                E('td', { 'colspan': '3', 'class': 'td', 'style': 'text-align:center;color:#888' },
                    _('尚未生成任何虚拟接口配置'))
            ]));
        }

        var view = E('div', { 'class': 'cbi-map' }, [
            E('h2', _('虚拟接口管理')),

            // --- Current Status Card ---
            E('div', { 'class': 'cbi-section' }, [
                E('legend', _('当前已生成的配置')),
                E('div', { 'class': 'cbi-section-descr' },
                    count > 0
                        ? _('基于 %s 已生成 %s 个虚拟接口。').format(base_iface, String(count))
                        : _('当前没有由本插件管理的虚拟接口。')
                ),
                E('table', { 'class': 'table cbi-section-table', 'style': 'margin-top:0.5em' }, [
                    E('thead', [
                        E('tr', { 'class': 'tr table-titles' }, [
                            E('th', { 'class': 'th' }, _('逻辑接口名')),
                            E('th', { 'class': 'th' }, _('绑定设备')),
                            E('th', { 'class': 'th' }, _('路由跃点'))
                        ])
                    ]),
                    E('tbody', {}, status_rows)
                ]),
                count > 0 ? E('div', { 'style': 'margin-top:1em' }, [
                    E('button', {
                        'class': 'cbi-button cbi-button-reset',
                        'click': function () {
                            ui.showModal(_('确认删除'), [
                                E('p', _('确定要删除所有由本插件生成的 auto_ 配置吗？此操作不可恢复。')),
                                E('div', { 'class': 'right' }, [
                                    E('button', {
                                        'class': 'cbi-button',
                                        'click': ui.hideModal
                                    }, _('取消')),
                                    ' ',
                                    E('button', {
                                        'class': 'cbi-button cbi-button-negative',
                                        'click': function () {
                                            ui.showModal(_('正在删除...'), [
                                                E('div', { 'class': 'spinning' }, _('正在删除配置并重载服务...'))
                                            ]);
                                            callRemoveAuto().then(function () {
                                                ui.hideModal();
                                                ui.addNotification(null, E('p', _('配置已删除，正在刷新...')), 'info');
                                                window.setTimeout(function () { location.reload(); }, 1500);
                                            });
                                        }
                                    }, _('确认删除'))
                                ])
                            ]);
                        }
                    }, _('删除所有 auto_ 配置'))
                ]) : null
            ]),

            // --- Generate Card ---
            E('div', { 'class': 'cbi-section' }, [
                E('legend', _('快捷生成虚拟接口')),
                E('div', { 'class': 'cbi-section-descr' },
                    _('指定物理接口和数量，自动创建 macvlan 设备、逻辑接口（DHCP）、防火墙 WAN 区域绑定，以及 mwan3 负载均衡配置。所有生成的条目均带有 auto_ 前缀，可安全重新生成（会覆盖旧配置）。')
                ),
                E('div', { 'class': 'cbi-section-node' }, [
                    // base iface
                    E('div', { 'class': 'cbi-value' }, [
                        E('label', { 'class': 'cbi-value-title' }, _('物理接口')),
                        E('div', { 'class': 'cbi-value-field' }, [
                            E('input', {
                                'id': 'quick_base_iface',
                                'class': 'cbi-input-text',
                                'value': base_iface || '',
                                'placeholder': 'eth0'
                            }),
                            E('div', { 'class': 'cbi-value-description' }, _('基于此物理接口创建 macvlan（如 eth0、eth1）'))
                        ])
                    ]),
                    // count
                    E('div', { 'class': 'cbi-value' }, [
                        E('label', { 'class': 'cbi-value-title' }, _('创建数量')),
                        E('div', { 'class': 'cbi-value-field' }, [
                            E('input', {
                                'id': 'quick_count',
                                'class': 'cbi-input-text',
                                'type': 'number',
                                'value': count || '',
                                'min': '1',
                                'max': '32',
                                'placeholder': '2'
                            }),
                            E('div', { 'class': 'cbi-value-description' }, _('生成 N 个 macvlan 虚拟接口及对应的 mwan3 成员（会覆盖旧配置）'))
                        ])
                    ]),
                    // Button
                    E('div', { 'class': 'cbi-value' }, [
                        E('label', { 'class': 'cbi-value-title' }),
                        E('div', { 'class': 'cbi-value-field' }, [
                            E('button', {
                                'class': 'cbi-button cbi-button-action',
                                'click': function () {
                                    var base_iface_val = document.getElementById('quick_base_iface').value.trim();
                                    var count_val = parseInt(document.getElementById('quick_count').value.trim(), 10);

                                    if (!base_iface_val) {
                                        ui.addNotification(null, E('p', _('请填写物理接口名称！')), 'error');
                                        return;
                                    }
                                    if (!count_val || count_val < 1) {
                                        ui.addNotification(null, E('p', _('请填写有效的数量（>= 1）！')), 'error');
                                        return;
                                    }

                                    ui.showModal(_('正在生成配置...'), [
                                        E('div', { 'class': 'spinning' }, _('正在清理旧配置并生成新接口配置，请稍候...'))
                                    ]);

                                    callQuickSetup(base_iface_val, count_val).then(function (res) {
                                        ui.hideModal();
                                        if (res && res.error) {
                                            ui.addNotification(null, E('p', _('执行出错: ') + res.error), 'error');
                                        } else {
                                            ui.addNotification(null, E('p', _('配置生成完毕，正在刷新...')), 'info');
                                            window.setTimeout(function () { location.reload(); }, 1500);
                                        }
                                    }).catch(function (e) {
                                        ui.hideModal();
                                        ui.addNotification(null, E('p', _('调用失败: ') + e.message), 'error');
                                    });
                                }
                            }, _('一键生成配置'))
                        ])
                    ])
                ])
            ])
        ]);

        return view;
    },

    handleSave: null,
    handleSaveApply: null,
    handleReset: null
});

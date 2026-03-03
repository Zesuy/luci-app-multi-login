'use strict';
'require view';
'require form';
'require fs';
'require ui';
'require rpc';

var callInitAction = rpc.declare({
    object: 'luci',
    method: 'setInitAction',
    params: ['name', 'action'],
    expect: { result: false }
});

var callServiceList = rpc.declare({
    object: 'service',
    method: 'list',
    params: ['name'],
    expect: { '': {} }
});

return view.extend({
    load: function () {
        return Promise.all([
            L.resolveDefault(callServiceList('multilogin'), {}),
            L.resolveDefault(fs.read('/var/run/multilogin.pid'), null)
        ]);
    },

    render: function (res) {
        var serviceInfo = res[0] && res[0].multilogin;
        var pidFile = res[1];
        
        var isRunning = false;
        var pid = null;
        
        if (serviceInfo && serviceInfo.instances) {
            var instances = serviceInfo.instances;
            for (var key in instances) {
                if (instances[key].running) {
                    isRunning = true;
                    pid = instances[key].pid;
                    break;
                }
            }
        }
        
        if (!isRunning && pidFile) {
            pid = pidFile.trim();
            isRunning = pid !== '';
        }

        var m, s, o;
        m = new form.Map('multilogin', _('自动登录管理'),
            _('为校园网管理多个WAN口的校园网自动登录，支持PC和移动端UA类型。本插件会借助mwan3自动监控接口状态并在离线时尝试登录。 配置教程见 \'https://github.com/Zesuy/luci-app-multi-login\''));

        s = m.section(form.TypedSection, 'settings', _('全局设置'));
        s.anonymous = true;
        s.addremove = false;

        o = s.option(form.Flag, 'enabled', _('启用自动登录'), _('启用后，服务将在后台自动监控并登录配置的接口'));
        o.rmempty = false;

        o = s.option(form.Value, 'retry_interval', _('初始重试间隔(秒)'), _('登录失败后的初始重试延迟，失败后会指数增长'));
        o.datatype = 'uinteger';
        o.default = '4';

        o = s.option(form.Value, 'check_interval', _('状态检查间隔(秒)'), _('每隔多少秒检查一次mwan3接口状态'));
        o.datatype = 'uinteger';
        o.default = '5';

        o = s.option(form.Value, 'max_retry_delay', _('最大重试延迟(秒)'), _('重试延迟的最大值，防止无限增长'));
        o.datatype = 'uinteger';
        o.default = '16384';

        o = s.option(form.Value, 'already_logged_delay', _('已登录状态延迟(秒)'), _('当检测到已登录但接口离线时的重试延迟'));
        o.datatype = 'uinteger';
        o.default = '16';

        var s4 = m.section(form.TableSection, 'instance', _('登录实例配置'));
        s4.anonymous = true;
        s4.addremove = true;

        o = s4.option(form.Flag, 'enabled', _('启用'));
        o.rmempty = false;

        o = s4.option(form.Value, 'alias', _('别名'), _('设置一个易于识别的名称'));
        o.placeholder = 'PC登录1';

        o = s4.option(form.Value, 'interface', _('逻辑接口名'), _('逻辑接口名，如:wan'));
        o.placeholder = 'wan';

        o = s4.option(form.Value, 'username', _('账号'), _('校园网登录账号'));
        o.placeholder = 'your_account';

        o = s4.option(form.Value, 'password', _('密码'), _('校园网登录密码'));
        o.password = true;
        o.placeholder = 'your_password';

        o = s4.option(form.ListValue, 'ua_type', _('UA类型'), _('选择登录时使用的User-Agent类型'));
        o.value('pc', 'PC');
        o.value('mobile', '移动端');
        o.default = 'pc';

        var s2 = m.section(form.TypedSection, 'settings', _('服务控制'));
        s2.anonymous = true;
        s2.addremove = false;

        if (isRunning) {
            o = s2.option(form.DummyValue, '_status', _('服务状态'));
            o.cfgvalue = function () { 
                return pid ? _('运行中 (PID: %s)').format(pid) : _('运行中'); 
            };

            o = s2.option(form.Button, '_stop', _('停止服务'));
            o.inputstyle = 'reset';
            o.onclick = function () {
                ui.showModal(_('正在停止...'), [E('div', { 'class': 'spinning' }, _('正在停止 multilogin 服务'))]);
                callInitAction('multilogin', 'stop').then(function () {
                    window.setTimeout(function () {
                        L.ui.hideModal();
                        location.reload();
                    }, 2000);
                });
            };

            o = s2.option(form.Button, '_restart', _('重启服务'));
            o.inputstyle = 'apply';
            o.onclick = function () {
                ui.showModal(_('正在重启...'), [E('div', { 'class': 'spinning' }, _('正在重启 multilogin 服务'))]);
                callInitAction('multilogin', 'restart').then(function () {
                    window.setTimeout(function () {
                        L.ui.hideModal();
                        location.reload();
                    }, 2000);
                });
            };
        } else {
            o = s2.option(form.DummyValue, '_status', _('服务状态'));
            o.cfgvalue = function () { return _('未运行'); };

            o = s2.option(form.Button, '_start', _('启动服务'));
            o.inputstyle = 'apply';
            o.onclick = function () {
                ui.showModal(_('正在启动...'), [E('div', { 'class': 'spinning' }, _('正在启动 multilogin 服务'))]);
                callInitAction('multilogin', 'start').then(function () {
                    window.setTimeout(function () {
                        L.ui.hideModal();
                        location.reload();
                    }, 2000);
                });
            };
        }

        return m.render();
    },

    handleSaveApply: function (ev, mode) {
        return this.handleSave(ev).then(function () {
            ui.changes.apply(mode == '0');
            return callInitAction('multilogin', 'restart');
        });
    }
});
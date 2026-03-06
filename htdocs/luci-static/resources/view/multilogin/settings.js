'use strict';
'require view';
'require form';
'require fs';
'require ui';
'require rpc';
'require uci';

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
            L.resolveDefault(fs.read('/var/run/multilogin.pid'), null),
            uci.load('network'),
            uci.load('multilogin')
        ]);
    },

    render: function (res) {
        var serviceInfo = res[0] && res[0].multilogin;
        var pidFile = res[1];
        // res[2] and res[3] are uci load results (side effects only)

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

        // 收集 network 逻辑接口列表
        var netInterfaces = [];
        uci.sections('network', 'interface', function (s) {
            var name = s['.name'];
            if (name !== 'loopback') {
                netInterfaces.push(name);
            }
        });

        // 收集 multilogin account 列表
        var accountOptions = [];
        uci.sections('multilogin', 'account', function (s) {
            var sname = s['.name'];
            var label = s.alias ? (s.alias + ' (' + (s.username || sname) + ')') : (s.username || sname);
            accountOptions.push([sname, label]);
        });

        var m, s, o;
        m = new form.Map('multilogin', _('自动登录配置'),
            _('配置各登录实例及全局参数。每个实例绑定一个逻辑接口与一个账户，由 mwan3 监控接口状态，离线时自动重新登录。请先在「账户管理」页添加账户，在「虚拟接口」页生成接口，再回此处创建实例。'));

        // ---- 全局设置 ----
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

        // ---- 登录实例配置 ----
        var s4 = m.section(form.TableSection, 'instance', _('登录实例配置'));
        s4.anonymous = true;
        s4.addremove = true;

        o = s4.option(form.Flag, 'enabled', _('启用'));
        o.rmempty = false;

        o = s4.option(form.Value, 'alias', _('别名'), _('设置一个易于识别的名称'));
        o.placeholder = 'PC登录1';

        // 接口：下拉选择，自动从 network UCI 读取
        o = s4.option(form.ListValue, 'interface', _('逻辑接口'));
        if (netInterfaces.length > 0) {
            netInterfaces.forEach(function (iface) {
                o.value(iface, iface);
            });
        } else {
            o.value('wan', 'wan');
        }
        o.description = _('选择 mwan3 管理的逻辑接口');

        // 账号：下拉选择，从 account section 读取
        o = s4.option(form.ListValue, 'account', _('账号'));
        if (accountOptions.length > 0) {
            accountOptions.forEach(function (a) {
                o.value(a[0], a[1]);
            });
        } else {
            o.value('', _('— 请先在"账户管理"页添加账户 —'));
        }
        o.description = _('在"账户管理"页面添加账户后可在此选择');

        // UA 类型
        o = s4.option(form.ListValue, 'ua_type', _('UA类型'), _('选择登录时使用的User-Agent类型'));
        o.value('pc', 'PC');
        o.value('mobile', '移动端');
        o.default = 'pc';

        return m.render();
    },

    handleSaveApply: function (ev, mode) {
        return this.handleSave(ev).then(function () {
            ui.changes.apply(mode == '0');
            return callInitAction('multilogin', 'restart');
        });
    }
});
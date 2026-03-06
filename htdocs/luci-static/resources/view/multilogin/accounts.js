'use strict';
'require view';
'require form';
'require uci';

return view.extend({
    load: function () {
        return uci.load('multilogin');
    },

    render: function () {
        var m, s, o;

        m = new form.Map('multilogin', _('账户管理'),
            _('在此统一管理校园网账户信息，密码以掩码形式存储于本地 UCI。账户创建后，可在「自动登录配置」页面的登录实例中通过下拉框直接引用，无需重复填写。'));

        s = m.section(form.TableSection, 'account', _('账户列表'));
        s.anonymous = false;
        s.addremove = true;
        s.addbtntitle = _('新增账户');

        o = s.option(form.Value, 'alias', _('别名'), _('易于识别的账户名称，如：主账号'));
        o.placeholder = '主账号';
        o.rmempty = true;

        o = s.option(form.Value, 'username', _('账号'), _('校园网登录账号'));
        o.placeholder = 'your_account';
        o.rmempty = false;

        o = s.option(form.Value, 'password', _('密码'), _('校园网登录密码'));
        o.password = true;
        o.placeholder = 'your_password';
        o.rmempty = false;

        return m.render();
    },

    handleSaveApply: function (ev, mode) {
        return this.handleSave(ev).then(function () {
            ui.changes.apply(mode == '0');
        });
    }
});

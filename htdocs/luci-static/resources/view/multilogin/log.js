'use strict';
'require view';
'require form';
'require fs';
'require ui';

return view.extend({
    load: function () {
        return L.resolveDefault(fs.read_direct('/var/log/multilogin.log'), '');
    },

    render: function (logdata) {
        var m, s, o;

        m = new form.Map('multilogin', _('运行日志'),
            _('显示 /var/log/multilogin.log 的实时内容，记录服务启停、登录尝试与错误信息。注意：日志文件在路由器重启后会被清空。'));

        s = m.section(form.TypedSection, 'settings');
        s.anonymous = true;
        s.addremove = false;

        o = s.option(form.TextValue, '_log');
        o.rows = 25;
        o.wrap = 'off';
        o.monospace = true;
        o.readonly = true;
        o.cfgvalue = function (section_id) {
            return logdata || _('暂无日志记录...');
        };

        var s2 = m.section(form.TypedSection, 'settings');
        s2.anonymous = true;
        s2.addremove = false;

        o = s2.option(form.Button, '_clear', _('清理日志'));
        o.inputstyle = 'reset';
        o.onclick = function () {
            fs.exec('/bin/sh', ['-c', '> /var/log/multilogin.log']).then(function () {
                location.reload();
            });
        };

        return m.render();
    },

    handleSave: null,
    handleSaveApply: null,
    handleReset: null
});

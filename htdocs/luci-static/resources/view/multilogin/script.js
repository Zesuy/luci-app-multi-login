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

return view.extend({
    load: function () {
        return Promise.all([
            L.resolveDefault(fs.read('/etc/multilogin/login.sh'), '')
        ]);
    },

    render: function (res) {
        var scriptContent = res[0] || '';

        var m, s, o;
        m = new form.Map('multilogin', _('登录脚本编辑'),
            _('在这里编辑 `login.sh` 脚本。这个脚本负责执行实际的登录操作，可以适当修改模板以适应不同校区。'));

        s = m.section(form.TypedSection, 'settings', _('脚本模板切换'));
        s.anonymous = true;
        s.addremove = false;

        var templateListValue = s.option(form.ListValue, '_template_type', _('选择模板'), _('选择预设的登录脚本模板，点击应用后将替换当前的 login.sh'));
        templateListValue.value('current', _('当前脚本'));
        templateListValue.value('huxi', _('虎溪模板 (login_huxi.sh) - 创建者: Zesuy'));
        templateListValue.value('login_a', _('A区模板 (login_A.sh) - 创建者: L-1124'));
        templateListValue.default = 'current';

        o = s.option(form.Button, '_apply_template', _('应用选择的模板'));
        o.inputstyle = 'apply';
        o.inputtitle = _('应用');
        o.onclick = function (ev, section_id) {
            var templateType = 'current';
            try {
                if (templateListValue && typeof templateListValue.formvalue === 'function') {
                    templateType = templateListValue.formvalue(section_id);
                }
            } catch (e) {
                console.error('获取模板类型失败:', e);
            }

            if (templateType === 'current') {
                ui.addNotification(null, E('p', _('请先选择一个模板再进行应用。')), 'warning');
                return;
            }

            if (!confirm(_('确认要替换当前脚本吗？此操作将覆盖 login.sh 文件的内容！'))) {
                return;
            }

            var sourceFile = '';
            if (templateType === 'huxi') {
                sourceFile = '/etc/multilogin/login_huxi.sh';
            } else if (templateType === 'login_a') {
                sourceFile = '/etc/multilogin/login_A.sh';
            }

            ui.showModal(_('正在应用模板...'), [E('div', { 'class': 'spinning' }, _('正在应用所选模板并重启服务'))]);

            fs.read(sourceFile).then(function(content) {
                return fs.write('/etc/multilogin/login.sh', content);
            }).then(function() {
                return L.resolveDefault(fs.exec('/bin/chmod', ['+x', '/etc/multilogin/login.sh']), null);
            }).then(function() {
                return callInitAction('multilogin', 'restart');
            }).then(function() {
                ui.addNotification(null, E('p', _('模板应用成功，服务已重启')), 'info');
                window.setTimeout(function () {
                    ui.hideModal();
                    location.reload();
                }, 1500);
            }).catch(function (err) {
                console.error('应用模板时出错:', err);
                ui.addNotification(null, E('p', _('应用模板失败: ') + (err.message || err.toString())), 'error');
                ui.hideModal();
            });
        };

        var s2 = m.section(form.TypedSection, 'settings', _('脚本内容编辑'));
        s2.anonymous = true;
        s2.addremove = false;

        o = s2.option(form.TextValue, '_login_script');
        o.rows = 30;
        o.wrap = 'off';
        o.monospace = true;
        o.cfgvalue = function (section_id) {
            return scriptContent;
        };
        o.write = function (section_id, value) {
            return fs.write('/etc/multilogin/login.sh', value.replace(/\r\n?/g, '\n')).then(function () {
                return L.resolveDefault(fs.exec('/bin/chmod', ['+x', '/etc/multilogin/login.sh']), null);
            });
        };

        return m.render();
    },

    handleSaveApply: function (ev, mode) {
        return this.handleSave(ev).then(function () {
            ui.changes.apply(mode == '0');
            return callInitAction('multilogin', 'restart');
        });
    }
});
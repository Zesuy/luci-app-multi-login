'use strict';
'require view';
'require rpc';
'require ui';

var callDiagnostics = rpc.declare({ object: 'multilogin', method: 'get_diagnostics', expect: { '': {} } });
var callLogs = rpc.declare({ object: 'multilogin', method: 'get_logs', expect: { '': {} } });
var callClearLogs = rpc.declare({ object: 'multilogin', method: 'clear_logs', expect: { '': {} } });

function compact(children) {
    return children.filter(function (child) { return child !== null && child !== undefined; });
}

/* Keep optional DOM children out of LuCI 23.05's legacy array appender. */
function children(items) { return compact(items || []); }
function disabledAttr(value) { return value ? 'disabled' : null; }
function failed(message) { return { ok: false, code: 'internal_error', message: message || _('无法读取诊断信息。'), data: {} }; }
function button(label, click, disabled, kind) { return E('button', { class: 'btn cbi-button ml-button ' + (kind || 'cbi-button-action'), type: 'button', disabled: disabledAttr(disabled), click: click }, label); }
function text(response) { return (response && response.message) || _('操作未完成，请重试。'); }
function status(label, kind) { return E('span', { class: 'ml-status ml-status--' + (kind || 'neutral') }, label); }
function badge(value) { return status(value === true ? _('可用') : _('不可用'), value === true ? 'success' : 'error'); }
function kv(label, value) { return E('div', { class: 'ml-kv' }, [E('dt', {}, label), E('dd', {}, value)]); }
function routeLink(label, route, kind) { return E('a', { class: 'btn cbi-button ml-button ' + (kind || 'cbi-button-action'), href: L.url('admin/services/multilogin/' + route) }, label); }
function maintenanceNav(active) {
    return E('nav', { class: 'ml-subnav', 'aria-label': _('维护页面') }, [
        E('a', { class: 'ml-subnav__link' + (active === 'troubleshooting' ? ' ml-subnav__link--active' : ''), href: L.url('admin/services/multilogin/maintenance/troubleshooting'), 'aria-current': active === 'troubleshooting' ? 'page' : null }, _('故障排查')),
        E('a', { class: 'ml-subnav__link' + (active === 'scripts' ? ' ml-subnav__link--active' : ''), href: L.url('admin/services/multilogin/maintenance/scripts'), 'aria-current': active === 'scripts' ? 'page' : null }, _('脚本维护'))
    ]);
}

function dependencyRows(dependencies) {
    dependencies = dependencies || {};
    return children([
        kv(_('bash'), badge(dependencies.bash)),
        kv(_('curl'), badge(dependencies.curl)),
        kv(_('mwan3'), badge(dependencies.mwan3)),
        kv(_('jsonfilter'), badge(dependencies.jsonfilter))
    ]);
}

function serviceRows(service) {
    service = service || {};
    return children([
        kv(_('运行状态'), E('span', {}, [
            status(service.running === true ? _('运行中') : _('未运行'), service.running === true ? 'success' : 'error'),
            E('span', { class: 'ml-help' }, service.running === true ? _('只读检查确认服务正在运行。') : _('服务当前没有运行。'))
        ])),
        kv(_('开机状态'), E('span', {}, [
            status(service.enabled === true ? _('已启用') : _('未启用'), service.enabled === true ? 'success' : 'warning'),
            E('span', { class: 'ml-help' }, service.enabled === true ? _('已配置为开机启用。') : _('服务未配置为开机启用。'))
        ]))
    ]);
}

function logRows(log) {
    log = log || {};
    var present = log.present === true;
    var size = log.size === null || log.size === undefined ? _('不可用') : String(log.size);
    return children([
        kv(_('固定日志'), E('span', {}, [
            status(present ? _('存在') : _('暂无'), present ? 'success' : 'neutral'),
            E('span', { class: 'ml-help' }, present ? _('可按需查看已脱敏内容。') : _('尚未产生固定诊断日志。'))
        ])),
        kv(_('日志大小'), E('span', { class: 'ml-code' }, present ? size + ' B' : _('不可用')))
    ]);
}

function recoveryValue(required, availableText) {
    return E('span', {}, [
        status(required ? _('待处理') : _('可用'), required ? 'warning' : 'success'),
        E('span', { class: 'ml-help' }, required ? _('检测到保留的恢复记录。') : availableText)
    ]);
}

function recoveryRows(diagnostics) {
    return children([
        kv(_('脚本恢复'), recoveryValue(diagnostics.script_recovery_required === true, _('没有待处理的脚本恢复记录。'))),
        kv(_('网络恢复'), recoveryValue(diagnostics.network_recovery_required === true, _('没有待处理的网络恢复记录。'))),
        kv(_('受管代次'), diagnostics.owned_generation === null || diagnostics.owned_generation === undefined ?
            status(_('不可用'), 'neutral') : E('span', { class: 'ml-code' }, String(diagnostics.owned_generation)))
    ]);
}

function missingDependencies(dependencies) {
    dependencies = dependencies || {};
    return ['bash', 'curl', 'mwan3', 'jsonfilter'].filter(function (name) { return dependencies[name] !== true; });
}

function primaryConclusion(diagnostics) {
    diagnostics = diagnostics || {};
    var service = diagnostics.service || {};
    var missing = missingDependencies(diagnostics.dependencies);

    if (service.running !== true) {
        return {
            label: service.enabled === true ? _('服务未运行') : _('服务未运行（未启用）'),
            kind: service.enabled === true ? 'warning' : 'error',
            detail: service.enabled === true ? _('服务已启用但当前未运行。请前往仪表盘明确启动服务。') : _('服务当前未启用。请前往仪表盘检查并启动服务。'),
            action: routeLink(_('前往仪表盘启动'), 'overview')
        };
    }

    if (missing.length) {
        return {
            label: _('依赖不完整'),
            kind: 'warning',
            detail: _('以下只读检查发现依赖不可用：') + missing.join('、') + _('。请检查设备安装状态后重新检查。')
        };
    }

    if (diagnostics.network_recovery_required === true) {
        return {
            label: _('网络恢复待处理'),
            kind: 'warning',
            detail: _('检测到未完成的受管网络恢复记录。请前往网络页面查看固定恢复路径。'),
            action: routeLink(_('前往网络恢复'), 'network')
        };
    }

    if (diagnostics.script_recovery_required === true) {
        return {
            label: _('脚本恢复待处理'),
            kind: 'warning',
            detail: _('检测到未完成的脚本恢复记录。请前往脚本页面查看受管恢复状态。'),
            action: routeLink(_('前往脚本恢复'), 'scripts')
        };
    }

    return {
        label: _('未发现需要立即处理的故障'),
        kind: 'success',
        detail: _('只读检查已完成。页面不会自动启动服务，也不会发起门户或网络请求。')
    };
}

function conclusionSection(diagnostics) {
    var conclusion = primaryConclusion(diagnostics);
    return E('section', { class: 'ml-section ml-card', 'aria-labelledby': 'ml-primary-conclusion-heading' }, children([
        E('div', { class: 'ml-section__header' }, [
            E('div', {}, [
                E('h3', { id: 'ml-primary-conclusion-heading' }, _('首要结论')),
                E('p', { class: 'ml-help' }, _('先处理这一项，再按需查看下面的检查结果和日志。'))
            ]),
            status(conclusion.label, conclusion.kind)
        ]),
        E('p', {}, conclusion.detail),
        conclusion.action ? E('div', { class: 'ml-actions' }, conclusion.action) : null
    ]));
}

function checksSection(diagnostics) {
    return E('section', { class: 'ml-section ml-card', 'aria-labelledby': 'ml-check-results-heading' }, [
        E('div', { class: 'ml-section__header' }, [
            E('div', {}, [
                E('h3', { id: 'ml-check-results-heading' }, _('检查结果')),
                E('p', { class: 'ml-help' }, _('以下内容来自只读检查，不会启动服务或改变网络状态。'))
            ])
        ]),
        E('div', { class: 'ml-grid ml-grid--3' }, [
            E('div', { class: 'ml-card' }, [E('h4', {}, _('依赖检查')), E('dl', { class: 'ml-kv-list' }, dependencyRows(diagnostics.dependencies))]),
            E('div', { class: 'ml-card' }, [E('h4', {}, _('服务检查')), E('dl', { class: 'ml-kv-list' }, serviceRows(diagnostics.service))]),
            E('div', { class: 'ml-card' }, [E('h4', {}, _('日志检查')), E('dl', { class: 'ml-kv-list' }, logRows(diagnostics.log))])
        ])
    ]);
}

function recoverySection(diagnostics) {
    return E('details', { class: 'ml-section ml-card', 'aria-labelledby': 'ml-recovery-heading' }, [
        E('summary', { class: 'ml-section__header' }, [
            E('span', { id: 'ml-recovery-heading' }, _('可用恢复能力')),
            status(_('按需展开'), 'neutral')
        ]),
        E('div', { class: 'ml-section__body' }, [
            E('p', { class: 'ml-help' }, _('这里只显示受管恢复状态和入口；不会在打开或刷新页面时自动执行恢复。')),
            E('dl', { class: 'ml-kv-list' }, recoveryRows(diagnostics)),
            E('div', { class: 'ml-actions' }, children([
                diagnostics.script_recovery_required === true ? routeLink(_('前往脚本恢复'), 'scripts', 'cbi-button') : null,
                diagnostics.network_recovery_required === true ? routeLink(_('前往网络恢复'), 'network', 'cbi-button') : null
            ]))
        ])
    ]);
}

return view.extend({
    load: function () {
        return Promise.all([
            L.resolveDefault(callDiagnostics(), failed()),
            L.resolveDefault(callLogs(), failed())
        ]);
    },

    render: function (initial) {
        var state = {
            diagnostics: initial[0] || failed(),
            logs: initial[1] || failed(),
            busy: false,
            feedback: '',
            error: false
        };
        var root = E('div', { class: 'cbi-map multilogin-page ml-page ml-page--diagnostics', 'aria-busy': 'false' });

        function refresh(message) {
            if (state.busy)
                return;

            state.busy = true;
            state.feedback = message || _('正在重新检查…');
            state.error = false;
            draw();
            Promise.all([
                L.resolveDefault(callDiagnostics(), failed()),
                L.resolveDefault(callLogs(), failed())
            ]).then(function (results) {
                state.diagnostics = results[0] || failed();
                state.logs = results[1] || failed();
                state.busy = false;
                if (!state.diagnostics.ok || !state.logs.ok) {
                    state.feedback = _('部分检查无法读取，请使用页面顶部“重新检查”重试。');
                    state.error = true;
                } else {
                    state.feedback = _('检查结果和日志已更新。');
                }
                draw();
            }, function () {
                state.diagnostics = failed();
                state.logs = failed(_('无法读取检查结果或日志。'));
                state.busy = false;
                state.feedback = _('检查失败，请使用页面顶部“重新检查”重试。');
                state.error = true;
                draw();
            });
        }

        function clear() {
            if (state.busy)
                return;

            ui.showModal(_('清理日志'), [
                E('p', {}, _('确认清理 MultiLogin 的固定诊断日志吗？此操作不能撤销。')),
                E('div', { class: 'right' }, [
                    button(_('取消'), ui.hideModal, false, 'cbi-button'),
                    button(_('清理日志'), function () {
                        ui.hideModal();
                        state.busy = true;
                        state.feedback = _('正在清理日志…');
                        state.error = false;
                        draw();
                        L.resolveDefault(callClearLogs(), failed()).then(function (response) {
                            if (!response.ok) {
                                state.busy = false;
                                state.feedback = text(response);
                                state.error = true;
                                draw();
                                return;
                            }
                            state.busy = false;
                            refresh(_('日志已清理，正在重新检查…'));
                        });
                    }, false, 'cbi-button-negative')
                ])
            ]);
        }

        function diagnosticsError(response) {
            return E('section', { class: 'ml-section ml-card', 'aria-labelledby': 'ml-primary-conclusion-heading' }, [
                E('div', { class: 'ml-section__header' }, [
                    E('h3', { id: 'ml-primary-conclusion-heading' }, _('首要结论')),
                    status(_('检查失败'), 'error')
                ]),
                E('p', {}, text(response)),
                E('p', { class: 'ml-help' }, _('请使用页面顶部“重新检查”重试；页面不会自动启动服务。'))
            ]);
        }

        function logsSection(logs) {
            var hasLogContent = !!(logs && logs.content);
            return E('section', { class: 'ml-section ml-card', 'aria-labelledby': 'ml-logs-heading' }, [
                E('div', { class: 'ml-section__header' }, [
                    E('div', {}, [
                        E('h3', { id: 'ml-logs-heading' }, _('日志')),
                        E('p', { class: 'ml-help' }, logs.truncated ? _('仅显示已验证脱敏后的末尾内容，较早内容已截断。') : _('日志已在服务器端进行有界读取和脱敏。'))
                    ]),
                    E('div', { class: 'ml-actions' }, [
                        status(_('已脱敏'), 'success'),
                        logs.truncated ? status(_('已截断'), 'warning') : status(_('完整范围'), 'neutral')
                    ])
                ]),
                hasLogContent ? E('pre', { id: 'ml-log-content', class: 'ml-code-output', tabindex: '0', role: 'region', 'aria-label': _('已脱敏 MultiLogin 日志') }, logs.content) : E('div', { class: 'ml-empty', role: 'status' }, E('p', {}, _('暂无日志。日志产生后会显示在这里。'))),
                E('div', { class: 'ml-toolbar' }, button(_('清理日志'), clear, state.busy, 'cbi-button-negative') )
            ]);
        }

        function logsError(response) {
            return E('section', { class: 'ml-section ml-card', 'aria-labelledby': 'ml-logs-heading' }, [
                E('div', { class: 'ml-section__header' }, [
                    E('h3', { id: 'ml-logs-heading' }, _('日志')),
                    status(_('读取失败'), 'error')
                ]),
                E('p', {}, text(response)),
                E('p', { class: 'ml-help' }, _('请使用页面顶部“重新检查”重试。')),
                E('div', { class: 'ml-toolbar' }, button(_('清理日志'), clear, state.busy, 'cbi-button-negative'))
            ]);
        }

        function draw() {
            var diagnostics = state.diagnostics.ok ? state.diagnostics.data : null;
            var logs = state.logs.ok ? state.logs.data : null;
            root.replaceChildren.apply(root, compact([
                E('link', { rel: 'stylesheet', href: L.resource('view/multilogin/multi-login.css') }),
                E('div', { class: 'ml-page__header' }, [
                    E('div', { class: 'ml-page__heading' }, [
                        E('h2', { class: 'ml-page__title' }, _('故障排查')),
                        E('p', { class: 'ml-page__description' }, _('按任务检查 MultiLogin 的服务、依赖和固定诊断日志；页面只读，不会自动启动服务或发起门户、网络请求。'))
                    ]),
                    E('div', { class: 'ml-page__header-actions' }, [
                        button(state.busy ? _('正在检查…') : _('重新检查'), function () { refresh(); }, state.busy)
                    ])
                ]),
                maintenanceNav('troubleshooting'),
                state.feedback ? E('div', { class: state.error ? 'ml-feedback ml-feedback--error' : 'ml-feedback ml-feedback--success', role: state.error ? 'alert' : 'status', 'aria-live': state.error ? 'assertive' : 'polite', 'aria-atomic': 'true' }, compact([E('p', {}, state.feedback)])) : null,
                diagnostics ? conclusionSection(diagnostics) : diagnosticsError(state.diagnostics),
                diagnostics ? checksSection(diagnostics) : null,
                logs ? logsSection(logs) : logsError(state.logs),
                diagnostics ? recoverySection(diagnostics) : null,
                E('div', { class: 'ml-help', role: 'note' }, _('日志清理不可撤销；页面不会显示账号密码、Cookie 或任意命令输出。'))
            ]));
            root.setAttribute('aria-busy', state.busy ? 'true' : 'false');
        }

        draw();
        return root;
    },

    handleSave: null,
    handleSaveApply: null,
    handleReset: null
});

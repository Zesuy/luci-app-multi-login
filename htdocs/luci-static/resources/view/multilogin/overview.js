'use strict';
'require view';
'require rpc';
'require ui';

var callOverview = rpc.declare({ object: 'multilogin', method: 'get_overview', expect: { '': {} } });
var callServiceAction = rpc.declare({ object: 'multilogin', method: 'service_action', params: ['action'], expect: { '': {} } });

function failure(message) {
	return { ok: false, code: 'internal_error', message: message || _('无法读取仪表盘。'), data: {} };
}

function compact(children) {
	return children.filter(function (child) { return child !== null && child !== undefined; });
}

function disabledAttr(value) {
	return value ? 'disabled' : null;
}

function button(label, click, disabled, kind) {
	return E('button', {
		'class': 'btn cbi-button ml-button ' + (kind || 'cbi-button'),
		'type': 'button',
		'disabled': disabledAttr(disabled),
		'click': click
	}, label);
}

function link(label, href, kind) {
	return E('a', {
		'class': 'btn cbi-button ml-button ' + (kind || 'cbi-button'),
		'href': href
	}, label);
}

function status(label, kind) {
	return E('span', { 'class': 'ml-status ml-status--' + (kind || 'neutral') }, label);
}

function styleLink() {
	return E('link', { 'rel': 'stylesheet', 'href': L.resource('view/multilogin/multi-login.css') });
}

return view.extend({
	load: function () {
		return L.resolveDefault(callOverview(), failure());
	},

	render: function (initial) {
		var state = {
			response: initial || failure(),
			busy: false,
			feedback: '',
			feedbackKind: 'status'
		};
		var root = E('div', { 'class': 'cbi-map multilogin-page ml-page ml-page--overview', 'aria-busy': 'false' });

		function requestOverview() {
			return L.resolveDefault(callOverview(), failure()).then(function (response) {
				return response || failure();
			});
		}

		function refresh() {
			if (state.busy)
				return;
			state.busy = true;
			state.feedback = _('正在刷新仪表盘…');
			state.feedbackKind = 'status';
			draw();
			requestOverview().then(function (response) {
				state.response = response;
				state.busy = false;
				state.feedback = response.ok ? _('仪表盘已刷新。') : '';
				state.feedbackKind = response.ok ? 'status' : 'error';
				draw();
			});
		}

		function runServiceAction(entry) {
			if (state.busy)
				return;
			state.busy = true;
			state.feedback = _('正在执行“%s”…').format(entry.label);
			state.feedbackKind = 'status';
			draw();
			L.resolveDefault(callServiceAction(entry.action), failure(_('服务操作请求失败，请重试。'))).then(function (response) {
				if (!response || !response.ok) {
					state.busy = false;
					state.feedback = response && response.message ? response.message : _('服务操作未完成，请重试。');
					state.feedbackKind = 'error';
					draw();
					return;
				}
				requestOverview().then(function (next) {
					state.response = next;
					state.busy = false;
					state.feedback = next.ok ? _('服务操作“%s”已完成。').format(entry.label) : '';
					state.feedbackKind = next.ok ? 'status' : 'error';
					draw();
				});
			});
		}

		function confirmServiceAction(entry) {
			ui.showModal(_('确认服务操作'), [E('div', { 'class': 'ml-page ml-section ml-card ml-modal' }, [
				E('p', {}, _('将对 MultiLogin 服务执行“%s”。').format(entry.label)),
				E('p', { 'class': 'ml-help' }, _('页面加载、刷新和状态读取不会执行服务操作。')),
				E('div', { 'class': 'right' }, [
					button(_('取消'), function () { ui.hideModal(); }, false, 'cbi-button'),
					button(_('确认'), function () { ui.hideModal(); runServiceAction(entry); }, false, entry.danger ? 'cbi-button-negative' : 'cbi-button-action')
				])
			])]);
		}

		function draw() {
			var response = state.response || failure();
			var data = response.ok && response.data ? response.data : {};
			var error = !response.ok ? (response.message || _('无法读取仪表盘，请重试。')) : '';
			var accounts = data.account_count > 0 ? data.account_count : 0;
			var instances = data.instance_count > 0 ? data.instance_count : 0;
			var blockers = [];
			var conclusion;
			var conclusionKind;
			var conclusionDetail;
			var conclusionAction;
			var serviceActions = [
				{ action: 'start', label: _('启动服务'), danger: false },
				{ action: 'stop', label: _('停止服务'), danger: true },
				{ action: 'restart', label: _('重启服务'), danger: false },
				{ action: 'enable', label: _('启用开机启动'), danger: false },
				{ action: 'disable', label: _('停用开机启动'), danger: true }
			];

			if (data.network_recovery_required)
				blockers.push(E('li', { 'class': 'ml-dashboard-blocker' }, [status(_('需要恢复'), 'warning'), E('span', {}, _('网络资源存在待恢复状态；完成恢复前不要重复应用配置。'))]));
			if (!data.settings_enabled)
				blockers.push(E('li', { 'class': 'ml-dashboard-blocker' }, [status(_('已停用'), 'neutral'), E('span', {}, _('自动登录策略当前停用，请在“登录管理”中确认设置。'))]));
			if (!accounts)
				blockers.push(E('li', { 'class': 'ml-dashboard-blocker' }, [status(_('缺少账户'), 'warning'), E('span', {}, _('尚未创建登录账户，服务无法执行有效登录。'))]));
			if (!instances)
				blockers.push(E('li', { 'class': 'ml-dashboard-blocker' }, [status(_('缺少实例'), 'warning'), E('span', {}, _('尚未创建登录实例，请先完成实例配置。'))]));
			if (accounts && instances && data.settings_enabled && !data.service_running)
				blockers.push(E('li', { 'class': 'ml-dashboard-blocker' }, [status(_('服务未运行'), 'warning'), E('span', {}, _('配置已就绪，但后台服务尚未运行；可在本页明确启动。'))]));

			if (!accounts || !instances || !data.settings_enabled) {
				conclusion = _('登录配置尚未完整');
				conclusionKind = 'warning';
				conclusionDetail = _('账号、登录任务或自动登录策略仍未完成。请前往登录管理继续设置。');
				conclusionAction = link(_('打开登录管理'), L.url('admin/services/multilogin/configuration'), 'cbi-button-action');
			} else if (!data.service_running) {
				conclusion = data.service_enabled ? _('配置已就绪，服务尚未运行') : _('配置已就绪，服务未启用');
				conclusionKind = 'warning';
				conclusionDetail = _('账号、登录任务和自动登录策略已就绪；请在阻塞警告卡内明确启动服务。');
			} else {
				conclusion = _('MultiLogin 正在按当前配置运行');
				conclusionKind = 'success';
				conclusionDetail = _('账号、登录任务、自动登录策略和服务均处于可运行状态。');
			}

			var conclusionChildren = [
				E('div', { 'class': 'ml-section__header' }, [
					E('div', {}, [E('h3', { 'id': 'overview-conclusion-heading' }, _('总体结论')), E('p', { 'class': 'ml-help' }, _('结论只根据账号、登录任务、自动登录和服务状态判断。'))]),
					status(conclusion, conclusionKind)
				]),
				E('p', { 'class': 'ml-dashboard-conclusion__text' }, conclusionDetail)
			];
			if (conclusionAction)
				conclusionChildren.push(E('div', { 'class': 'ml-actions' }, [conclusionAction]));

			var blockerChildren = compact([
				E('div', { 'class': 'ml-section__header' }, [
					E('div', {}, [E('h3', { 'id': 'overview-blockers-heading' }, _('阻塞警告')), E('p', { 'class': 'ml-help' }, _('仅显示会影响自动登录或安全恢复的事项；网络资源尚未创建不会阻塞仪表盘。'))]),
					status(blockers.length ? _('%s 项待处理').format(blockers.length) : _('无阻塞'), blockers.length ? 'warning' : 'success')
				]),
				blockers.length ? E('ul', { 'class': 'ml-dashboard-blockers__list' }, blockers) : E('p', { 'class': 'ml-dashboard-blockers__clear' }, _('当前没有阻塞项。')),
				E('div', { 'class': 'ml-dashboard-service-inline' }, [
					E('h4', {}, _('服务核心操作')),
					E('p', { 'class': 'ml-help' }, _('所有动作都需要明确点击并确认；页面加载和刷新不会触发服务。')),
					E('div', { 'class': 'ml-actions ml-dashboard-service__actions' }, serviceActions.map(function (entry) {
						return button(entry.label, function () { confirmServiceAction(entry); }, state.busy, entry.danger ? 'cbi-button-negative' : 'cbi-button');
					}))
				])
			]);

			root.replaceChildren.apply(root, compact([
				styleLink(),
				E('div', { 'class': 'ml-page__header' }, [
					E('div', { 'class': 'ml-page__heading' }, [
						E('h2', { 'class': 'ml-page__title' }, _('仪表盘')),
						E('p', { 'class': 'ml-page__description' }, _('先看总体结论和阻塞项，再明确执行服务运行操作。'))
					]),
					E('div', { 'class': 'ml-page__header-actions' }, [button(state.busy ? _('正在刷新…') : _('刷新仪表盘'), refresh, state.busy, 'cbi-button')])
				]),
				state.feedback ? E('div', { 'class': 'ml-feedback ' + (state.feedbackKind === 'error' ? 'ml-feedback--error' : 'ml-feedback--loading'), 'role': state.feedbackKind === 'error' ? 'alert' : 'status', 'aria-live': state.feedbackKind === 'error' ? 'assertive' : 'polite' }, E('p', {}, state.feedback)) : null,
				error ? E('div', { 'class': 'ml-feedback ml-feedback--error', 'role': 'alert', 'aria-live': 'assertive' }, [
					E('p', {}, error),
					E('div', { 'class': 'ml-actions' }, [button(_('重试'), refresh, state.busy, 'cbi-button'), link(_('打开故障排查'), L.url('admin/services/multilogin/maintenance/troubleshooting'), 'cbi-button')])
				]) : null,
				!error ? E('section', { 'class': 'ml-section ml-card ml-dashboard-conclusion', 'aria-labelledby': 'overview-conclusion-heading', 'aria-live': 'polite' }, conclusionChildren) : null,
				!error ? E('section', { 'class': 'ml-section ml-card ml-dashboard-blockers', 'aria-labelledby': 'overview-blockers-heading' }, blockerChildren) : null
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

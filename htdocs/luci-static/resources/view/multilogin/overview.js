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

function stat(label, value, meta, badge) {
	return E('article', { 'class': 'ml-stat' }, [
		E('div', { 'class': 'ml-stat__label' }, label),
		E('div', { 'class': 'ml-stat__value' }, value),
		badge || null,
		E('p', { 'class': 'ml-stat__meta' }, meta)
	]);
}

function count(value) {
	return typeof value === 'number' && value >= 0 ? value : 0;
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
			var accounts = count(data.account_count);
			var instances = count(data.instance_count);
			var enabledInstances = count(data.enabled_instance_count);
			var ownedNetworks = count(data.owned_network_count);
			var serviceLabel = data.service_running ? _('运行中') : (data.service_enabled ? _('已启用但未运行') : _('未启用'));
			var serviceKind = data.service_running ? 'success' : (data.service_enabled ? 'warning' : 'neutral');
			var blockers = [];
			var primaryLabel;
			var primaryHref;
			var primaryAction;
			var conclusion;
			var conclusionKind;
			var conclusionDetail;
			var networkStatusLabel;
			var networkStatusKind;
			var recoverySectionChildren;
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
			if (!ownedNetworks)
				blockers.push(E('li', { 'class': 'ml-dashboard-blocker' }, [status(_('缺少网络资源'), 'warning'), E('span', {}, _('尚未创建受管网络资源，请先完成网络资源设置。'))]));
			if (accounts && instances && ownedNetworks && data.settings_enabled && !data.service_running)
				blockers.push(E('li', { 'class': 'ml-dashboard-blocker' }, [status(_('服务未运行'), 'warning'), E('span', {}, _('配置已就绪，但后台服务尚未运行；可在本页明确启动。'))]));

			if (data.network_recovery_required) {
				conclusion = _('需要先恢复网络资源');
				conclusionKind = 'warning';
				conclusionDetail = _('网络资源存在待恢复状态。请先完成固定恢复检查，再继续配置。');
				primaryLabel = _('查看网络资源');
				primaryHref = L.url('admin/services/multilogin/network');
			} else if (!ownedNetworks) {
				conclusion = _('尚未配置网络资源');
				conclusionKind = 'warning';
				conclusionDetail = _('还没有由 MultiLogin 记录的受管网络资源；请先完成网络资源设置。');
				primaryLabel = _('打开网络资源');
				primaryHref = L.url('admin/services/multilogin/network');
			} else if (!accounts || !instances || !data.settings_enabled) {
				conclusion = _('登录配置尚未完整');
				conclusionKind = 'warning';
				conclusionDetail = _('网络资源已存在，但账号、登录任务或自动登录策略仍未完成。请前往登录管理继续设置。');
				primaryLabel = _('打开登录管理');
				primaryHref = L.url('admin/services/multilogin/configuration');
			} else if (!data.service_running) {
				conclusion = _('配置已就绪，服务尚未运行');
				conclusionKind = 'warning';
				conclusionDetail = _('配置已就绪，但后台服务尚未运行；请确认后明确启动服务。');
				primaryLabel = serviceActions[0].label;
				primaryAction = serviceActions[0];
			} else {
				conclusion = _('MultiLogin 正在按当前配置运行');
				conclusionKind = 'success';
				conclusionDetail = _('服务正在运行；如需改变服务状态，请使用下方明确的服务操作。');
				primaryLabel = '';
			}
			networkStatusLabel = data.network_recovery_required ? _('需要恢复') : (!ownedNetworks ? _('尚未配置') : _('状态正常'));
			networkStatusKind = data.network_recovery_required || !ownedNetworks ? 'warning' : 'success';
			recoverySectionChildren = [
				E('div', { 'class': 'ml-section__header' }, [E('div', {}, [E('h3', { 'id': 'overview-recovery-heading' }, _('恢复提醒')), E('p', { 'class': 'ml-help' }, _('恢复提醒只描述受管资源，不会自动执行恢复。'))]), status(data.network_recovery_required ? _('需要处理') : _('无需恢复'), data.network_recovery_required ? 'warning' : 'success')]),
				E('p', {}, data.network_recovery_required ? _('网络资源存在待恢复状态。请前往“网络资源”查看固定恢复操作和受管范围。') : _('当前没有待恢复的网络资源。'))
			];
			if (data.network_recovery_required)
				recoverySectionChildren.push(E('div', { 'class': 'ml-actions' }, [link(_('查看网络资源'), L.url('admin/services/multilogin/network'), 'cbi-button')]));

			var primaryControl = primaryAction ?
				button(primaryLabel, function () { confirmServiceAction(primaryAction); }, state.busy, 'cbi-button-action') :
				(primaryLabel ? link(primaryLabel, primaryHref, 'cbi-button-action') : null);
			var visibleServiceActions = serviceActions.filter(function (entry) {
				return !primaryAction || entry.action !== primaryAction.action;
			});

			root.replaceChildren.apply(root, compact([
				styleLink(),
				E('div', { 'class': 'ml-page__header' }, [
					E('div', { 'class': 'ml-page__heading' }, [
						E('h2', { 'class': 'ml-page__title' }, _('仪表盘')),
						E('p', { 'class': 'ml-page__description' }, _('先看总体结论和阻塞项，再完成配置或明确执行服务运行操作。'))
					]),
					E('div', { 'class': 'ml-page__header-actions' }, [button(state.busy ? _('正在刷新…') : _('刷新仪表盘'), refresh, state.busy, 'cbi-button')])
				]),
				state.feedback ? E('div', { 'class': 'ml-feedback ' + (state.feedbackKind === 'error' ? 'ml-feedback--error' : 'ml-feedback--loading'), 'role': state.feedbackKind === 'error' ? 'alert' : 'status', 'aria-live': state.feedbackKind === 'error' ? 'assertive' : 'polite' }, E('p', {}, state.feedback)) : null,
				error ? E('div', { 'class': 'ml-feedback ml-feedback--error', 'role': 'alert', 'aria-live': 'assertive' }, [
					E('p', {}, error),
					E('div', { 'class': 'ml-actions' }, [button(_('重试'), refresh, state.busy, 'cbi-button'), link(_('打开故障排查'), L.url('admin/services/multilogin/maintenance/troubleshooting'), 'cbi-button')])
				]) : null,
				!error ? E('section', { 'class': 'ml-section ml-card ml-dashboard-conclusion', 'aria-labelledby': 'overview-conclusion-heading', 'aria-live': 'polite' }, [
					E('div', { 'class': 'ml-section__header' }, [
						E('div', {}, [E('h3', { 'id': 'overview-conclusion-heading' }, _('总体结论')), E('p', { 'class': 'ml-help' }, _('状态文字同时说明原因，不依赖颜色判断。'))]),
						status(conclusion, conclusionKind)
					]),
					E('p', { 'class': 'ml-dashboard-conclusion__text' }, conclusionDetail)
				]) : null,
				!error ? E('section', { 'class': 'ml-section ml-card ml-dashboard-blockers', 'aria-labelledby': 'overview-blockers-heading' }, [
					E('div', { 'class': 'ml-section__header' }, [E('div', {}, [E('h3', { 'id': 'overview-blockers-heading' }, _('阻塞警告')), E('p', { 'class': 'ml-help' }, _('这些事项会影响自动登录或网络资源安全。'))]), status(blockers.length ? _('%s 项待处理').format(blockers.length) : _('无阻塞'), blockers.length ? 'warning' : 'success')]),
					blockers.length ? E('ul', { 'class': 'ml-dashboard-blockers__list' }, blockers) : E('p', { 'class': 'ml-dashboard-blockers__clear' }, _('当前没有阻塞项。'))
				]) : null,
				!error ? E('section', { 'class': 'ml-section ml-card ml-dashboard-completeness', 'aria-labelledby': 'overview-completeness-heading' }, [
					E('div', { 'class': 'ml-section__header' }, [E('div', {}, [E('h3', { 'id': 'overview-completeness-heading' }, _('状态与配置完整度')), E('p', { 'class': 'ml-help' }, _('汇总账户、实例、服务和受管网络的当前快照。'))])]),
					E('div', { 'class': 'ml-grid ml-grid--stats', 'aria-label': _('MultiLogin 状态与配置') }, compact([
						stat(_('服务'), serviceLabel, data.service_running ? _('后台服务正在运行。') : _('服务不会因页面加载或刷新自动启动。'), status(serviceLabel, serviceKind)),
						stat(_('自动登录'), data.settings_enabled ? _('已启用') : _('已停用'), data.settings_enabled ? _('登录策略允许执行。') : _('请在登录管理中启用策略。'), status(data.settings_enabled ? _('已启用') : _('已停用'), data.settings_enabled ? 'success' : 'neutral')),
						stat(_('账户与实例'), _('%s 个账户').format(accounts), _('%s 个实例，其中 %s 个启用。').format(instances, enabledInstances), status(_('%s 个实例').format(instances), instances ? 'success' : 'warning')),
						stat(_('受管网络'), _('%s 个接口').format(ownedNetworks), data.network_recovery_required ? _('存在待处理的恢复状态。') : _('只显示 MultiLogin 明确记录的资源。'), status(networkStatusLabel, networkStatusKind))
					]))
				]) : null,
				!error ? E('section', { 'class': 'ml-section ml-card ml-dashboard-primary', 'aria-labelledby': 'overview-primary-heading' }, [
					E('div', { 'class': 'ml-section__header' }, [E('div', {}, [E('h3', { 'id': 'overview-primary-heading' }, _('下一步')), E('p', { 'class': 'ml-help' }, _('每次只提供一个主操作，服务运行操作集中在下方。'))])]),
					E('p', {}, data.network_recovery_required ? _('请先查看受管网络资源并完成恢复检查。') : ((!ownedNetworks) ? _('请先完成网络资源设置。') : ((!accounts || !instances || !data.settings_enabled) ? _('请先完成登录管理中的必要配置。') : (data.service_running ? _('当前运行正常；需要改变服务状态时，请使用下方明确的服务操作。') : _('配置已就绪；可以明确启动服务。'))))),
					primaryControl ? E('div', { 'class': 'ml-actions' }, [primaryControl]) : null
				]) : null,
				!error ? E('section', { 'class': 'ml-section ml-card ml-dashboard-service', 'aria-labelledby': 'overview-service-heading' }, [
					E('div', { 'class': 'ml-section__header' }, [E('div', {}, [E('h3', { 'id': 'overview-service-heading' }, _('服务运行操作')), E('p', { 'class': 'ml-help' }, _('所有动作都需要明确点击并确认；刷新和保存不会触发服务。'))]), E('div', { 'class': 'ml-actions' }, [status(serviceLabel, serviceKind), status(data.service_enabled ? _('开机已启用') : _('开机未启用'), data.service_enabled ? 'success' : 'neutral')])]),
					E('div', { 'class': 'ml-actions ml-dashboard-service__actions' }, visibleServiceActions.map(function (entry) {
						return button(entry.label, function () { confirmServiceAction(entry); }, state.busy, entry.danger ? 'cbi-button-negative' : 'cbi-button');
					}))
				]) : null,
				!error ? E('section', { 'class': 'ml-section ml-card ml-dashboard-recovery', 'aria-labelledby': 'overview-recovery-heading' }, recoverySectionChildren) : null
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

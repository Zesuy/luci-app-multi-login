module("luci.controller.MultiLogin", package.seeall)

function index()
	-- 定义主入口和标签页
	local page = entry({"admin", "services", "multilogin"}, alias("admin", "services", "multilogin", "settings"), _("Auto-Login"), 60)
	page.dependent = false
	page.icon = "services/multilogin.png" -- 可以为插件添加一个图标

	-- "设置与实例" 标签页 (默认)
	entry({"admin", "services", "multilogin", "settings"}, cbi("multilogin/settings"), _("设置与实例"), 1)

	-- "登录脚本" 标签页
	entry({"admin", "services", "multilogin", "script"}, cbi("multilogin/script"), _("编辑脚本"), 2)

	-- "运行日志" 标签页
	entry({"admin", "services", "multilogin", "log"}, cbi("multilogin/log"), _("日志"), 3)
end

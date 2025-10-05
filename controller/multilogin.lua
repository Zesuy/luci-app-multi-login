module("luci.controller.multilogin", package.seeall)

function index()
	if not nixio.fs.access("/etc/config/multilogin") then
		return
	end

	local page
	page = entry({"admin", "services", "multilogin"}, alias("admin", "services", "multilogin", "status"), _("多WAN登录"), 60)
	page.dependent = false
	page.acl_depends = { "luci-app-multilogin" }

	entry({"admin", "services", "multilogin", "status"}, cbi("multilogin/status"), _("运行状态"), 1).leaf = true
	entry({"admin", "services", "multilogin", "global"}, cbi("multilogin/global"), _("全局设置"), 2).leaf = true
	entry({"admin", "services", "multilogin", "instances"}, cbi("multilogin/instances"), _("登录实例"), 3).leaf = true
	entry({"admin", "services", "multilogin", "scripts"}, cbi("multilogin/scripts"), _("脚本编辑"), 4).leaf = true
	
	entry({"admin", "services", "multilogin", "get_log"}, call("action_get_log")).leaf = true
	entry({"admin", "services", "multilogin", "clear_log"}, call("action_clear_log")).leaf = true
end

function action_get_log()
	local util = require "luci.util"
	local log = util.exec("logread | grep 'multi_login' | tail -n 100")
	luci.http.prepare_content("text/plain; charset=utf-8")
	luci.http.write(log)
end

function action_clear_log()
	luci.sys.call("logread -c")
	luci.http.status(200, "OK")
	luci.http.prepare_content("text/plain")
	luci.http.write("Log cleared")
end

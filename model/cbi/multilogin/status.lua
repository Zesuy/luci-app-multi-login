local fs = require "nixio.fs"
local sys = require "luci.sys"
local util = require "luci.util"

m = SimpleForm("status", translate("运行状态"), 
	translate("查看多WAN登录服务的运行状态和日志信息"))

m.reset = false
m.submit = false

-- 服务状态
s = m:section(SimpleSection)
s.title = translate("服务状态")

local running = false
local pid = util.trim(sys.exec("pidof login_control"))

if pid ~= "" then
	running = true
end

status = s:option(DummyValue, "service_status", translate("服务状态"))
if running then
	status.value = translate("<span style='color:green;font-weight:bold'>运行中</span> (PID: " .. pid .. ")")
else
	status.value = translate("<span style='color:red;font-weight:bold'>未运行</span>")
end

-- 全局配置状态
global_enabled = s:option(DummyValue, "global_enabled", translate("全局开关"))
local uci = require "luci.model.uci".cursor()
local enabled = uci:get("multilogin", "global", "enabled")
if enabled == "1" then
	global_enabled.value = translate("<span style='color:green'>已启用</span>")
else
	global_enabled.value = translate("<span style='color:red'>已禁用</span>")
end

-- 实例统计
instance_count = s:option(DummyValue, "instance_count", translate("配置实例数"))
local count_total = 0
local count_enabled = 0
uci:foreach("multilogin", "instance", function(s)
	count_total = count_total + 1
	if s.enabled == "1" then
		count_enabled = count_enabled + 1
	end
end)
instance_count.value = string.format("%d 个 (已启用: %d)", count_total, count_enabled)

-- MWAN3 接口状态
s2 = m:section(SimpleSection)
s2.title = translate("MWAN3 接口状态")
s2.description = translate("显示当前配置的接口在 MWAN3 中的状态")

mwan3_status = s2:option(TextValue, "mwan3_status")
mwan3_status.rows = 10
mwan3_status.readonly = true
mwan3_status.wrap = "off"

function mwan3_status.cfgvalue(self, section)
	if fs.access("/usr/sbin/mwan3") then
		return sys.exec("mwan3 interfaces 2>/dev/null") or translate("无法获取 MWAN3 状态")
	else
		return translate("MWAN3 未安装")
	end
end

-- 日志查看
s3 = m:section(SimpleSection)
s3.title = translate("运行日志")
s3.description = translate("显示最近100条多WAN登录相关的日志")

log_view = s3:option(TextValue, "log_view")
log_view.rows = 20
log_view.readonly = true
log_view.wrap = "off"

function log_view.cfgvalue(self, section)
	local log = sys.exec("logread | grep 'multi_login' | tail -n 100")
	if log == "" then
		return translate("暂无日志")
	end
	return log
end

-- 控制按钮
s4 = m:section(SimpleSection)
s4.title = translate("服务控制")

if running then
	btn_stop = s4:option(Button, "stop", translate("停止服务"))
	btn_stop.inputtitle = translate("停止")
	btn_stop.inputstyle = "remove"
	
	function btn_stop.write(self, section)
		sys.call("/etc/init.d/multilogin stop >/dev/null 2>&1")
		luci.http.redirect(luci.dispatcher.build_url("admin", "services", "multilogin", "status"))
	end

	btn_restart = s4:option(Button, "restart", translate("重启服务"))
	btn_restart.inputtitle = translate("重启")
	btn_restart.inputstyle = "reload"
	
	function btn_restart.write(self, section)
		sys.call("/etc/init.d/multilogin restart >/dev/null 2>&1")
		luci.http.redirect(luci.dispatcher.build_url("admin", "services", "multilogin", "status"))
	end
else
	btn_start = s4:option(Button, "start", translate("启动服务"))
	btn_start.inputtitle = translate("启动")
	btn_start.inputstyle = "apply"
	
	function btn_start.write(self, section)
		sys.call("/etc/init.d/multilogin start >/dev/null 2>&1")
		luci.http.redirect(luci.dispatcher.build_url("admin", "services", "multilogin", "status"))
	end
end

btn_clear_log = s4:option(Button, "clear_log", translate("清空日志"))
btn_clear_log.inputtitle = translate("清空")
btn_clear_log.inputstyle = "reset"

function btn_clear_log.write(self, section)
	sys.call("logread -c >/dev/null 2>&1")
	luci.http.redirect(luci.dispatcher.build_url("admin", "services", "multilogin", "status"))
end

return m

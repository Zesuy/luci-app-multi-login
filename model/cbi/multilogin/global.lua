local fs = require "nixio.fs"
local sys = require "luci.sys"

m = Map("multilogin", translate("全局设置"), 
	translate("配置多WAN登录的全局参数。修改后需要重启服务才能生效。"))

s = m:section(TypedSection, "settings", translate("基本设置"))
s.anonymous = true
s.addremove = false

-- 启用开关
enabled = s:option(Flag, "enabled", translate("启用多WAN登录"),
	translate("启用或禁用多WAN自动登录功能"))
enabled.rmempty = false
enabled.default = "1"

-- 日志级别
log_level = s:option(ListValue, "log_level", translate("日志级别"),
	translate("设置日志输出级别"))
log_level:value("debug", translate("调试 (Debug)"))
log_level:value("info", translate("信息 (Info)"))
log_level:value("notice", translate("通知 (Notice)"))
log_level:value("warning", translate("警告 (Warning)"))
log_level:value("error", translate("错误 (Error)"))
log_level.default = "info"

-- 重试间隔
retry_interval = s:option(Value, "retry_interval", translate("初始重试间隔"),
	translate("登录失败后的初始重试间隔（秒），失败后会指数增长"))
retry_interval.datatype = "uinteger"
retry_interval.default = "4"
retry_interval.placeholder = "4"

-- 检查间隔
check_interval = s:option(Value, "check_interval", translate("检查间隔"),
	translate("检查接口状态的间隔时间（秒）"))
check_interval.datatype = "uinteger"
check_interval.default = "5"
check_interval.placeholder = "5"

-- 最大重试延迟
max_retry_delay = s:option(Value, "max_retry_delay", translate("最大重试延迟"),
	translate("指数退避的最大延迟时间（秒）"))
max_retry_delay.datatype = "uinteger"
max_retry_delay.default = "16384"
max_retry_delay.placeholder = "16384"

-- 已登录延迟
already_logged_delay = s:option(Value, "already_logged_delay", translate("已登录状态延迟"),
	translate("当检测到已登录但接口仍离线时的延迟时间（秒）"))
already_logged_delay.datatype = "uinteger"
already_logged_delay.default = "16"
already_logged_delay.placeholder = "16"

-- 提交后重启服务
m.on_after_commit = function(self)
	luci.sys.call("/etc/init.d/multilogin restart >/dev/null 2>&1 &")
end

return m

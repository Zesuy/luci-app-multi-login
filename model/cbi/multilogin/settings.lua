-- /luci-app-multilogin/model/cbi/multilogin/settings.lua

local sys = require "luci.sys"

m = Map("multilogin", translate("自动登录管理"), 
    translate("为校园网管理多个WAN口的校园网自动登录，支持PC和移动端UA类型。本插件会借助mwan3自动监控接口状态并在离线时尝试登录。 配置教程见 'https://github.com/Zesuy/luci-app-multi-login'"))

-- 全局设置
s = m:section(TypedSection, "settings", translate("全局设置"))
s.anonymous = true
s.addremove = false

enabled = s:option(Flag, "enabled", translate("启用自动登录"), 
    translate("启用后，服务将在后台自动监控并登录配置的接口"))
enabled.rmempty = false

retry_interval = s:option(Value, "retry_interval", translate("初始重试间隔(秒)"), 
    translate("登录失败后的初始重试延迟，失败后会指数增长"))
retry_interval.datatype = "uinteger"
retry_interval.default = "4"

check_interval = s:option(Value, "check_interval", translate("状态检查间隔(秒)"), 
    translate("每隔多少秒检查一次mwan3接口状态"))
check_interval.datatype = "uinteger"
check_interval.default = "5"

max_retry_delay = s:option(Value, "max_retry_delay", translate("最大重试延迟(秒)"), 
    translate("重试延迟的最大值，防止无限增长"))
max_retry_delay.datatype = "uinteger"
max_retry_delay.default = "16384"

already_logged_delay = s:option(Value, "already_logged_delay", translate("已登录状态延迟(秒)"), 
    translate("当检测到已登录但接口离线时的重试延迟"))
already_logged_delay.datatype = "uinteger"
already_logged_delay.default = "16"

-- 登录实例配置
s4 = m:section(TypedSection, "instance", translate("登录实例配置"))
s4.anonymous = true
s4.addremove = true
s4.template = "cbi/tblsection"

inst_enabled = s4:option(Flag, "enabled", translate("启用"))
inst_enabled.rmempty = false

alias = s4:option(Value, "alias", translate("别名"), 
    translate("设置一个易于识别的名称"))
alias.placeholder = "PC登录1"

interface = s4:option(Value, "interface", translate("逻辑接口名"), 
    translate("逻辑接口名，如:wan"))
interface.placeholder = "wan"

username = s4:option(Value, "username", translate("账号"), 
    translate("校园网登录账号"))
username.placeholder = "your_account"

password = s4:option(Value, "password", translate("密码"), 
    translate("校园网登录密码"))
password.password = true
password.placeholder = "your_password"

ua_type = s4:option(ListValue, "ua_type", translate("UA类型"), 
    translate("选择登录时使用的User-Agent类型"))
ua_type:value("pc", "PC")
ua_type:value("mobile", "移动端")
ua_type.default = "pc"

-- 服务控制
s2 = m:section(TypedSection, "settings", translate("服务控制"))
s2.anonymous = true
s2.addremove = false

local pid = luci.sys.exec("pgrep -f '/etc/multilogin/login_control.bash'")

if pid ~= "" then
    status = s2:option(DummyValue, "_status", translate("服务状态"))
    status.value = translate("运行中 (PID: " .. pid:gsub("%s+", "") .. ")")
    
    stop_btn = s2:option(Button, "_stop", translate("停止服务"))
    stop_btn.inputstyle = "reset"
    function stop_btn.write()
        luci.sys.call("pgrep -f '/etc/multilogin/login_control.bash' | xargs kill -TERM 2>/dev/null")
        luci.sys.call("sleep 1")
        luci.http.redirect(luci.dispatcher.build_url("admin", "services", "multilogin", "settings"))
    end
    
    restart_btn = s2:option(Button, "_restart", translate("重启服务"))
    restart_btn.inputstyle = "apply"
    function restart_btn.write()
        luci.sys.call("pgrep -f '/etc/multilogin/login_control.bash' | xargs kill -TERM 2>/dev/null")
        luci.sys.call("sleep 1")
        luci.sys.call("/etc/init.d/multilogin start &")
        luci.http.redirect(luci.dispatcher.build_url("admin", "services", "multilogin", "settings"))
    end
else
    status = s2:option(DummyValue, "_status", translate("服务状态"))
    status.value = translate("未运行")
    
    local uci = luci.model.uci.cursor()
    local global_enabled = uci:get_first("multilogin", "settings", "enabled")

    if global_enabled == "1" then
        start_btn = s2:option(Button, "_start", translate("启动服务"))
        start_btn.inputstyle = "apply"
        function start_btn.write()
            luci.sys.call("/etc/init.d/multilogin start &")
            luci.sys.call("sleep 1")
            luci.http.redirect(luci.dispatcher.build_url("admin", "services", "multilogin", "settings"))
        end
    end
end

m.on_commit = function(self)
    local cursor = luci.model.uci.cursor()
    local global_enabled = cursor:get_first("multilogin", "settings", "enabled") == "1"

    if not global_enabled then
        luci.sys.call("/etc/init.d/multilogin stop >/dev/null 2>&1 &")
        return true
    end

    luci.sys.call("/etc/init.d/multilogin restart >/dev/null 2>&1 &")
    return true
end

return m

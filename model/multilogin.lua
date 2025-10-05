local fs = require "nixio.fs"
local sys = require "luci.sys"

m = Map("multilogin", translate("多拨自动登录管理"), 
    translate("管理多个WAN口的校园网自动登录，支持PC和移动端UA类型。本插件会自动监控接口状态并在离线时尝试登录。"))

s = m:section(TypedSection, "settings", translate("全局设置"))
s.anonymous = true
s.addremove = false

-- 全局启用/禁用开关
enabled = s:option(Flag, "enabled", translate("启用多拨登录"), 
    translate("启用后，服务将在后台自动监控并登录配置的接口"))
enabled.rmempty = false

-- 日志级别
log_level = s:option(ListValue, "log_level", translate("日志级别"))
log_level:value("debug", "调试(Debug)")
log_level:value("info", "信息(Info)")
log_level:value("warning", "警告(Warning)")
log_level:value("error", "错误(Error)")
log_level.default = "info"

-- 重试间隔
retry_interval = s:option(Value, "retry_interval", translate("初始重试间隔(秒)"), 
    translate("登录失败后的初始重试延迟，失败后会指数增长"))
retry_interval.datatype = "uinteger"
retry_interval.default = "4"

-- 检查间隔
check_interval = s:option(Value, "check_interval", translate("状态检查间隔(秒)"), 
    translate("每隔多少秒检查一次mwan3接口状态"))
check_interval.datatype = "uinteger"
check_interval.default = "5"

-- 最大重试延迟
max_retry_delay = s:option(Value, "max_retry_delay", translate("最大重试延迟(秒)"), 
    translate("重试延迟的最大值，防止无限增长"))
max_retry_delay.datatype = "uinteger"
max_retry_delay.default = "16384"

-- 已登录延迟
already_logged_delay = s:option(Value, "already_logged_delay", translate("已登录状态延迟(秒)"), 
    translate("当检测到已登录但接口离线时的重试延迟"))
already_logged_delay.datatype = "uinteger"
already_logged_delay.default = "16"

-- 服务控制部分
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
        luci.http.redirect(luci.dispatcher.build_url("admin", "services", "multilogin"))
    end
    
    restart_btn = s2:option(Button, "_restart", translate("重启服务"))
    restart_btn.inputstyle = "apply"
    function restart_btn.write()
        luci.sys.call("pgrep -f '/etc/multilogin/login_control.bash' | xargs kill -TERM 2>/dev/null")
        luci.sys.call("sleep 1")
        luci.sys.call("/etc/init.d/multilogin start &")
        luci.http.redirect(luci.dispatcher.build_url("admin", "services", "multilogin"))
    end
else
    status = s2:option(DummyValue, "_status", translate("服务状态"))
    status.value = translate("未运行")
    
    start_btn = s2:option(Button, "_start", translate("启动服务"))
    start_btn.inputstyle = "apply"
    function start_btn.write()
        luci.sys.call("/etc/init.d/multilogin start &")
        luci.sys.call("sleep 1")
        luci.http.redirect(luci.dispatcher.build_url("admin", "services", "multilogin"))
    end
end

-- Login.sh 编辑器
s3 = m:section(TypedSection, "settings", translate("登录脚本编辑"))
s3.anonymous = true
s3.addremove = false

login_script = s3:option(TextValue, "_login_script", translate("login.sh 脚本内容"), 
    translate("编辑登录脚本。此脚本负责执行实际的登录操作。修改后请保存并重启服务。"))
login_script.rows = 25
login_script.wrap = "off"
login_script.template = "cbi/tvalue"

function login_script.cfgvalue()
    return fs.readfile("/etc/multilogin/login.sh") or ""
end

function login_script.write(self, section, value)
    if value then
        value = value:gsub("\r\n?", "\n")
        fs.writefile("/tmp/login.sh", value)
        if (luci.sys.call("cmp -s /tmp/login.sh /etc/multilogin/login.sh") == 1) then
            fs.writefile("/etc/multilogin/login.sh", value)
            luci.sys.call("chmod +x /etc/multilogin/login.sh")
        end
        fs.remove("/tmp/login.sh")
    end
end

-- 登录实例配置
s4 = m:section(TypedSection, "instance", translate("登录实例配置"))
s4.anonymous = true
s4.addremove = true
s4.template = "cbi/tblsection"

-- 启用/禁用
inst_enabled = s4:option(Flag, "enabled", translate("启用"))
inst_enabled.rmempty = false

-- 别名
alias = s4:option(Value, "alias", translate("别名"), 
    translate("为此登录实例设置一个易于识别的名称"))
alias.placeholder = "PC登录1"

-- 接口名
interface = s4:option(Value, "interface", translate("逻辑接口名"), 
    translate("mwan3中的逻辑接口名，如: wan, wan2, wan3"))
interface.placeholder = "wan"

-- 用户名
username = s4:option(Value, "username", translate("账号"), 
    translate("校园网登录账号"))
username.placeholder = "your_account"

-- 密码
password = s4:option(Value, "password", translate("密码"), 
    translate("校园网登录密码"))
password.password = true
password.placeholder = "your_password"

-- UA类型
ua_type = s4:option(ListValue, "ua_type", translate("UA类型"), 
    translate("选择登录时使用的User-Agent类型"))
ua_type:value("pc", "PC")
ua_type:value("mobile", "移动端")
ua_type.default = "pc"

-- 当配置改变时重启服务
m.on_commit = function(self)
    luci.sys.call("/etc/init.d/multilogin restart")
end

return m

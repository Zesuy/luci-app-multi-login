-- /luci-app-multilogin/model/cbi/multilogin/log.lua

local fs = require "nixio.fs"

m = Map("multilogin", translate("日志"), 
    translate("这里显示 `login_control.bash` 和 `login.sh` 的实时日志。"))

-- 注入样式：放大日志窗口并统一宽度
do
    local css = m:section(SimpleSection)
    css.template = "multilogin/common_style"
end

s = m:section(TypedSection, "settings", "")
s.anonymous = true
s.addremove = false

-- 日志级别设置
log_level = s:option(ListValue, "log_level", translate("日志级别"),
    translate("调整脚本输出的日志详细程度。修改后会自动重启服务。"))
log_level:value("debug", "调试(Debug)")
log_level:value("info", "信息(Info)")
log_level:value("warning", "警告(Warning)")
log_level:value("error", "错误(Error)")
log_level.default = "info"
function log_level.write(self, section, value)
    -- 写入配置
    local uci = luci.model.uci.cursor()
    uci:set("multilogin", "global", "log_level", value)
    uci:save("multilogin")
    uci:commit("multilogin")
    -- 重启服务以应用
    luci.sys.call("/etc/init.d/multilogin restart >/dev/null 2>&1 &")
end

-- 日志内容显示
log = s:option(TextValue, "_log", translate("日志内容"))
log.readonly = true
log.rows = 50
log.cols = 100
log.wrap = "off"
log.template = "cbi/tvalue"
log.monospace = true

function log.cfgvalue()
    return fs.readfile("/var/log/multilogin.log") or translate("还没有日志文件。请启动服务以生成日志。")
end

-- 添加一个按钮来清除日志
clear_log_btn = s:option(Button, "_clear_log", translate("清除日志"))
clear_log_btn.inputstyle = "reset"
function clear_log_btn.write()
    fs.writefile("/var/log/multilogin.log", "")
    luci.http.redirect(luci.dispatcher.build_url("admin", "services", "multilogin", "log"))
end

return m

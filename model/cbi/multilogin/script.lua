-- /luci-app-multilogin/model/cbi/multilogin/script.lua

local fs = require "nixio.fs"
local sys = require "luci.sys"

m = Map("multilogin", translate("登录脚本编辑"), 
    translate("在这里编辑 `login.sh` 脚本。这个脚本负责执行实际的登录操作,可以适当修改模板以适应不同校区。修改后请保存。服务将在保存后自动重启以应用更改。"))

-- 注入样式：放大编辑窗口并统一宽度
do
    local css = m:section(SimpleSection)
    css.template = "multilogin/common_style"
end

s = m:section(TypedSection, "settings", "")
s.anonymous = true
s.addremove = false

login_script = s:option(TextValue, "_login_script", translate("`login.sh` 脚本内容"))
login_script.rows = 40
login_script.cols = 100
login_script.wrap = "off"
login_script.template = "cbi/tvalue"
login_script.monospace = true

function login_script.cfgvalue()
    return fs.readfile("/etc/multilogin/login.sh") or ""
end

function login_script.write(self, section, value)
    if value then
        value = value:gsub("\r\n?", "\n")
        -- 比较文件内容，仅在有变动时写入
        local current_content = fs.readfile("/etc/multilogin/login.sh") or ""
        if value ~= current_content then
            fs.writefile("/etc/multilogin/login.sh", value)
            sys.call("chmod +x /etc/multilogin/login.sh")
            -- 脚本修改后重启服务
            sys.call("/etc/init.d/multilogin restart >/dev/null 2>&1 &")
        end
    end
end

return m

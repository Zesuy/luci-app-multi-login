local fs = require "nixio.fs"
local sys = require "luci.sys"

m = SimpleForm("scripts", translate("脚本编辑"), 
	translate("编辑控制脚本和登录脚本。修改后请保存，控制脚本修改后会自动重启服务。"))

m.reset = false
m.submit = translate("保存")

-- login_control.bash 编辑
s1 = m:section(SimpleSection)
s1.title = translate("控制脚本 (login_control.bash)")
s1.description = translate("主控制脚本，负责监控接口状态并调用登录脚本。修改后会自动重启服务。")

control_script = s1:option(TextValue, "control_script")
control_script.rows = 25
control_script.wrap = "off"
control_script.rmempty = true

function control_script.cfgvalue(self, section)
	return fs.readfile("/usr/bin/login_control") or ""
end

function control_script.write(self, section, value)
	if value then
		value = value:gsub("\r\n?", "\n")
		fs.writefile("/tmp/login_control.tmp", value)
		if luci.sys.call("cmp -s /tmp/login_control.tmp /usr/bin/login_control") == 1 then
			fs.writefile("/usr/bin/login_control", value)
			fs.chmod("/usr/bin/login_control", 755)
			luci.sys.call("/etc/init.d/multilogin restart >/dev/null 2>&1 &")
		end
		fs.remove("/tmp/login_control.tmp")
	end
end

-- login.sh 编辑
s2 = m:section(SimpleSection)
s2.title = translate("登录脚本 (login.sh)")
s2.description = translate("实际执行登录操作的脚本。请确保脚本返回正确的退出码：0=成功，1=失败，2=已登录。")

login_script = s2:option(TextValue, "login_script")
login_script.rows = 25
login_script.wrap = "off"
login_script.rmempty = true

function login_script.cfgvalue(self, section)
	local script_path = "/etc/multilogin/login.sh"
	return fs.readfile(script_path) or ""
end

function login_script.write(self, section, value)
	if value then
		value = value:gsub("\r\n?", "\n")
		local script_path = "/etc/multilogin/login.sh"
		
		-- 确保目录存在
		luci.sys.call("mkdir -p /etc/multilogin")
		
		fs.writefile("/tmp/login.sh.tmp", value)
		if luci.sys.call("cmp -s /tmp/login.sh.tmp " .. script_path) == 1 then
			fs.writefile(script_path, value)
			fs.chmod(script_path, 755)
		end
		fs.remove("/tmp/login.sh.tmp")
	end
end

return m

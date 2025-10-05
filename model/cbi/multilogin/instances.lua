local fs = require "nixio.fs"
local sys = require "luci.sys"
local util = require "luci.util"

m = Map("multilogin", translate("登录实例管理"), 
	translate("配置多个WAN接口的登录实例。每个实例对应一个逻辑接口，可以配置不同的账号和登录类型。"))

s = m:section(TypedSection, "instance", translate("登录实例列表"))
s.anonymous = true
s.addremove = true
s.template = "cbi/tblsection"

-- 启用开关
enabled = s:option(Flag, "enabled", translate("启用"))
enabled.rmempty = false
enabled.default = "1"

-- 别名
alias = s:option(Value, "alias", translate("别名"),
	translate("为该实例设置一个易于识别的名称"))
alias.placeholder = "例如: PC登录1"

-- 逻辑接口
interface = s:option(Value, "interface", translate("逻辑接口"),
	translate("对应的 MWAN3 逻辑接口名称，如: wan, wan2, wan3"))
interface.placeholder = "wan"

-- 动态获取 mwan3 接口列表
local mwan3_interfaces = {}
if fs.access("/etc/config/mwan3") then
	local uci = require "luci.model.uci".cursor()
	uci:foreach("mwan3", "interface", function(s)
		if s[".name"] and s[".name"] ~= "loopback" then
			table.insert(mwan3_interfaces, s[".name"])
		end
	end)
end

-- 如果有 mwan3 接口，添加到下拉列表
if #mwan3_interfaces > 0 then
	interface.widget = "select"
	interface:value("", translate("-- 请选择 --"))
	for _, iface in ipairs(mwan3_interfaces) do
		interface:value(iface, iface)
	end
end

-- 用户名
username = s:option(Value, "username", translate("用户名"),
	translate("校园网登录账号"))
username.placeholder = "学号或账号"

-- 密码
password = s:option(Value, "password", translate("密码"),
	translate("校园网登录密码"))
password.password = true
password.placeholder = "******"

-- UA类型
ua_type = s:option(ListValue, "ua_type", translate("登录类型"),
	translate("选择登录时使用的设备类型"))
ua_type:value("pc", translate("PC端"))
ua_type:value("mobile", translate("移动端"))
ua_type.default = "pc"

-- 验证函数
function interface.validate(self, value, section)
	if not value or value == "" then
		return nil, translate("接口名称不能为空")
	end
	return value
end

function username.validate(self, value, section)
	if not value or value == "" then
		return nil, translate("用户名不能为空")
	end
	return value
end

function password.validate(self, value, section)
	if not value or value == "" then
		return nil, translate("密码不能为空")
	end
	return value
end

-- 提交后重启服务
m.on_after_commit = function(self)
	luci.sys.call("/etc/init.d/multilogin restart >/dev/null 2>&1 &")
end

return m

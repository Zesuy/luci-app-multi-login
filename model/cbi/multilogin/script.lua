-- /luci-app-multilogin/model/cbi/multilogin/script.lua

local fs = require "nixio.fs"
local sys = require "luci.sys"

m = Map("multilogin", translate("登录脚本编辑"), 
    translate("在这里编辑 `login.sh` 脚本。这个脚本负责执行实际的登录操作,可以适当修改模板以适应不同校区。修改后请保存。服务将在保存后自动重启以应用更改。"))

-- 脚本模板切换section
s_template = m:section(TypedSection, "settings", translate("脚本模板切换"))
s_template.anonymous = true
s_template.addremove = false

-- 显示当前使用的模板
function detect_current_template()
    -- 使用 cmp 命令比较文件，更可靠
    if sys.call("cmp -s /etc/multilogin/login.sh /etc/multilogin/login_huxi.sh") == 0 then
        return translate("虎溪模板 (login_huxi.sh) - 创建者: Zesuy")
    elseif sys.call("cmp -s /etc/multilogin/login.sh /etc/multilogin/login_A.sh") == 0 then
        return translate("A区模板 (login_A.sh) - 创建者: L-1124")
    else
        return translate("自定义脚本")
    end
end

current_template = s_template:option(DummyValue, "_current_template", translate("当前模板"))
current_template.value = detect_current_template()

template_select = s_template:option(ListValue, "_template_type", translate("选择模板"), 
    translate("选择预设的登录脚本模板，点击应用后将替换当前的 login.sh"))
template_select:value("current", translate("当前脚本"))
template_select:value("huxi", translate("虎溪模板 (login_huxi.sh) - 创建者: Zesuy"))
template_select:value("login_a", translate("A区模板 (login_A.sh) - 创建者: L-1124"))
template_select.default = "current"

apply_template = s_template:option(Button, "_apply_template", translate("应用选择的模板"))
apply_template.inputstyle = "apply"

-- 添加JavaScript确认对话框
apply_template.onclick = "return confirm('" .. translate("确认要替换当前脚本吗？此操作将覆盖 login.sh 文件的内容！") .. "')"

function apply_template.write(self, section)
    local template_type = template_select:formvalue(section)
    if template_type and template_type ~= "current" then
        local source_file
        if template_type == "huxi" then
            source_file = "/etc/multilogin/login_huxi.sh"
        elseif template_type == "login_a" then
            source_file = "/etc/multilogin/login_A.sh"
        else
            m.message = translate("错误：未知的模板类型: ") .. template_type
            return
        end
        
        local target_file = "/etc/multilogin/login.sh"
        
        if fs.access(source_file) then
            local content = fs.readfile(source_file)
            if content then
                -- 参考 nettask.lua，使用临时文件方式写入
                -- 先清空目标文件，然后写入新内容
                fs.writefile("/tmp/login_temp.sh", content)
                -- 使用 cp 命令强制覆盖
                sys.call("cp -f /tmp/login_temp.sh " .. target_file)
                sys.call("chmod +x " .. target_file)
                fs.remove("/tmp/login_temp.sh")
                -- 应用模板后重启服务
                sys.call("/etc/init.d/multilogin restart >/dev/null 2>&1 &")
                -- 显示成功消息并刷新页面
                luci.http.redirect(luci.dispatcher.build_url("admin", "services", "multilogin", "script") .. "?applied=" .. template_type)
            else
                -- 文件读取失败
                m.message = translate("错误：无法读取模板文件内容")
            end
        else
            -- 文件不存在
            m.message = translate("错误：模板文件不存在: ") .. source_file
        end
    end
end

s = m:section(TypedSection, "settings", translate("脚本内容编辑"))
s.anonymous = true
s.addremove = false

login_script = s:option(TextValue, "_login_script", "")
login_script.rows = 30
login_script.wrap = "off"
login_script.template = "cbi/tvalue"
login_script.monospace = true

function login_script.cfgvalue()
    return fs.readfile("/etc/multilogin/login.sh") or ""
end

function login_script.write(self, section, value)
    -- 检查是否正在应用模板，如果是则跳过手动编辑的写入
    -- 避免模板应用后被手动编辑框的旧内容覆盖
    local template_type = template_select:formvalue(section)
    if template_type and template_type ~= "current" then
        -- 正在应用模板，跳过手动编辑框的写入
        return
    end
    
    if value then
        value = value:gsub("\r\n?", "\n")
        -- 参考 nettask.lua，使用临时文件方式比较和写入
        fs.writefile("/tmp/login.sh", value)
        if (sys.call("cmp -s /tmp/login.sh /etc/multilogin/login.sh") == 1) then
            -- 文件内容不同，使用 cp 命令强制覆盖
            sys.call("cp -f /tmp/login.sh /etc/multilogin/login.sh")
            sys.call("chmod +x /etc/multilogin/login.sh")
            -- 脚本修改后重启服务
            sys.call("/etc/init.d/multilogin restart >/dev/null 2>&1 &")
        end
        fs.remove("/tmp/login.sh")
    end
end

-- 处理模板应用成功消息
local applied_template = luci.http.formvalue("applied")
if applied_template then
    local template_names = {
        huxi = translate("虎溪模板 (创建者: Zesuy)"),
        login_a = translate("A区模板 (创建者: L-1124)")
    }
    m.message = translate("成功！已应用 ") .. (template_names[applied_template] or applied_template) .. translate(" 并重启服务。")
end

return m

module("luci.controller.MultiLogin", package.seeall)

function index()
    entry({"admin", "services", "multilogin"}, cbi("multilogin"), _("多拨登录"), 60).dependent = false
end

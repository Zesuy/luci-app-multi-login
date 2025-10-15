include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-multilogin
PKG_VERSION:=1.1.0
PKG_RELEASE:=1

PKG_BUILD_DIR:=$(BUILD_DIR)/$(PKG_NAME)

include $(INCLUDE_DIR)/package.mk

define Package/luci-app-multilogin
	SECTION:=luci
	CATEGORY:=LuCI
	SUBMENU:=3. Applications
	TITLE:=Multi-WAN Auto Login Manager
	PKGARCH:=all
	DEPENDS:=+mwan3 +curl +bash +luci-compat +luci-app-mwan3
endef

define Package/luci-app-multilogin/description
	LuCI support for managing multiple WAN campus network auto-login.
	Supports both PC and mobile User-Agent types.
endef

define Build/Prepare
endef

define Build/Configure
endef

define Build/Compile
endef

define Package/luci-app-multilogin/install
	$(INSTALL_DIR) $(1)/usr/lib/lua/luci/controller
	$(INSTALL_DIR) $(1)/usr/lib/lua/luci/model/cbi/multilogin
	$(INSTALL_DIR) $(1)/etc/config
	$(INSTALL_DIR) $(1)/etc/init.d
	$(INSTALL_DIR) $(1)/etc/multilogin
	
	$(INSTALL_DATA) ./controller/MultiLogin.lua $(1)/usr/lib/lua/luci/controller/
	$(INSTALL_DATA) ./model/cbi/multilogin/settings.lua $(1)/usr/lib/lua/luci/model/cbi/multilogin/
	$(INSTALL_DATA) ./model/cbi/multilogin/script.lua $(1)/usr/lib/lua/luci/model/cbi/multilogin/
	$(INSTALL_DATA) ./model/cbi/multilogin/log.lua $(1)/usr/lib/lua/luci/model/cbi/multilogin/
	$(INSTALL_CONF) ./etc/config/multilogin $(1)/etc/config/
	$(INSTALL_BIN) ./etc/init.d/multilogin $(1)/etc/init.d/
	$(INSTALL_BIN) ./etc/multilogin/login_control.bash $(1)/etc/multilogin/
	$(INSTALL_BIN) ./etc/multilogin/login.sh $(1)/etc/multilogin/
	$(INSTALL_BIN) ./etc/multilogin/login_huxi.sh $(1)/etc/multilogin/
	$(INSTALL_BIN) ./etc/multilogin/login_A.sh $(1)/etc/multilogin/
endef

define Package/luci-app-multilogin/postinst
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] || {
	/etc/init.d/multilogin enable
	/etc/init.d/rpcd restart
}
exit 0
endef

define Package/luci-app-multilogin/prerm
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] || {
	/etc/init.d/multilogin stop
	/etc/init.d/multilogin disable
}
exit 0
endef

$(eval $(call BuildPackage,luci-app-multilogin))

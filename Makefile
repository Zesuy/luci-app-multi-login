include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-multilogin
PKG_VERSION:=1.0.0
PKG_RELEASE:=1

PKG_BUILD_DIR:=$(BUILD_DIR)/$(PKG_NAME)

include $(INCLUDE_DIR)/package.mk

define Package/luci-app-multilogin
	SECTION:=luci
	CATEGORY:=LuCI
	SUBMENU:=3. Applications
	TITLE:=Multi-WAN Login Manager
	PKGARCH:=all
	DEPENDS:=+mwan3
endef

define Package/luci-app-multilogin/description
	LuCI interface for managing multiple WAN login instances.
	Automatically login to campus network for multiple WAN interfaces.
endef

define Build/Prepare
endef

define Build/Configure
endef

define Build/Compile
endef

define Package/luci-app-multilogin/install
	$(INSTALL_DIR) $(1)/usr/lib/lua/luci/controller/
	$(INSTALL_DIR) $(1)/usr/lib/lua/luci/model/cbi/multilogin/
	$(INSTALL_DIR) $(1)/etc/config/
	$(INSTALL_DIR) $(1)/etc/init.d/
	$(INSTALL_DIR) $(1)/etc/multilogin/
	$(INSTALL_DIR) $(1)/usr/bin/
	
	$(INSTALL_BIN) ./controller/multilogin.lua $(1)/usr/lib/lua/luci/controller/
	$(INSTALL_DATA) ./model/cbi/multilogin/*.lua $(1)/usr/lib/lua/luci/model/cbi/multilogin/
	$(INSTALL_CONF) ./etc/config/multilogin $(1)/etc/config/multilogin
	$(INSTALL_BIN) ./etc/init.d/multilogin $(1)/etc/init.d/multilogin
	$(INSTALL_BIN) ./etc/multilogin/login_control.bash $(1)/usr/bin/login_control
	$(INSTALL_BIN) ./etc/multilogin/login.sh $(1)/etc/multilogin/login.sh
endef

$(eval $(call BuildPackage,luci-app-multilogin))

include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-multilogin
# Keep the release/tag SemVer separate from APK's Alpine version spelling.
# IPK accepts 3.0.0-rc.1; APK v3 requires the equivalent 3.0.0_rc1.
PKG_SOURCE_VERSION:=3.0.0-rc.1
PKG_APK_VERSION:=3.0.0_rc1
ifeq ($(CONFIG_USE_APK),y)
PKG_VERSION:=$(PKG_APK_VERSION)
else
PKG_VERSION:=$(PKG_SOURCE_VERSION)
endif
PKG_RELEASE:=1

PKG_BUILD_DIR:=$(BUILD_DIR)/$(PKG_NAME)

include $(INCLUDE_DIR)/package.mk

define Package/luci-app-multilogin
	SECTION:=luci
	CATEGORY:=LuCI
	SUBMENU:=3. Applications
	TITLE:=Multi-WAN Auto Login Manager
	PKGARCH:=all
	DEPENDS:=+curl +bash +mwan3 +jsonfilter +luci-base
endef

define Package/luci-app-multilogin/description
	LuCI support for managing multiple WAN campus network auto-login.
	Supports both PC and mobile User-Agent types.
endef

define Package/luci-app-multilogin/conffiles
/etc/config/multilogin
endef

define Build/Prepare
endef

define Build/Configure
endef

define Build/Compile
endef

define Package/luci-app-multilogin/install
	$(INSTALL_DIR) $(1)/usr/share/luci/menu.d
	$(INSTALL_DIR) $(1)/usr/share/rpcd/acl.d
	$(INSTALL_DIR) $(1)/usr/libexec/rpcd
	$(INSTALL_DIR) $(1)/www/luci-static/resources/view/multilogin
	$(INSTALL_DIR) $(1)/etc/config
	$(INSTALL_DIR) $(1)/etc/init.d
	$(INSTALL_DIR) $(1)/etc/multilogin
	$(INSTALL_DIR) $(1)/usr/lib/multilogin
	
	$(INSTALL_DATA) ./root/usr/share/luci/menu.d/luci-app-multi-login.json $(1)/usr/share/luci/menu.d/
	$(INSTALL_DATA) ./root/usr/share/rpcd/acl.d/luci-app-multi-login.json $(1)/usr/share/rpcd/acl.d/
	$(INSTALL_BIN) ./root/usr/libexec/rpcd/multilogin $(1)/usr/libexec/rpcd/
	$(INSTALL_BIN) ./root/usr/libexec/multilogin-script $(1)/usr/libexec/
	$(INSTALL_BIN) ./root/usr/libexec/multilogin-config $(1)/usr/libexec/
	$(INSTALL_DATA) ./root/usr/lib/multilogin/script-policy.sh $(1)/usr/lib/multilogin/
	$(INSTALL_DATA) ./root/usr/lib/multilogin/config-policy.sh $(1)/usr/lib/multilogin/
	$(INSTALL_DATA) ./htdocs/luci-static/resources/view/multilogin/* $(1)/www/luci-static/resources/view/multilogin/
	$(INSTALL_CONF) ./etc/config/multilogin $(1)/etc/config/
	$(INSTALL_BIN) ./etc/init.d/multilogin $(1)/etc/init.d/
	$(INSTALL_BIN) ./etc/multilogin/login_control.bash $(1)/etc/multilogin/
	$(INSTALL_BIN) ./etc/multilogin/login.sh $(1)/etc/multilogin/
	$(INSTALL_BIN) ./etc/multilogin/check_status.sh $(1)/etc/multilogin/
	$(INSTALL_BIN) ./etc/multilogin/logout.sh $(1)/etc/multilogin/
	$(INSTALL_BIN) ./etc/multilogin/quick_setup.sh $(1)/etc/multilogin/
	$(INSTALL_BIN) ./etc/multilogin/cqu-portal.sh $(1)/usr/lib/multilogin/cqu-portal.factory.sh
endef

define Package/luci-app-multilogin/preinst
#!/bin/sh
ML_MIGRATION_EMBEDDED=1
$(file <$(CURDIR)/package/multilogin-migrate.sh)
$(file <$(CURDIR)/package/hooks/preinst.sh)
endef

define Package/luci-app-multilogin/postinst
#!/bin/sh
ML_MIGRATION_EMBEDDED=1
$(file <$(CURDIR)/package/multilogin-migrate.sh)
$(file <$(CURDIR)/package/hooks/postinst.sh)
endef

define Package/luci-app-multilogin/prerm
#!/bin/sh
ML_MIGRATION_EMBEDDED=1
$(file <$(CURDIR)/package/multilogin-migrate.sh)
$(file <$(CURDIR)/package/hooks/prerm.sh)
endef

define Package/luci-app-multilogin/postrm
#!/bin/sh
ML_MIGRATION_EMBEDDED=1
$(file <$(CURDIR)/package/multilogin-migrate.sh)
$(file <$(CURDIR)/package/hooks/postrm.sh)
endef

$(eval $(call BuildPackage,luci-app-multilogin))

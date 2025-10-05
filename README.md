# LuCI App Multi-Login

OpenWrt 多WAN口自动登录管理插件

## 功能特性

- 🌐 支持多个 WAN 接口独立配置登录
- 🔄 自动检测接口状态，离线时自动重新登录
- 📊 实时监控服务运行状态和接口状态
- ⚙️ 友好的 Web 界面配置
- 📝 支持在线编辑控制脚本和登录脚本
- 🔐 支持 PC 端和移动端两种登录类型
- 📈 智能指数退避重试机制
- 📋 详细的日志记录

## 系统要求

- OpenWrt 系统
- mwan3 软件包（必须）
- LuCI Web 界面

## 目录结构

```
luci-app-multilogin/
├── Makefile                        # 编译配置文件
├── controller/
│   └── multilogin.lua             # LuCI 控制器
├── model/
│   └── cbi/
│       └── multilogin/
│           ├── status.lua         # 运行状态页面
│           ├── global.lua         # 全局设置页面
│           ├── instances.lua      # 登录实例管理页面
│           └── scripts.lua        # 脚本编辑页面
└── etc/
    ├── config/
    │   └── multilogin            # UCI 配置文件
    ├── init.d/
    │   └── multilogin            # 服务启动脚本
    └── multilogin/
        ├── login_control.bash    # 主控制脚本
        └── login.sh              # 登录执行脚本
```

## 安装方法

### 方法 1: 从源码编译

1. 将此目录复制到 OpenWrt SDK 的 `package/luci-app-multilogin/` 目录
2. 在 SDK 根目录执行：
   ```bash
   make package/luci-app-multilogin/compile V=s
   ```
3. 编译完成后，在 `bin/packages/` 目录下找到 ipk 安装包
4. 上传到路由器并安装：
   ```bash
   opkg install luci-app-multilogin_*.ipk
   ```

### 方法 2: 直接安装（开发测试）

1. 将整个 `luci-app-multilogin` 目录上传到路由器
2. 手动复制文件到对应位置：
   ```bash
   # 复制 controller
   cp controller/multilogin.lua /usr/lib/lua/luci/controller/
   
   # 复制 model
   mkdir -p /usr/lib/lua/luci/model/cbi/multilogin
   cp model/cbi/multilogin/*.lua /usr/lib/lua/luci/model/cbi/multilogin/
   
   # 复制配置文件
   cp etc/config/multilogin /etc/config/
   
   # 复制 init 脚本
   cp etc/init.d/multilogin /etc/init.d/
   chmod +x /etc/init.d/multilogin
   
   # 复制脚本文件
   mkdir -p /etc/multilogin
   cp etc/multilogin/login_control.bash /usr/bin/login_control
   cp etc/multilogin/login.sh /etc/multilogin/
   chmod +x /usr/bin/login_control
   chmod +x /etc/multilogin/login.sh
   ```

3. 重启 LuCI：
   ```bash
   /etc/init.d/uhttpd restart
   ```

## 使用说明

### 1. 访问 Web 界面

安装后，在 LuCI 界面的 "服务" -> "多WAN登录" 菜单中进行配置。

### 2. 配置步骤

#### 2.1 全局设置
- 启用/禁用多WAN登录功能
- 配置日志级别
- 配置重试间隔和延迟参数

#### 2.2 添加登录实例
1. 进入 "登录实例" 页面
2. 点击 "添加" 按钮
3. 填写以下信息：
   - **别名**: 为实例设置易识别的名称
   - **逻辑接口**: 选择对应的 MWAN3 接口（如 wan, wan2, wan3）
   - **用户名**: 校园网账号
   - **密码**: 校园网密码
   - **登录类型**: 选择 PC端 或 移动端
4. 保存配置

#### 2.3 准备登录脚本
1. 将您的 `login.sh` 脚本放到 `/etc/multilogin/` 目录
2. 或者在 "脚本编辑" 页面直接编辑 `login.sh` 登录脚本
3. 确保脚本支持以下参数：
   - `--mwan3`: 逻辑接口名
   - `--account`: 账号
   - `--password`: 密码
   - `--ua-type`: 登录类型 (pc/mobile)
4. 确保脚本返回正确的退出码：
   - `0`: 登录成功
   - `1`: 登录失败
   - `2`: 已登录状态
5. 确保脚本有执行权限：`chmod +x /etc/multilogin/login.sh`

#### 2.4 启动服务
1. 进入 "运行状态" 页面
2. 点击 "启动" 按钮
3. 查看服务状态和日志

### 3. 监控运行状态

在 "运行状态" 页面可以看到：
- 服务运行状态（运行中/未运行）
- 配置的实例数量
- MWAN3 接口状态
- 最近的运行日志

## UCI 配置示例

```
# /etc/config/multilogin

config settings 'global'
	option enabled '1'
	option log_level 'info'
	option retry_interval '4'
	option check_interval '5'
	option max_retry_delay '16384'
	option already_logged_delay '16'

config instance 'pc1'
	option enabled '1'
	option alias 'PC登录1'
	option username 'your_account'
	option password 'your_password'
	option ua_type 'pc'
	option interface 'wan'

config instance 'mobile1'
	option enabled '1'
	option alias '移动端登录'
	option username 'your_account'
	option password 'your_password'
	option ua_type 'mobile'
	option interface 'wan2'
```

## 工作原理

1. **主控制脚本** (`login_control.bash`) 作为守护进程运行
2. 定期检查配置的 MWAN3 接口状态
3. 当检测到接口离线时，调用登录脚本尝试登录
4. 采用智能指数退避策略：
   - 登录成功：重置延迟为初始值
   - 登录失败：延迟时间翻倍（最大不超过配置值）
   - 已登录状态：使用固定延迟
5. 所有操作都记录到系统日志

## 故障排除

### 服务无法启动
1. 检查 mwan3 是否已安装：`opkg list-installed | grep mwan3`
2. 检查配置文件是否存在：`cat /etc/config/multilogin`
3. 查看日志：`logread | grep multi_login`

### 接口登录失败
1. 检查登录脚本是否存在：`ls -l /etc/multilogin/login.sh`
2. 手动测试登录脚本：
   ```bash
   /etc/multilogin/login.sh --mwan3 wan --account test --password test --ua-type pc
   echo $?  # 查看返回码
   ```
3. 查看详细日志（调整日志级别为 debug）

### Web 界面无法访问
1. 重启 LuCI：`/etc/init.d/uhttpd restart`
2. 清除浏览器缓存
3. 检查文件权限

## 开发者信息

### 主要文件说明

- **controller/multilogin.lua**: 定义 LuCI 路由和菜单结构
- **model/cbi/multilogin/*.lua**: CBI 模型文件，定义各个配置页面
- **etc/init.d/multilogin**: 使用 procd 管理服务生命周期
- **etc/multilogin/login_control.bash**: 核心控制逻辑，负责接口监控和登录调度
- **etc/multilogin/login.sh**: 实际执行登录操作的脚本（需要根据校园网接口自定义）

### 自定义登录脚本

登录脚本需要接收以下参数：
```bash
--mwan3 <interface>   # MWAN3 逻辑接口名
--account <username>  # 登录账号
--password <pass>     # 登录密码
--ua-type <type>      # 登录类型: pc 或 mobile
```

并返回正确的退出码：
- `0`: 登录成功
- `1`: 登录失败
- `2`: 已经处于登录状态

## 许可证

本项目遵循 OpenWrt 项目的许可证。

## 贡献

欢迎提交 Issue 和 Pull Request！

## 更新日志

### v1.0.0 (2024-10-05)
- 初始版本
- 支持多 WAN 口独立登录配置
- Web 界面管理
- 实时状态监控
- 脚本在线编辑

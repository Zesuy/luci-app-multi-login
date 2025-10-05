# LuCI App MultiLogin - 项目总览

## 项目结构

```
luci-app-multilogin/
├── Makefile                           # OpenWrt 编译配置文件
├── README.md                          # 项目说明文档
├── controller/
│   └── MultiLogin.lua                 # LuCI 控制器（路由和菜单注册）
├── model/
│   └── multilogin.lua                 # LuCI 模型（配置界面定义）
└── etc/
    ├── config/
    │   └── multilogin                 # UCI 配置文件（默认配置）
    ├── init.d/
    │   └── multilogin                 # 系统服务初始化脚本
    └── multilogin/
        ├── login_control.bash         # 主控制脚本（后台守护进程）
        └── login.sh                   # 登录执行脚本
```

## 文件说明

### 核心文件

#### 1. **controller/MultiLogin.lua**
- **作用**: LuCI 路由控制器
- **功能**: 在 LuCI 界面中注册菜单项
- **位置**: 服务 -> 多拨登录

#### 2. **model/multilogin.lua**
- **作用**: LuCI 配置模型（CBI 模型）
- **功能**: 
  - 全局设置管理（启用/禁用、日志级别、重试参数）
  - 服务状态显示和控制（启动/停止/重启按钮）
  - login.sh 脚本在线编辑器
  - 登录实例配置（添加/删除/编辑多个实例）

#### 3. **etc/multilogin/login_control.bash**
- **作用**: 主控制守护进程
- **功能**:
  - 从 UCI 加载配置
  - 定期检查 mwan3 接口状态
  - 接口离线时调用 login.sh 登录
  - 失败重试机制（指数退避）
  - 日志记录

#### 4. **etc/multilogin/login.sh**
- **作用**: 登录执行脚本
- **功能**:
  - 接收命令行参数（接口、账号、密码、UA类型）
  - 获取接口 IP 和 MAC 地址
  - 检查当前认证状态
  - 执行登录操作
  - 返回状态码（0=成功, 1=失败, 2=已登录, 3+=错误）

#### 5. **etc/init.d/multilogin**
- **作用**: 系统服务脚本
- **功能**:
  - 使用 procd 管理 login_control.bash 进程
  - 提供 start/stop/restart 操作
  - 开机自启动支持
  - 配置变更时自动重载

#### 6. **etc/config/multilogin**
- **作用**: UCI 配置文件
- **内容**:
  - `config settings 'global'` - 全局设置
  - `config instance` - 多个登录实例配置

#### 7. **Makefile**
- **作用**: OpenWrt 编译配置
- **功能**:
  - 定义软件包信息
  - 安装文件到正确位置
  - 设置依赖关系（mwan3, curl）
  - 安装后操作（启用服务）

## 工作流程

```
1. 用户在 LuCI 界面配置
   ↓
2. 配置保存到 /etc/config/multilogin (UCI)
   ↓
3. 服务重启：/etc/init.d/multilogin restart
   ↓
4. procd 启动 login_control.bash
   ↓
5. login_control.bash 加载 UCI 配置
   ↓
6. 定期检查 mwan3 接口状态
   ↓
7. 发现离线接口 → 调用 login.sh
   ↓
8. login.sh 执行登录并返回状态
   ↓
9. 根据返回状态决定下次检查延迟
   ↓
10. 循环回到第 6 步
```

## 数据流

```
LuCI Web 界面 (model/multilogin.lua)
         ↕
UCI 配置文件 (/etc/config/multilogin)
         ↕
Init 脚本 (/etc/init.d/multilogin)
         ↕
login_control.bash (后台进程)
         ↕
login.sh (登录执行)
         ↕
校园网认证服务器
```

## 关键技术点

### 1. LuCI CBI (Configuration Binding Interface)
- 使用 `Map`, `TypedSection`, `Value`, `Flag`, `Button` 等组件
- 自动处理 UCI 配置的读写

### 2. Procd 进程管理
- 使用 `USE_PROCD=1` 启用 procd 支持
- 提供进程监控和自动重启
- 支持配置变更触发器

### 3. UCI 配置系统
- OpenWrt 统一配置接口
- 使用 `uci` 命令读取配置
- 支持配置验证和类型检查

### 4. Shell 脚本集成
- Bash 数组和循环处理多个实例
- 动态延迟时间管理
- 信号处理（SIGTERM）

### 5. 状态检测
- 使用 `pgrep` 检测进程状态
- 按钮动态显示（启动/停止）
- 实时 PID 显示

## 配置示例

### 最小配置
```
config settings 'global'
    option enabled '1'

config instance 'wan1'
    option enabled '1'
    option interface 'wan'
    option username 'student123'
    option password 'pass123'
    option ua_type 'pc'
```

### 完整配置
```
config settings 'global'
    option enabled '1'
    option log_level 'info'
    option retry_interval '4'
    option check_interval '5'
    option max_retry_delay '16384'
    option already_logged_delay '16'

config instance 'pc1'
    option enabled '1'
    option alias 'PC登录-WAN1'
    option interface 'wan'
    option username 'student123'
    option password 'password123'
    option ua_type 'pc'

config instance 'pc2'
    option enabled '1'
    option alias 'PC登录-WAN2'
    option interface 'wan2'
    option username 'student123'
    option password 'password123'
    option ua_type 'pc'

config instance 'mobile1'
    option enabled '1'
    option alias '移动登录-WAN3'
    option interface 'wan3'
    option username 'student123'
    option password 'password123'
    option ua_type 'mobile'
```

## 编译和安装

### 在 OpenWrt SDK 中编译

1. 将 `luci-app-multilogin` 目录复制到 SDK 的 `package/` 目录

2. 编译软件包：
```bash
make package/luci-app-multilogin/compile V=s
```

3. 生成的 ipk 文件位于：
```
bin/packages/<architecture>/packages/luci-app-multilogin_*.ipk
```

### 安装到路由器

```bash
# 上传 ipk 文件到路由器
scp luci-app-multilogin_*.ipk root@192.168.1.1:/tmp/

# SSH 登录路由器
ssh root@192.168.1.1

# 安装
opkg install /tmp/luci-app-multilogin_*.ipk

# 启用服务
/etc/init.d/multilogin enable

# 刷新 LuCI 缓存
rm -f /tmp/luci-*
```

## 调试技巧

### 查看日志
```bash
# 实时查看日志
logread -f | grep multi_login

# 查看历史日志
logread | grep multi_login

# 查看服务日志
logread | grep multilogin
```

### 手动测试登录脚本
```bash
/etc/multilogin/login.sh \
  --mwan3 wan \
  --account your_account \
  --password your_password \
  --ua-type pc
  
echo "Exit code: $?"
```

### 检查服务状态
```bash
# 检查进程是否运行
pgrep -f login_control.bash

# 查看进程详情
ps | grep login_control

# 查看 mwan3 状态
mwan3 interfaces
```

### 检查配置
```bash
# 显示所有配置
uci show multilogin

# 验证配置语法
uci validate multilogin
```

## 常见问题

### Q: 服务无法启动
A: 
1. 检查 bash 是否安装：`which bash`
2. 检查脚本权限：`chmod +x /etc/multilogin/*.sh /etc/multilogin/*.bash`
3. 查看错误日志：`logread | grep multilogin`

### Q: 登录失败
A:
1. 检查 mwan3 配置：`mwan3 interfaces`
2. 手动测试登录脚本
3. 检查网络连接：`ping -I wan 10.254.7.4`

### Q: Web 界面不显示
A:
1. 清除 LuCI 缓存：`rm -f /tmp/luci-*`
2. 重启 uhttpd：`/etc/init.d/uhttpd restart`
3. 重启 rpcd：`/etc/init.d/rpcd restart`

## 许可证

MIT License

## 作者

Based on luci-app-nettask project structure

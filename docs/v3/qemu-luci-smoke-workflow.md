# OpenWrt QEMU、LuCI 与截图复用流程

## 1. 用途与边界

本流程用于在一次性 OpenWrt x86_64 QEMU 中安装真实 MultiLogin IPK，检查
rpcd/JSHN/LuCI 的运行时契约，并生成桌面与窄屏截图。它适合复现以下问题：

- 包可以编译、静态检查通过，但安装后 rpcd 无响应；
- OpenWrt BusyBox、JSHN、UCI 或 LuCI 版本与主机测试桩行为不同；
- 菜单缓存、RPC 参数、可选 DOM 子节点、按钮状态或响应式布局异常；
- 需要为代码评审保留可重复的截图与脱敏证据。

QEMU 是可丢弃的包/UI 回归环境，不是 Phase 9 真实设备验收。它不能证明
mwan3 路由、校园网 Portal、真实升级/降级、reboot recovery、网络恢复、
APK 安装或硬件行为。默认流程禁止创建真实账号、执行
`check_instance`/`test_instance`/`logout_instance`、启用自动登录或访问 Portal。

## 2. 仓库入口

- SDK 构建矩阵：`.github/workflows/sdk-build.yml`
- 制品只读检查：`tools/release/inspect-artifact.sh`
- LuCI 运行时 smoke：`tests/qemu-playwright-smoke.mjs`
- QEMU 与真实设备的边界：`docs/v3/rc-device-acceptance.md`
- LuCI 路由：`root/usr/share/luci/menu.d/luci-app-multi-login.json`

历史 `/tmp/multilogin-qemu-r10` 仅是一次性证据目录，已经不存在，不是流程
依赖。本文件取代对该目录或聊天记录的依赖。

## 3. 必需输入

开始前由当前会话明确填写以下绝对路径和哈希。不要从旧聊天中猜测：

以下主机侧片段按 Bash 语义编写；不要在 BusyBox `sh` 中执行。

```sh
MLQ_REPOSITORY=/home/zesuy/work/github/luci-app-multi-login
MLQ_BASE_IMAGE=/absolute/path/to/openwrt-x86-64-combined-ext4.img
MLQ_BASE_IMAGE_SHA256=<64位小写SHA-256>
MLQ_IPK=/absolute/path/to/luci-app-multilogin_VERSION_all.ipk
MLQ_IPK_SHA256=<64位小写SHA-256>
MLQ_SSH_PORT=2222
MLQ_HTTP_PORT=8584
```

镜像必须与测试目标版本一致，并使用可写的 x86/64 ext4 磁盘镜像。IPK 必须由
匹配版本的 SDK 产生。25.12 APK 不得放进本 IPK 流程伪装验证。

检查主机工具和输入：

```sh
command -v qemu-system-x86_64
command -v ssh
command -v scp
command -v node
test -f "$MLQ_BASE_IMAGE"
test -f "$MLQ_IPK"
printf '%s  %s\n' "$MLQ_BASE_IMAGE_SHA256" "$MLQ_BASE_IMAGE" | sha256sum -c -
printf '%s  %s\n' "$MLQ_IPK_SHA256" "$MLQ_IPK" | sha256sum -c -
node -e "require.resolve('@playwright/test')"
```

任一命令失败即停止。Playwright 缺失时不要临时污染仓库；先由用户决定是否在
仓库外准备依赖。

## 4. 创建一次性运行目录

基础镜像永远只读保留。每次运行复制新磁盘，并把全部日志、截图和 SSH
known-hosts 限制在新目录：

```sh
MLQ_RUN_DIR=$(mktemp -d /tmp/multilogin-qemu.XXXXXX)
MLQ_RUN_IMAGE="$MLQ_RUN_DIR/openwrt-run.img"
MLQ_SERIAL_LOG="$MLQ_RUN_DIR/serial.log"
MLQ_KNOWN_HOSTS="$MLQ_RUN_DIR/known_hosts"
MLQ_EVIDENCE_DIR="$MLQ_RUN_DIR/evidence"
mkdir -p "$MLQ_EVIDENCE_DIR"
cp --reflink=auto "$MLQ_BASE_IMAGE" "$MLQ_RUN_IMAGE"
chmod 0600 "$MLQ_RUN_IMAGE" "$MLQ_KNOWN_HOSTS" 2>/dev/null || :
printf '%s\n' "$MLQ_RUN_DIR"
```

记录 `MLQ_RUN_DIR`。不要使用 `~`、`$HOME` 或仓库根目录作为清理目标。

## 5. 启动 QEMU

推荐用独立 PTY 前台启动，保留串口作为失联恢复通道：

```sh
qemu-system-x86_64 \
  -machine pc \
  -m 512 \
  -smp 2 \
  -drive "file=$MLQ_RUN_IMAGE,format=raw,if=virtio" \
  -netdev "user,id=mlqnet,hostfwd=tcp:127.0.0.1:$MLQ_SSH_PORT-:22,hostfwd=tcp:127.0.0.1:$MLQ_HTTP_PORT-:80" \
  -device virtio-net-pci,netdev=mlqnet \
  -no-reboot \
  -nographic
```

在 Codex 中应通过带 PTY 的长运行命令启动并保留 `session_id`。只用对应会话的
stdin 写串口命令；不要另起第二个 QEMU，不要用长 `sleep` 猜启动完成。等待串口
出现 OpenWrt shell 提示符。

若镜像网卡仍为静态 LAN 地址，串口中把一次性 guest 改成 QEMU user-network
DHCP，使 host forwarding 指向 guest：

```sh
uci set network.lan.proto='dhcp'
uci -q delete network.lan.ipaddr
uci -q delete network.lan.netmask
uci commit network
/etc/init.d/network restart
```

这是一次性 QEMU 内部变更，不得复制到真实设备。随后在串口交互执行 `passwd`，
设置仅用于本次 QEMU 的临时 LuCI/SSH 密码；密码不得写入文档、命令、截图名称或
证据 JSON。

## 6. Guest 预检与包安装

主机建立独立 known-hosts，不修改用户全局 SSH 配置：

```sh
MLQ_SSH="ssh -p $MLQ_SSH_PORT -o UserKnownHostsFile=$MLQ_KNOWN_HOSTS -o StrictHostKeyChecking=accept-new root@127.0.0.1"
$MLQ_SSH 'ubus call system board; df -h /overlay /tmp'
```

确认 guest 版本与 IPK SDK 版本匹配。guest 需要联网解析同版本官方 feeds；若
`opkg update` 或依赖解析失败，停止并记录，不得使用 `--force-depends` 制造假
PASS。

```sh
$MLQ_SSH 'opkg update'
scp -P "$MLQ_SSH_PORT" \
  -o "UserKnownHostsFile=$MLQ_KNOWN_HOSTS" \
  -o StrictHostKeyChecking=accept-new \
  "$MLQ_IPK" root@127.0.0.1:/tmp/luci-app-multilogin-test.ipk
$MLQ_SSH 'sha256sum /tmp/luci-app-multilogin-test.ipk'
$MLQ_SSH 'opkg install /tmp/luci-app-multilogin-test.ipk'
```

安装后保持自动登录关闭，不创建实例，不启动 Portal 动作：

```sh
$MLQ_SSH '
  uci set multilogin.global.enabled=0
  uci commit multilogin
  /etc/init.d/multilogin stop >/dev/null 2>&1 || :
  /etc/init.d/rpcd restart
  /etc/init.d/uhttpd restart
  rm -f /tmp/luci-indexcache.*
  opkg status luci-app-multilogin
  ubus list multilogin
  ubus call multilogin get_overview "{}"
'
```

只允许删除 guest 中精确的 `/tmp/luci-indexcache.*`；不要使用宽目录清理。

迭代安装新 IPK 时，先重新校验哈希，再传输并使用：

```sh
$MLQ_SSH 'opkg install --force-reinstall /tmp/luci-app-multilogin-test.ipk'
```

不要用 QEMU 强制重装结果代替 fresh-install 或 upgrade 验收。

## 7. 机器可判定的 LuCI smoke

先运行仓库已有 smoke。密码通过当前 shell 环境临时提供，不写进 argv 或证据：

```sh
(
  set +x
  printf 'Temporary QEMU LuCI password: ' >&2
  IFS= read -r -s MLQ_LUCI_PASSWORD
  printf '\n' >&2
  export MULTILOGIN_QEMU_URL="http://127.0.0.1:$MLQ_HTTP_PORT"
  export MULTILOGIN_LUCI_PASSWORD="$MLQ_LUCI_PASSWORD"
  node "$MLQ_REPOSITORY/tests/qemu-playwright-smoke.mjs"
  MLQ_SMOKE_RC=$?
  unset MLQ_LUCI_PASSWORD MULTILOGIN_LUCI_PASSWORD MULTILOGIN_QEMU_URL
  exit "$MLQ_SMOKE_RC"
)
```

必须观察 Overview 与 Scripts smoke 均为 PASS、无浏览器异常、无
`invalid request fields`，且浏览器没有提交 URL/path 字段。失败时保留运行目录，
不要继续截图并把错误掩盖成视觉问题。

## 8. 桌面与移动截图

smoke 通过后，使用固定的只读导航脚本
`tests/qemu-playwright-evidence.mjs` 生成截图和证据 JSON。脚本要求证据目录已存在、
不是符号链接且为空，绝不会覆盖旧证据。

| 视口 | 尺寸 | 必需页面 |
| --- | --- | --- |
| desktop | 1440×900 | 仪表盘、登录管理、网络资源、故障排查、脚本维护 |
| mobile | 390×844 | 同上 |
| narrow gate | 375×812 | 至少登录管理与脚本维护 |

固定路由：

```text
/cgi-bin/luci/admin/services/multilogin/overview
/cgi-bin/luci/admin/services/multilogin/configuration
/cgi-bin/luci/admin/services/multilogin/network
/cgi-bin/luci/admin/services/multilogin/maintenance/troubleshooting
/cgi-bin/luci/admin/services/multilogin/maintenance/scripts
```

执行：

```sh
(
  set +x
  MLQ_REPOSITORY_COMMIT=$(git -C "$MLQ_REPOSITORY" rev-parse HEAD)
  MLQ_PACKAGE_NAME=$(basename -- "$MLQ_IPK")
  printf 'Temporary QEMU LuCI password: ' >&2
  IFS= read -r -s MLQ_LUCI_PASSWORD
  printf '\n' >&2
  export MULTILOGIN_QEMU_URL="http://127.0.0.1:$MLQ_HTTP_PORT"
  export MULTILOGIN_LUCI_PASSWORD="$MLQ_LUCI_PASSWORD"
  export MULTILOGIN_QEMU_EVIDENCE_DIR="$MLQ_EVIDENCE_DIR"
  export MULTILOGIN_QEMU_REPOSITORY_COMMIT="$MLQ_REPOSITORY_COMMIT"
  export MULTILOGIN_QEMU_PACKAGE_NAME="$MLQ_PACKAGE_NAME"
  export MULTILOGIN_QEMU_PACKAGE_SHA256="$MLQ_IPK_SHA256"
  node "$MLQ_REPOSITORY/tests/qemu-playwright-evidence.mjs"
  MLQ_EVIDENCE_RC=$?
  unset MLQ_LUCI_PASSWORD MULTILOGIN_LUCI_PASSWORD MULTILOGIN_QEMU_URL \
    MULTILOGIN_QEMU_EVIDENCE_DIR MULTILOGIN_QEMU_REPOSITORY_COMMIT \
    MULTILOGIN_QEMU_PACKAGE_NAME MULTILOGIN_QEMU_PACKAGE_SHA256
  exit "$MLQ_EVIDENCE_RC"
)
```

脚本会为每张截图等待页面 RPC、生成 SHA-256，并检查：

- 页面 `scrollWidth <= innerWidth + 1`，没有整页横向溢出；
- 没有 `null`/`nullnull`、`invalid request` 或 JavaScript page error；
- 维护子导航双向可达且 `aria-current` 正确；
- idle 控件可点击，只有请求进行中才 disabled；
- 截图不含真实账号、密码、IP、MAC、Cookie、浏览器开发者工具或通知浮层；
- 文件名为 `<viewport>-<route>.png`，例如 `390-configuration.png`。

如果需要验证确认框，只执行取消路径，并在浏览器网络事件中证明相应 mutating
RPC 调用次数为零。默认截图流程不得点击登录、注销、服务动作、网络恢复、脚本
验证/激活或其他会触发外部网络/持久状态的按钮。

截图完成后另生成独立清单：

```sh
(
  cd "$MLQ_EVIDENCE_DIR"
  sha256sum ./*.png >sha256sums.txt
)
```

固定脚本已经生成不含页面正文的 `evidence.json`，包含仓库提交、IPK 文件名与
SHA-256、每个截图的路由/视口/文件名与哈希、overflow 检查、page-error 数量和
执行时间。操作员在结果模板中另记录 OpenWrt 版本和 smoke 退出码。不得保存完整
ubus 响应或请求体。

## 9. 可选的 QEMU 内写操作

只有任务明确要求时，才可在快照可丢弃的 QEMU 中测试 UCI 保存或取消确认框。
这不授权真实设备、Portal、服务、网络或外部应用写操作。

推荐最小顺序：

1. 保存一个明显的合成账号别名；密码只用临时测试值且不进入证据。
2. 保存一个 disabled 实例，禁止点击登录/注销/状态检查。
3. 重新读取 UCI 和 LuCI 页面，证明命名 section、引用与空 `v6face` 稳定。
4. 对危险确认框只走 Cancel，并证明 mutating RPC 为零。
5. 任何 `quick_setup`/network 写入都必须使用单独磁盘副本和串口恢复通道；管理
   失联一次即停止。

QEMU 写操作不得被记录为 Phase 9 `PASS`。

## 10. 失败诊断顺序

按层次定位，不要直接重装或刷新掩盖现场：

```sh
$MLQ_SSH 'logread -e rpcd -e uhttpd -e multilogin'
$MLQ_SSH 'ubus list multilogin'
$MLQ_SSH 'ubus call multilogin get_overview "{}"'
$MLQ_SSH 'ls -l /usr/libexec/rpcd/multilogin /usr/libexec/multilogin-config /usr/libexec/multilogin-script'
$MLQ_SSH 'opkg status luci-app-multilogin'
```

然后检查浏览器 page error、失败的 `/ubus/` HTTP 状态和返回 envelope。允许保存
脱敏后的固定错误分类，不保存密码、完整 UCI、Cookie、原始 Portal 响应或任意
脚本源内容。

## 11. 停止与留证

先退出 Playwright/浏览器，再通过 QEMU 串口执行：

```sh
sync
poweroff
```

等待 QEMU 进程退出。若 guest 无法关机，只终止本次 PTY/session 对应的已确认
QEMU 进程；不要使用宽泛的 `pkill qemu`。保留以下内容：

- `serial.log` 或当前 Codex 终端的脱敏摘要；
- `evidence/`、`sha256sums.txt`、`evidence.json`；
- IPK、镜像和运行磁盘的哈希；
- 失败时的最小脱敏日志与缺陷说明。

确认不再需要复现后，才删除精确记录的 `MLQ_RUN_DIR`。基础镜像、SDK 缓存、
仓库和其他 `/tmp` 目录不属于清理范围。

## 12. 结果声明模板

```text
QEMU smoke result: PASS | FAIL
Repository commit:
OpenWrt image version and SHA-256:
Package filename and SHA-256:
QEMU command/ports:
Package install result:
rpcd/ubus result:
Playwright smoke result:
Screenshot manifest path and SHA-256:
Synthetic writes performed: none | exact list
Portal/device/network actions performed: none
Known skips/risks:
Real-device acceptance status: unchanged
```

只有全部必需字段有证据时才能写 `QEMU smoke PASS`；即使 PASS，真实设备验收状态
仍保持不变。

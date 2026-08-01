# MultiLogin v3 RC Device Acceptance

状态：**仅完成离线准备；尚未授权任何真实设备、凭据、门户、发布或网络操作。**

本清单是 Phase 9 的人工执行控制面。每个单元必须单独记录授权、结果和脱敏证据；不得把一次笼统的“继续”解释为设备操作授权。

## 1. 候选输入

| 输入 | 固定身份 | 当前离线证据 |
| --- | --- | --- |
| v3 / OpenWrt 23.05 | `luci-app-multilogin_3.0.0-rc.1-1_all.ipk` | SHA-256 `9f324884fad024a067c6116e69c7e809dc3c37186d2bf5a22145b584f79274f4` |
| v3 / OpenWrt 24.10 | `luci-app-multilogin_3.0.0-rc.1-r1_all.ipk` | SHA-256 `f654f0655f1781822d391186a1bc663cd06f8a12acb4bd9529433b10120c9671` |
| v3 / OpenWrt 25.12 | `luci-app-multilogin-3.0.0_rc1-r1.apk` | SHA-256 `cf35d9b4f6e364a70a19502a3a338ea3fbd4236a3618f1ec6db02b54cc6e0092` |
| 支持的 v2 降级包 | `luci-app-multilogin_2.2.0-4_all.ipk`，源码提交 `fb272e8285c65415dea8a9a359a4204b94be06a0` | 使用官方 23.05.6 x86_64 SDK 离线重建；SHA-256 `bd3de0f4dfbd13a9bd84ab8f63f9875dcd99c232ad23a53d9009dba5dc2f4f1e` |

这些哈希描述本次本地构建，不替代发布签名。项目当前没有已冻结的签名密钥或签名格式；若产品要求密码学签名，必须先由产品所有者做出决定，不能临时生成并宣称为既有信任根。

每次设备会话开始前，在操作员工作站重新执行只读校验：

```sh
sha256sum <RC_PACKAGE>
sha256sum <V2_DOWNGRADE_IPK>
```

文件不存在或哈希不符时立即停止；不要从聊天记录、临时 HTTP 地址或未经验证的设备副本恢复候选包。

## 2. 必要环境与人工输入

在授权任何设备操作前，操作员必须填写：

- 会话 ID、日期、操作员和审批人；
- 测试设备型号，以及 OpenWrt、LuCI、rpcd、mwan3 的实际版本；
- 管理接口和独立的带外恢复方式；
- 23.05 与 24.10 各自的测试设备或可恢复快照；发布 APK 前另需 25.12 真实设备或可恢复快照；
- 测试 WAN 到逻辑 mwan3 接口的映射；
- 仅供验收的隔离校园网账号；账号、密码、Cookie、完整 IP/MAC 不得写入证据；
- 私有、加密、仓库外的设备备份位置和恢复步骤；
- 维护窗口、可接受的断网范围，以及出现管理失联时负责恢复的人员。

不得在生产路由器、唯一管理链路或没有控制台/快照恢复能力的设备上执行中断、重启、网络事务或降级单元。

## 3. 授权边界

授权必须明确列出允许执行的范围代码：

| 范围 | 涵盖内容 |
| --- | --- |
| `A-READ` | 真实设备只读版本、状态、文件模式和诊断检查；不包含门户请求。 |
| `A-PKG` | 安装、升级、卸载及 opkg 生命周期。 |
| `A-CONFIG` | 写入/恢复 MultiLogin UCI 配置、保存账号/实例/settings、清理固定日志；不包含 network/firewall/mwan3。 |
| `A-SVC` | 启停、启用/禁用 MultiLogin 服务及进程检查。 |
| `A-PORTAL` | 使用隔离凭据执行真实 status/login/logout 和门户状态变化。 |
| `A-SCRIPT` | 下载、执行 self-test、验证、激活、回滚或恢复 Root 脚本。 |
| `A-NET` | 修改或重载 network/firewall/mwan3，执行 ownership/journal 恢复。 |
| `A-FAULT` | 受控断网、磁盘不足、进程中断或事务中断注入。 |
| `A-REBOOT` | 重启设备并验证恢复。 |
| `A-DOWNGRADE` | 安装固定 v2 包并运行降级 finalizer。 |
| `A-GITHUB` | 推送、合并、配置环境、触发 workflow、创建 tag 或 Release。 |

缺少相应范围时，该单元保持 `NOT AUTHORIZED`，而不是 `SKIP/PASS`。

## 4. 全局停止条件

发生任一情况立即停止后续变更，保存脱敏的只读证据，并执行预先批准的恢复步骤：

- 管理连接丢失一次，或带外控制台不可用；
- 密码、Cookie、完整请求 URL、原始门户正文、账号、未脱敏 IP/MAC 出现在 argv、浏览器响应、RPC、日志或证据中；
- 任何未记录在 `network-state.json` 的 network/firewall/mwan3 对象被修改或删除；
- 脚本或网络 recovery journal 无法清理，或回滚/finalizer 第一次执行失败；
- 包安装后文件列表、所有者或模式与 Phase 8 产物检查不一致；
- 单实例 10 分钟内出现超过 8 次登录尝试，或任一重试早于约定的退避下界；
- 发现两个 controller 进程、持续增长的临时秘密文件、未清理的 curl 配置，或 daemon 进入忙循环；
- 磁盘空间不足以同时保留当前、LKG、事务备份和迁移备份；
- 实际门户行为与固定 API/`phone_flag`/logout 顺序不一致；
- 任何 P0/P1 缺陷、数据丢失、不可逆的自定义脚本覆盖或恢复路径不确定。

不得为了“继续测试”临时放宽停止条件。

## 5. 证据规则

每个矩阵单元使用下列模板；原始备份和日志保留在操作员私有目录，不提交仓库：

```text
Cell ID:
Authorization scope and approval reference:
Device/session alias (not serial/MAC/IP):
OpenWrt/mwan3/package versions:
Timestamp and timezone:
Precondition:
Action actually executed:
Expected result:
Actual result:
Redacted evidence hashes/paths:
Secret scan result:
Cleanup/rollback result:
Result: PASS | FAIL | NOT AUTHORIZED
Defect/notes:
```

允许进入仓库的只有小型脱敏摘要和哈希。不得提交 sysupgrade 备份、UCI 导出、浏览器 HAR、portal body、设备日志全集、IPK/APK 或凭据。

## 6. 只读预检（`A-READ`）

授权后，先在设备上确认版本、空间和恢复能力。命令输出必须在保存前脱敏：

```sh
ubus call system board
opkg status luci-app-multilogin
opkg print-architecture
df -h /overlay /tmp
/etc/init.d/multilogin enabled
pgrep -af '/etc/multilogin/login_control.bash'
```

不要把 `uci export multilogin`、账号 section、进程环境或 curl 临时文件内容复制到证据。备份可以包含秘密，但必须加密、留在仓库外，并在会话结束后按操作员策略销毁。

预检还需确认候选包的本地哈希、目标设备接受对应 IPK/APK 格式与架构、依赖可解析、系统时间正确，以及控制台恢复实际可用。任何一项不满足则不进入写操作。

## 7. 人工验收矩阵

除 `PKG-01`（23.05）、`PKG-02`（24.10）和 `PKG-02A`（25.12 APK）已经明确拆分外，所有 `PKG`、`PORTAL`、`CTRL`、`RPC`、`SCRIPT`、`CFG`、`NET`、`UI` 和 soak 必需单元都要在 **23.05 与 24.10 各执行一次并分别留证**。不能用一条证据代表两个系统版本。APK 发布还必须单独通过 `PKG-02A`；QEMU 结果不能替代它。Portal 单元还必须覆盖 IPv4-only 与真实 dual-stack；只有 IPv6 地址存在但门户/运营商不支持 IPv6 时，记录实际失败而不能改写成 PASS。

授权与恢复映射如下。每个单元执行前，要把占位符替换为本次会话的已核对值，把确切恢复命令复制到证据模板的 `Cleanup/rollback` 字段，并由第二人复核。没有预先批准的恢复命令时不得开始写操作。

| 单元 | 必需授权 | 预先批准的清理/恢复 |
| --- | --- | --- |
| `PKG-*` | `A-PKG`、涉及服务时 `A-SVC`；中断/重启/降级另加对应范围 | 从带外控制台安装会话前已验证的旧包，或恢复私有 sysupgrade 快照；随后按记录状态执行 `/etc/init.d/multilogin enable|disable` 与 `start|stop`。降级只用本文件固定 finalizer。 |
| `PORTAL-*` | `A-PORTAL`；断网故障另加 `A-FAULT` | `/etc/multilogin/cqu-portal.sh logout --mwan3 <IFACE> --account <ACCOUNT> [--v6face <IFACE>]`；若 logout 无法确认 offline，停止自动动作并由门户管理员人工确认。 |
| `CTRL-*`、`RPC-*` | `A-PORTAL`、`A-SVC`；信号/故障另加 `A-FAULT` | `/etc/init.d/multilogin stop`，确认 controller 进程消失；再执行上面的 portal logout，恢复会话前的 enable/running 状态。 |
| `SCRIPT-*` | `A-SCRIPT`；status 触网时加 `A-PORTAL`；中断/重启另加对应范围 | 首选 `ubus call multilogin script_rollback '{"expected_sha256":"<LKG_SHA256>","expected_generation":<GEN>,"confirm_activate":true}'`；journal 阻塞时只执行固定 `/usr/libexec/multilogin-script recover`；仍失败则停止服务并从私有备份恢复。 |
| `CFG-*` | `A-CONFIG`；显式服务动作另加 `A-SVC` | 会话前以 mode 0600 私有备份 `/etc/config/multilogin`；失败时通过控制台恢复该文件和原模式，再按原状态显式启停服务。不得把备份复制到证据。 |
| `NET-*` | `A-NET`；故障/重启另加对应范围 | 优先 `ubus call multilogin network_recover '{}'`；测试创建的 owned 对象可用 `ubus call multilogin remove_auto '{}'` 清理；无法安全恢复时停止 controller，通过控制台恢复私有 network/firewall/mwan3 快照。 |
| `UI-*` | 只读状态为 `A-READ`；表单写入按目标增加 `A-CONFIG`/`A-SVC`/`A-SCRIPT`/`A-NET` | 使用对应后端单元的恢复命令；纯渲染/键盘检查无设备清理。 |
| `GH-*` | `A-GITHUB` | 默认保留失败的 run/draft 供审计；删除 draft/tag、回退 main 或重跑均是新的外部状态变更，必须再次明确授权。 |

### 7.1 包与迁移

| ID | 场景 | 关键验收 |
| --- | --- | --- |
| `PKG-01` | 23.05 全新安装 | 服务被 enable 但不强制 start；`global.enabled=0`；没有占位账号/实例；安装文件、conffile 和模式与 IPK 一致。 |
| `PKG-02` | 24.10 全新安装 | 与 `PKG-01` 相同，并确认 `3.0.0-rc.1-r1` 控制版本。 |
| `PKG-02A` | 25.12 APK 全新安装 | 使用真实 apk-tools 和真实设备；与 `PKG-01` 相同，确认 `3.0.0_rc1-r1`、`noarch`、依赖、conffile、lifecycle hooks 与卸载清理。未通过时不得发布 APK。 |
| `PKG-03` | v2 stock 升级，disabled/stopped | UCI 与时间字段保留；服务仍 disabled/stopped；stock 脚本进入 Managed。 |
| `PKG-04` | v2 stock 升级，enabled/stopped | enabled 与 running 独立保留；不得隐式启动。 |
| `PKG-05` | v2 stock 升级，enabled/running | 只在先前 running 时恢复运行；无重复 daemon。 |
| `PKG-06` | v2 自定义脚本升级 | 未知脚本按原名/哈希/模式保存在 root-only 迁移目录，保持 inactive，绝不在安装时执行。 |
| `PKG-07` | 部分 v3/重复安装 | migration journal 幂等收敛；唯一自定义副本和活动脚本均不丢失。 |
| `PKG-08` | 受控中断/低空间（需 `A-FAULT`） | 失败前后均有可恢复的 v2 或有效 v3；重入后完成或明确保留 recovery state；服务不在不确定状态启动。 |
| `PKG-09` | 卸载 | 服务停止并禁用；只删除包所有文件；用户/迁移保留策略符合合同。 |
| `PKG-10` | v3 → 固定 v2 降级（需 `A-DOWNGRADE`） | 仅使用哈希固定的 `2.2.0-4` 包；立即运行唯一 finalizer；UCI/凭据/自定义备份和服务 enabled/running 状态恢复；没有 v3 runtime 脚本继续活动。 |
| `PKG-11` | 降级 finalizer 中断与重入（需 `A-FAULT`/`A-REBOOT`） | finalizer 保留并可幂等重跑；失败不会删除唯一备份；完成后才自删除。 |
| `PKG-12` | migration lock/原子写/并发 opkg（需 `A-FAULT`） | 第二个生命周期操作被锁拒绝；目录/manifest/模式只出现完整旧值或完整新值；不存在半写文件或双 finalizer。 |

降级操作只允许合同中的固定路径：

```sh
opkg install --force-downgrade <VERIFIED_V2_IPK>
/etc/uci-defaults/99-multilogin-v3-downgrade-finalize
```

这两条命令仅是审查过的操作序列，不构成当前执行授权。

### 7.2 门户脚本和控制器

| ID | 场景 | 关键验收 |
| --- | --- | --- |
| `PORTAL-01A` | IPv4-only 无凭据 status，offline/online | 输出/exit/envelope 匹配合同；多记录只按本机身份消歧；日志不含原始正文或标识符。 |
| `PORTAL-01B` | dual-stack status | 实际解析 IPv4/IPv6/MAC，IPv6 按合同编码；身份过滤唯一；缺失 IPv6 时不能伪造 dual-stack PASS。 |
| `PORTAL-02` | PC login | password 只走 stdin；进程 argv 无密码/UA 空格拆分；成功后五次界内观察 `phone_flag=0`。 |
| `PORTAL-03` | Mobile login | 与 `PORTAL-02` 相同，观察 `phone_flag=1`，HTTP UA 与 `term_ua` 字节相同。 |
| `PORTAL-04` | 已在线/错误类型 | 正确类型返回 already-online；错误类型返回 classification mismatch 且不自动 logout/替换。 |
| `PORTAL-05` | auth/transport/interface/dependency 失败 | 分类、exit 和日志稳定；无原始 portal body；失败不会忙循环。受控网络失败另需 `A-FAULT`。 |
| `PORTAL-06` | logout 已离线 | 幂等 already-offline，不发送不必要的状态变更。 |
| `PORTAL-07` | logout 在线/延迟 | 实际顺序为 unbind → checkLogout → 最多十次 offline poll；观察 offline 才成功；超时为 exit 9。 |
| `CTRL-01` | 单实例失败/成功 | 首次立即；默认失败 base 为 8/16/32…、cap 后 ±10% jitter；成功或 mwan3 online 重置为 4。 |
| `CTRL-02` | 多实例 | 每实例退避隔离；一个接口恢复不重置其他实例；无重试风暴。 |
| `CTRL-03` | disabled/no-instance/mwan3 unavailable | disabled 正常退出；无实例保持可响应；mwan3 unavailable 按 check interval 等待且不 login。 |
| `CTRL-04` | signal/crash/temp/process | 单 daemon；秘密不在 argv/log；`mktemp` 目录、输出和 curl config 在正常退出及信号后清理。 |
| `RPC-01` | check/test/logout RPC | 固定 envelope/兼容字段正确；test 的密码仅 stdin；浏览器/RPC 不返回 username、password 或 child output。 |

`PORTAL-02` 和 `PORTAL-03` 在每个 OpenWrt 版本上都分别执行 IPv4-only 与 dual-stack 变体。直接 login 验收时密码只能由交互式安全输入提供，不得写在命令、shell history、文件或证据中。下面是唯一预审过的 stdin 操作序列；替换非秘密占位符前先关闭 shell tracing，任何修改都要重新审查：

```sh
(
set +x
if [ ! -t 0 ]; then
    printf 'A controlling TTY is required; login not attempted.\n' >&2
    exit 4
fi
if ! OLD_TTY=$(stty -g); then
    printf 'Cannot read TTY state; login not attempted.\n' >&2
    exit 4
fi
cleanup_password() {
    stty "$OLD_TTY" >/dev/null 2>&1 || :
    unset PORTAL_PASSWORD
}
abort_password() {
    trap - 0 1 2 15
    cleanup_password
    exit 130
}
trap cleanup_password 0
trap abort_password 1 2 15
if ! stty -echo; then
    printf 'Cannot disable TTY echo; login not attempted.\n' >&2
    exit 4
fi
printf 'Portal password: ' >&2
if ! IFS= read -r PORTAL_PASSWORD || [ -z "$PORTAL_PASSWORD" ]; then
    printf '\nPassword input failed or was empty; login not attempted.\n' >&2
    exit 4
fi
if ! stty "$OLD_TTY"; then
    printf '\nCannot restore TTY state; login not attempted.\n' >&2
    exit 4
fi
printf '\n' >&2
trap - 1 2 15
printf '%s\n' "$PORTAL_PASSWORD" | /etc/multilogin/cqu-portal.sh login --mwan3 <IFACE> --account <ACCOUNT> --ua-type <pc-or-mobile>
LOGIN_RC=$?
unset PORTAL_PASSWORD
trap - 0
exit "$LOGIN_RC"
)
```

dual-stack 变体只允许增加已核对的 `--v6face <IFACE>`。操作员在会话结束后检查进程列表和脱敏日志；不得保存终端录屏中可能出现的账号标识。

### 7.3 Raw/Custom 脚本状态机

| ID | 场景 | 关键验收 |
| --- | --- | --- |
| `SCRIPT-01` | info/check/stage | 只访问固定 GitHub Raw URL；无重定向；大小/超时/API/SemVer/UTF-8/regular-file/`sh -n` 边界真实生效；stage 不执行。 |
| `SCRIPT-02` | validate（需 `A-SCRIPT`） | 明确 root-code 确认、精确 hash/generation 后才执行 `self-test`；输出界限和 timeout 生效。 |
| `SCRIPT-03` | activate | 二次确认；活动脚本、LKG、generation、mode/source 一致；有实例时真实 status 验证，无实例时只允许 `skipped_no_instance`。 |
| `SCRIPT-04` | 激活失败/rollback_required | 事务备份恢复原活动脚本，generation/LKG 不前移；恢复失败时 journal/backup 保留并阻止启动。 |
| `SCRIPT-05` | rollback/restore | 精确 expected hash/generation；rollback 可交换 LKG；factory restore 使用包管理 factory，不覆盖 Custom 备份。 |
| `SCRIPT-06` | Custom draft/conflict | 保存不激活；base-hash 冲突不丢文本；验证/激活分别确认；Managed candidate 不覆盖 draft/preserved copy。 |
| `SCRIPT-07` | reboot recovery（需 `A-REBOOT`） | prepared/active_replaced/verified/rollback_required 的真实磁盘状态按合同收敛；无法证明时保持阻塞。 |
| `SCRIPT-08` | 并发 script RPC/锁 | 两个 stage/validate/activate/rollback/save-draft 操作不能同时提交；失败者得到 conflict/busy，generation 只递增一次，无候选/LKG 串写。 |
| `SCRIPT-09` | 低空间/写入中断/原子性（需 `A-FAULT`） | free-space 检查在写前失败；中断后只存在完整旧/新文件，mode/owner 正确；事务备份和 journal 足以恢复且唯一副本不丢失。 |

当前固定 Raw URL 指向 `main`。要实际验证“有更新”的 stage/activate/rollback，需要先有经过审查并获 `A-GITHUB` 授权的 main 上 shell-only SemVer 增量；不得为了测试而改 URL、DNS 劫持或启用本地 HTTP 模拟。固定 URL 的真实 3xx 负例在 GitHub 不返回重定向时无法制造，必须由产品所有者选择受控真实网络方法或明确修改验收合同，不能伪造 PASS。

### 7.4 配置、网络、恢复与 UI

| ID | 场景 | 关键验收 |
| --- | --- | --- |
| `CFG-01` | 账号/实例/settings 保存 | 密码写-only、空白保留旧密码；引用保护与类型/范围校验；保存不隐式重启服务。 |
| `CFG-02` | service actions/diagnostics/log | 只作用于 MultiLogin；状态真实回读；日志按 UTF-8/完整行截断并脱敏；race 不泄漏。 |
| `NET-01` | quick setup | 只创建规范 `ml3_*` 对象；按 network→firewall→mwan3 commit/reload；state/journal 模式正确。 |
| `NET-02` | remove | 只删除 state 中精确记录的对象；任何未拥有的 legacy `auto_*` 或用户对象保持不变。 |
| `NET-03` | collision/drift | 写入前拒绝 collision/drift；不采用同名前缀对象；journal 不应在拒绝前创建。 |
| `NET-04` | commit/reload 失败（需 `A-FAULT`） | rollback 恢复 before；reload 失败也回滚；无法恢复时保留 journal 并阻止 controller。 |
| `NET-05` | 中断/重启恢复（需 `A-REBOOT`） | 每个 journal state 在真实 UCI durable state 上收敛；设备管理连接保持可恢复。 |
| `UI-01` | 五页导航和旧路由 | Overview/Configuration/Network/Scripts/Diagnostics 可用；旧路由只重定向，不加载旧实现。 |
| `UI-02` | 浏览器权限和秘密 | 无直接 UCI/file/init 权限；响应只有 `password_set`；动作按 read/write ACL 分离。 |
| `UI-03` | 交互、对比度与布局 | loading/empty/error/retry/conflict 状态、键盘焦点、确认、live region、文本/控件/焦点对比度、375px 无页面横向溢出。此单元需要产品所有者接受主观 UX。 |

网络单元执行前必须导出一份**私有且不可提交**的 network/firewall/mwan3 快照，并证明带外恢复。不能用主机模拟替代这些单元。

### 7.5 GitHub 后置发布门禁

这些单元不是 Phase 9 **设备验收 gate** 的组成部分；Phase 9 可以在它们仍为 `NOT AUTHORIZED` 时完成设备 RC 判定。但任何 draft/stable Release 或声称“CI 已发布验证”之前必须执行：

| ID | 场景 | 关键验收 |
| --- | --- | --- |
| `GH-01` | 默认分支普通 CI | run 来自本仓库默认分支 push/目标 SHA；offline/static/pure-logic gate 成功；普通 CI 不下载 SDK、不产出 IPK/APK。 |
| `GH-02` | 后续 shell-only CI | 只有 `cqu-portal.sh`/允许的 changelog 路径变化；API 仍为 3、SemVer 严格增加；SDK job 被跳过且 Raw 内容来自 main。此单元在有真实后续 shell 版本时执行。 |
| `GH-03` | 手动 Release validation | 输入 tag/base ref 正确；同一目标 SHA 的 offline gate、23.05/24.10 IPK、25.12 APK 与精确只读制品检查全部成功；下载 artifact 哈希匹配。 |
| `GH-04` | protected draft workflow | `release` environment 和审批人正确；验证 Release validation 的 run path/event/repository/branch/SHA；只创建 draft；两种 IPK、一个 APK 和 checksums 均存在。 |
| `GH-05` | stable publication | 仅在设备 gate、soak、产品 UX 和所有发布决定接受后，另行授权 tag/Release；不得由当前清单自动触发。 |

## 8. Soak 验收

只有 7.1–7.4 的必需单元在两个 OpenWrt 版本上全部 `PASS` 后才开始 soak；7.5 是发布前的独立后置门禁：

- 前 30 分钟由操作员在线观察，随后在隔离测试设备上连续运行 24 小时；
- 23.05 与 24.10 各完成一个独立 24 小时窗口；每个版本至少包含一个 PC 和一个 mobile 实例，或分别完成等价窗口；
- 单实例任意 10 分钟登录尝试不得超过 8 次，且不得早于计算出的 jitter 下界；
- controller 始终只有一个实例，30 分钟 warm-up 后 RSS 不得持续单调增长超过 20%；
- `script_recovery_required` 和 `network_recovery_required` 始终为 false；
- 无密码/账号/原始门户正文/完整 IP/MAC 泄漏，无 P0/P1 缺陷；
- 服务、路由和管理连接保持健康；结束时再次验证 rollback/restore 和私有备份可用。

任一阈值失败会终止 soak；修复后必须从零重新计算完整 24 小时窗口。

## 9. 尚未解除的人工阻塞

截至本文件生成时：

- 没有真实设备清单、带外恢复证明或测试 WAN 映射；
- 没有授权使用隔离凭据或执行真实门户状态变化；
- 没有授权安装/升级/降级包、变更服务/网络、执行 root script 或重启；
- 分支尚未推送，CI/SDK workflow 未在 GitHub 运行，`release` environment 未配置；
- 固定 Raw URL 上没有专供 `SCRIPT-01`–`SCRIPT-05` 的后续 shell-only 版本；
- 没有产品所有者对发布签名方案、真实 redirect 负例方法和主观 UI 结果的决定；
- 没有 push、tag、workflow dispatch、draft/stable Release 授权。

因此 Phase 9 只能保持准备/阻塞状态，不能将任何真实集成单元标记为 PASS，也不能发布 `v3.0.0-rc.1` 或 `v3.0.0`。

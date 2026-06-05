#!/bin/sh

INTERFACE=""
V6FACE=""
WLAN_USER_ACCOUNT=""
WLAN_USER_PASSWORD=""
UA_TYPE="mobile"
CHECK_ONLY=0
LOG_LEVEL=1

DEFAULT_HOST="login.cqu.edu.cn"
DEFAULT_HTTPS_PORT="802"
DEFAULT_STATUS_JS_VERSION="4.X"
DEFAULT_ACTION_JS_VERSION="4.2.2"
DEFAULT_LANG="zh"
DEFAULT_ZERO_MAC="000000000000"

PC_UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36"
MOBILE_UA="Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Mobile Safari/537.36"

while [ $# -gt 0 ]; do
    case "$1" in
        --mwan3)
            INTERFACE="$2"
            shift 2
            ;;
        --account)
            WLAN_USER_ACCOUNT="$2"
            shift 2
            ;;
        --v6face)
            V6FACE="$2"
            shift 2
            ;;
        --password)
            WLAN_USER_PASSWORD="$2"
            shift 2
            ;;
        --ua-type)
            UA_TYPE="$2"
            shift 2
            ;;
        --check-only)
            CHECK_ONLY=1
            shift
            ;;
        *)
            shift
            ;;
    esac
done

log() {
    local level_num="$1"
    local msg="$2"
    local level_text="UNKNOWN"

    if [ "$level_num" -ge "$LOG_LEVEL" ]; then
        case "$level_num" in
            0) level_text="DEBUG" ;;
            1) level_text="INFO" ;;
            2) level_text="ERROR" ;;
        esac

        local log_msg="[$(date '+%Y-%m-%d %H:%M:%S')] [$INTERFACE] [$level_text] $msg"
        echo "$log_msg" >> /var/log/multilogin.log
        logger -t "multi_login_sh" -p "user.$(echo "$level_text" | tr '[:upper:]' '[:lower:]')" "$log_msg"
        echo "$log_msg"
    fi
}

command_exists() {
    command -v "$1" >/dev/null 2>&1
}

json_value() {
    local json="$1"
    local expr="$2"

    jsonfilter -s "$json" -e "$expr" 2>/dev/null
}

strip_jsonp() {
    local payload="$1"

    payload=$(printf '%s' "$payload" | tr -d '\r' | sed '1s/^[^(]*(//; $s/)[[:space:]]*;*[[:space:]]*$//')
    printf '%s' "$payload"
}

random_v() {
    awk 'BEGIN{srand(); printf "%d", int(rand()*9500)+500}'
}

callback_name() {
    awk 'BEGIN{srand(); printf "dr%d", int(rand()*9000)+1000}'
}

base64_encode() {
    if [ -z "$1" ]; then
        return 0
    fi

    if command_exists base64; then
        printf '%s' "$1" | base64 | tr -d '\n'
        return 0
    fi

    if command_exists busybox; then
        if busybox base64 --help >/dev/null 2>&1; then
            printf '%s' "$1" | busybox base64 | tr -d '\n'
            return 0
        fi
    fi

    if command_exists openssl; then
        printf '%s' "$1" | openssl base64 -A
        return 0
    fi

    if command_exists lua; then
        printf '%s' "$1" | lua -e '
local input = io.read("*a") or ""
local b = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
local t = {}
for i = 1, #input, 3 do
  local a = input:byte(i) or 0
  local c = input:byte(i + 1)
  local d = input:byte(i + 2)
  local n = a * 65536 + (c or 0) * 256 + (d or 0)
  local s1 = math.floor(n / 262144) % 64 + 1
  local s2 = math.floor(n / 4096) % 64 + 1
  local s3 = math.floor(n / 64) % 64 + 1
  local s4 = n % 64 + 1
  t[#t + 1] = b:sub(s1, s1)
  t[#t + 1] = b:sub(s2, s2)
  t[#t + 1] = c and b:sub(s3, s3) or "="
  t[#t + 1] = d and b:sub(s4, s4) or "="
end
io.write(table.concat(t))
'
        return $?
    fi

    if command_exists lua5.1; then
        printf '%s' "$1" | lua5.1 -e '
local input = io.read("*a") or ""
local b = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
local t = {}
for i = 1, #input, 3 do
  local a = input:byte(i) or 0
  local c = input:byte(i + 1)
  local d = input:byte(i + 2)
  local n = a * 65536 + (c or 0) * 256 + (d or 0)
  local s1 = math.floor(n / 262144) % 64 + 1
  local s2 = math.floor(n / 4096) % 64 + 1
  local s3 = math.floor(n / 64) % 64 + 1
  local s4 = n % 64 + 1
  t[#t + 1] = b:sub(s1, s1)
  t[#t + 1] = b:sub(s2, s2)
  t[#t + 1] = c and b:sub(s3, s3) or "="
  t[#t + 1] = d and b:sub(s4, s4) or "="
end
io.write(table.concat(t))
'
        return $?
    fi

    return 1
}

normalize_mac() {
    printf '%s' "$1" | tr -d ':-' | tr '[:lower:]' '[:upper:]'
}

resolve_device() {
    local iface_name="$1"
    local dev=""

    [ -n "$iface_name" ] || return 1

    dev=$(/sbin/uci -q get "network.$iface_name.device")
    [ -n "$dev" ] || dev=$(/sbin/uci -q get "network.$iface_name.ifname")
    [ -n "$dev" ] || dev=$(ifstatus "$iface_name" 2>/dev/null | jsonfilter -e '@["l3_device"]')
    [ -n "$dev" ] || dev=$(ifstatus "$iface_name" 2>/dev/null | jsonfilter -e '@["device"]')

    [ -n "$dev" ] || return 1
    printf '%s' "$dev"
}

resolve_ipv4_address() {
    local dev="$1"
    local ipv4=""

    ipv4=$(ip -4 addr show dev "$dev" 2>/dev/null | awk '/inet / {print $2; exit}' | cut -d/ -f1)
    [ -n "$ipv4" ] || ipv4=$(ifconfig "$dev" 2>/dev/null | awk '/inet / {print $2}' | sed 's/addr://')

    [ -n "$ipv4" ] || return 1
    printf '%s' "$ipv4"
}

resolve_ipv6_address() {
    local iface_name="$1"
    local dev=""
    local ipv6=""

    dev=$(resolve_device "$iface_name") || return 1
    ipv6=$(ip -6 addr show dev "$dev" scope global 2>/dev/null | awk '/inet6 / {print $2}' | cut -d/ -f1 | grep -v '^fe80:' | head -n1)

    [ -n "$ipv6" ] || return 1
    printf '%s' "$ipv6"
}

current_user_agent() {
    if [ "$UA_TYPE" = "pc" ]; then
        printf '%s' "$PC_UA"
    else
        printf '%s' "$MOBILE_UA"
    fi
}

current_term_type() {
    if [ "$UA_TYPE" = "pc" ]; then
        printf '1'
    else
        printf '2'
    fi
}

current_operator() {
    if [ "$UA_TYPE" = "pc" ]; then
        printf '0'
    else
        printf '1'
    fi
}

current_login_account() {
    printf ',%s,%s' "$(current_operator)" "$WLAN_USER_ACCOUNT"
}

curl_jsonp() {
    local url="$1"
    shift

    mwan3 use "$INTERFACE" curl -fsS --connect-timeout 8 --max-time 15 -G "$url" "$@"
}

parse_result_code() {
    local json="$1"
    local result

    result=$(json_value "$json" '@.result')
    [ -n "$result" ] || result=$(printf '%s' "$json" | sed -n 's/.*"result"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p' | head -n1)
    printf '%s' "$result"
}

parse_ret_code() {
    local json="$1"
    local ret_code

    ret_code=$(json_value "$json" '@.ret_code')
    [ -n "$ret_code" ] || ret_code=$(printf '%s' "$json" | sed -n 's/.*"ret_code"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p' | head -n1)
    printf '%s' "$ret_code"
}

check_status() {
    local response
    local json
    local result
    local status_url="https://${DEFAULT_HOST}:${DEFAULT_HTTPS_PORT}/eportal/portal/online_list"

    response=$(curl_jsonp "$status_url" \
        --data-urlencode "callback=$(callback_name)" \
        --data-urlencode "user_account=" \
        --data-urlencode "user_password=" \
        --data-urlencode "wlan_user_mac=$WLAN_USER_MAC" \
        --data-urlencode "wlan_user_ip=$WLAN_USER_IP_B64" \
        --data-urlencode "wlan_user_ipv6=$WLAN_USER_IPV6_B64" \
        --data-urlencode "jsVersion=$DEFAULT_STATUS_JS_VERSION" \
        --data-urlencode "v=$(random_v)" \
        --data-urlencode "lang=$DEFAULT_LANG") || {
            log 2 "状态检查请求失败"
            return 3
        }

    json=$(strip_jsonp "$response")
    result=$(parse_result_code "$json")

    case "$result" in
        1)
            log 1 "当前已认证，无需重复登录"
            return 0
            ;;
        0)
            log 1 "当前未认证，继续登录流程..."
            return 1
            ;;
        *)
            log 2 "状态检查失败，响应: ${json:-$response}"
            return 3
            ;;
    esac
}

do_login() {
    local response
    local json
    local result
    local ret_code
    local login_url="https://${DEFAULT_HOST}:${DEFAULT_HTTPS_PORT}/eportal/portal/login"
    local term_type
    local login_account

    term_type=$(current_term_type)
    login_account=$(current_login_account)

    log 1 "尝试登录 ($UA_TYPE UA)，使用IP: $WLAN_USER_IP, IPv6: ${WLAN_USER_IPV6:-none}"

    response=$(curl_jsonp "$login_url" \
        --data-urlencode "callback=$(callback_name)" \
        --data-urlencode "login_method=1" \
        --data-urlencode "user_account=$login_account" \
        --data-urlencode "user_password=$WLAN_USER_PASSWORD" \
        --data-urlencode "wlan_user_ip=$WLAN_USER_IP" \
        --data-urlencode "wlan_user_ipv6=$WLAN_USER_IPV6" \
        --data-urlencode "wlan_user_mac=$WLAN_USER_MAC" \
        --data-urlencode "wlan_ac_ip=" \
        --data-urlencode "wlan_ac_name=" \
        --data-urlencode "term_ua=$(current_user_agent)" \
        --data-urlencode "term_type=$term_type" \
        --data-urlencode "jsVersion=$DEFAULT_ACTION_JS_VERSION" \
        --data-urlencode "terminal_type=$term_type" \
        --data-urlencode "v=$(random_v)" \
        --data-urlencode "lang=zh-cn" \
        --data-urlencode "lang=$DEFAULT_LANG") || {
            log 2 "登录请求失败"
            return 1
        }

    json=$(strip_jsonp "$response")
    result=$(parse_result_code "$json")
    ret_code=$(parse_ret_code "$json")

    if [ "$result" = "1" ]; then
        log 1 "登录成功！响应: $json IP: $WLAN_USER_IP IPv6: ${WLAN_USER_IPV6:-none}"
        return 0
    fi

    if [ "$ret_code" = "2" ]; then
        log 1 "当前已在线，响应: $json IP: $WLAN_USER_IP IPv6: ${WLAN_USER_IPV6:-none}"
        return 2
    fi

    log 2 "登录失败！响应: ${json:-$response}"
    return 1
}

main() {
    local physical_interface=""

    if [ -z "$INTERFACE" ] || [ -z "$WLAN_USER_ACCOUNT" ] || [ -z "$WLAN_USER_PASSWORD" ]; then
        log 2 "错误: 缺少必要的参数 --mwan3, --account, 或 --password"
        exit 4
    fi

    if ! command_exists mwan3 || ! command_exists curl || ! command_exists jsonfilter; then
        log 2 "错误: 缺少 mwan3、curl 或 jsonfilter 依赖"
        exit 5
    fi

    physical_interface=$(resolve_device "$INTERFACE") || {
        log 2 "错误: 无法解析逻辑接口 '$INTERFACE' 的设备名"
        exit 6
    }

    WLAN_USER_IP=$(resolve_ipv4_address "$physical_interface") || {
        log 2 "错误: 无法获取接口 '$physical_interface' 的 IPv4 地址"
        exit 6
    }

    WLAN_USER_MAC=$(cat "/sys/class/net/$physical_interface/address" 2>/dev/null)
    WLAN_USER_MAC=$(normalize_mac "${WLAN_USER_MAC:-$DEFAULT_ZERO_MAC}")
    [ -n "$WLAN_USER_MAC" ] || WLAN_USER_MAC="$DEFAULT_ZERO_MAC"

    WLAN_USER_IPV6=""
    if [ -n "$V6FACE" ]; then
        WLAN_USER_IPV6=$(resolve_ipv6_address "$V6FACE" || true)
        if [ -n "$WLAN_USER_IPV6" ]; then
            log 0 "检测到 IPv6 地址: $WLAN_USER_IPV6"
        fi
    fi

    WLAN_USER_IP_B64=$(base64_encode "$WLAN_USER_IP") || {
        log 2 "错误: 无法对 IPv4 地址进行 Base64 编码"
        exit 7
    }
    WLAN_USER_IPV6_B64=$(base64_encode "$WLAN_USER_IPV6") || WLAN_USER_IPV6_B64=""

    check_status
    case $? in
        0)
            if [ "$CHECK_ONLY" -eq 1 ]; then
                exit 0
            fi
            exit 2
            ;;
        1)
            if [ "$CHECK_ONLY" -eq 1 ]; then
                exit 1
            fi

            do_login
            case $? in
                0) exit 0 ;;
                2) exit 2 ;;
                *) exit 1 ;;
            esac
            ;;
        *)
            exit 3
            ;;
    esac
}

main

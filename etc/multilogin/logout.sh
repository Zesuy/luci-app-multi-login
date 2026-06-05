#!/bin/sh

INTERFACE=""
V6FACE=""
WLAN_USER_ACCOUNT=""
LOG_LEVEL=1

DEFAULT_HOST="login.cqu.edu.cn"
DEFAULT_HTTPS_PORT="802"
DEFAULT_ACTION_JS_VERSION="4.2.2"
DEFAULT_LANG="zh"
DEFAULT_ZERO_MAC="000000000000"

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
        logger -t "multi_logout_sh" -p "user.$(echo "$level_text" | tr '[:upper:]' '[:lower:]')" "$log_msg"
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

check_logout() {
    local url="https://${DEFAULT_HOST}:${DEFAULT_HTTPS_PORT}/eportal/portal/custom/checkLogout"
    local response
    local json
    local result

    response=$(curl_jsonp "$url" \
        --data-urlencode "callback=$(callback_name)" \
        --data-urlencode "wlan_user_ip=$WLAN_USER_IP" \
        --data-urlencode "wlan_user_ipv6=$WLAN_USER_IPV6" \
        --data-urlencode "jsVersion=$DEFAULT_ACTION_JS_VERSION" \
        --data-urlencode "v=$(random_v)" \
        --data-urlencode "lang=$DEFAULT_LANG") || {
            log 2 "注销检查请求失败"
            return 1
        }

    json=$(strip_jsonp "$response")
    result=$(parse_result_code "$json")
    CHECK_LOGOUT_JSON="$json"

    case "$result" in
        1)
            log 1 "注销检查通过，响应: $json"
            return 0
            ;;
        *)
            log 2 "注销检查失败，响应: ${json:-$response}"
            return 1
            ;;
    esac
}

do_unbind() {
    local url="https://${DEFAULT_HOST}:${DEFAULT_HTTPS_PORT}/eportal/portal/mac/unbind"
    local response
    local json
    local result

    response=$(curl_jsonp "$url" \
        --data-urlencode "callback=$(callback_name)" \
        --data-urlencode "user_account=$WLAN_USER_ACCOUNT" \
        --data-urlencode "wlan_user_mac=$WLAN_USER_MAC" \
        --data-urlencode "wlan_user_ip=$WLAN_USER_IP" \
        --data-urlencode "wlan_user_ipv6=$WLAN_USER_IPV6" \
        --data-urlencode "jsVersion=$DEFAULT_ACTION_JS_VERSION" \
        --data-urlencode "v=$(random_v)" \
        --data-urlencode "lang=$DEFAULT_LANG") || {
            log 2 "解绑请求失败"
            return 1
        }

    json=$(strip_jsonp "$response")
    result=$(parse_result_code "$json")
    UNBIND_JSON="$json"

    case "$result" in
        1)
            log 1 "解绑成功，响应: $json"
            return 0
            ;;
        *)
            log 2 "解绑失败，响应: ${json:-$response}"
            return 1
            ;;
    esac
}

main() {
    local physical_interface=""

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
            --password|--ua-type)
                shift 2
                ;;
            *)
                shift
                ;;
        esac
    done

    if [ -z "$INTERFACE" ] || [ -z "$WLAN_USER_ACCOUNT" ]; then
        log 2 "错误: 缺少必要参数 --mwan3 或 --account"
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
    fi

    log 1 "尝试注销，IP: $WLAN_USER_IP, IPv6: ${WLAN_USER_IPV6:-none}, MAC: $WLAN_USER_MAC"

    check_logout || exit 1
    do_unbind || exit 1
    exit 0
}

main "$@"

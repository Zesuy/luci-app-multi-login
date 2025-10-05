#!/bin/sh

# 解析命令行参数
INTERFACE=""
WLAN_USER_ACCOUNT=""
WLAN_USER_PASSWORD=""
UA_TYPE="mobile"  # 默认使用mobile UA
LOG_LEVEL=1 # 默认日志等级 INFO (0=DEBUG, 1=INFO, 2=ERROR)

# 参数解析
while [ $# -gt 0 ]; do
    case $1 in
        --mwan3)
            INTERFACE="$2"
            shift 2
            ;;
        --account)
            WLAN_USER_ACCOUNT="$2"
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
        *)
            shift
            ;;
    esac
done

# 日志函数
# LOG_LEVEL: 0=DEBUG, 1=INFO, 2=ERROR
log() {
    local level_num=$1
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
        # Also send to syslog
        level_text_lower=$(echo "$level_text" | tr '[:upper:]' '[:lower:]')
        logger -t "multi_login_sh" -p user.${level_text_lower} "$log_msg"
        echo "$log_msg"
    fi
}

# 检查必需参数
if [ -z "$INTERFACE" ] || [ -z "$WLAN_USER_ACCOUNT" ] || [ -z "$WLAN_USER_PASSWORD" ]; then
    log 2 "错误: 缺少必要的参数 --mwan3, --account, 或 --password"
    exit 4
fi

# 通过逻辑接口名获取物理接口名

PHYSICAL_INTERFACE=$(/sbin/uci get network.$INTERFACE.device)
if [ -z "$PHYSICAL_INTERFACE" ]; then
    # 只有当变量真的为空时，才认为是失败
    log 2 "错误: 无法通过uci获取接口 '$INTERFACE' 的物理设备名称 (device)"
    exit 5
fi
log 0 "调试: 逻辑接口 '$INTERFACE' 对应的物理接口是 '$PHYSICAL_INTERFACE'"
# 获取当前的 MAC 地址和 IP 地址
WLAN_USER_MAC=$(cat /sys/class/net/$PHYSICAL_INTERFACE/address)
WLAN_USER_IP=$(ifconfig $PHYSICAL_INTERFACE | grep 'inet ' | awk '{print $2}' | sed 's/addr://')

if [ -z "$WLAN_USER_IP" ]; then
    log 2 "错误: 无法获取接口 '$PHYSICAL_INTERFACE' 的IP地址"
    exit 6
fi

# 定义编码后的UA参数
PC_UA="Mozilla%2F5.0%20(Windows%20NT%2010.0%3B%20Win64%3B%20x64)%20AppleWebKit%2F537.36%20(KHTML%2C%20like%20Gecko)%20Chrome%2F134.0.0.0%20Safari%2F537.36"
MOBILE_UA="Mozilla%2F5.0%20%28Linux%3B%20U%3B%20Android%2011%3B%20zh-cn%3B%20MI%209%20Build%2FRKQ1.200826.002%29%20AppleWebKit%2F537.36%20%28KHTML%2C%20likeGecko%29%20Version%2F4.0%20Mobile%20Safari%2F537.36%20MQQBrowser%2F11.9"

# 检查当前认证状态的函数
check_status() {
    local status_url="http://10.254.7.4/drcom/chkstatus?callback=dr1002&jsVersion=4.X&v=5505&lang=zh"
    local response=$(mwan3 use $INTERFACE curl -s "$status_url")
    
    # 提取JSON中的result字段
    local result=$(echo "$response" | grep -o '"result":[0-9]' | cut -d':' -f2)
    
    if [ "$result" = "1" ]; then
        log 0 "当前已认证，无需重复登录"
        return 0
    elif [ "$result" = "0" ]; then
        log 1 "当前未认证，继续登录流程..."
        return 1
    else
        log 2 "状态检查失败，响应: $response"
        return 2
    fi
}

# 执行登录函数
do_login() {
    # 根据UA类型选择URL和参数
    if [ "$UA_TYPE" = "pc" ]; then
        local LOGIN_URL="http://10.254.7.4:801/eportal/portal/login?callback=dr1004&login_method=1&user_account=%2C0%2C$WLAN_USER_ACCOUNT&user_password=$WLAN_USER_PASSWORD&wlan_user_ip=$WLAN_USER_IP&wlan_user_ipv6=&wlan_user_mac=$WLAN_USER_MAC&wlan_ac_ip=&wlan_ac_name=&ua=$PC_UA&term_type=1&jsVersion=4.2&terminal_type=1&lang=zh-cn&v=9875&lang=zh"
    else
        local LOGIN_URL="http://10.254.7.4:801/eportal/portal/login?callback=dr1005&login_method=1&user_account=%2C1%2C$WLAN_USER_ACCOUNT&user_password=$WLAN_USER_PASSWORD&wlan_user_ip=$WLAN_USER_IP&wlan_user_ipv6=&wlan_user_mac=$WLAN_USER_MAC&wlan_ac_ip=&wlan_ac_name=&ua=$MOBILE_UA&term_type=2&jsVersion=4.2&terminal_type=2&lang=zh-cn&v=7090&lang=zh"
    fi
    
    log 1 "尝试登录 ($UA_TYPE UA)，使用IP: $WLAN_USER_IP, MAC: $WLAN_USER_MAC"
    local response=$(mwan3 use $INTERFACE curl -s "$LOGIN_URL")
    
    local json_response=$(echo "$response" | grep -o '{.*}')
    
    if [ -n "$json_response" ]; then
        if echo "$json_response" | grep -q '"result":1'; then
            log 1 "登录成功！响应: $json_response IP: $WLAN_USER_IP"
            return 0
        else
            log 2 "登录失败！响应: $json_response"
            return 1
        fi
    else
        log 2 "无法解析响应: $response"
        return 1
    fi
}

# 主执行流程
main() {
    check_status
    case $? in
        0)  # 已认证
            exit 2
            ;;
        1)  # 未认证
            if do_login; then
                exit 0
            else
                exit 1
            fi
            ;;
        *)  # 检查失败
            exit 3
            ;;
    esac
}

# 执行主函数
main

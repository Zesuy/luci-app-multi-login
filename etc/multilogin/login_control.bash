#!/bin/bash

#实现逻辑:
# 1. 通过uci配置加载多个登录实例，每个实例包含逻辑接口名、账号、密码、UA类型等信息
# 2. 主循环中检查每个实例对应的接口状态，如果离线则调用登录脚本尝试登录
# 3. luci app 的目的是：使用用户友好的界面方便用户输入配置项，并将配置保存到uci中。维护当前login_control脚本的运行和终止。
# 4. 通过luci app修改uci配置后，luci app会重启login_control脚本以应用新的配置。
# 5. luci app会维护两个shell编辑窗口，方便高级用户编辑当前login_control脚本和login.sh脚本。
# 6. 处理逻辑：获取mwan3 interfaces的输出，存进logical_interfaces数组中。然后遍历每个接口，检查是否离线。对每个离线的接口尝试获取uci配置的接口来登陆，如果uci接口没有配置则跳过。
# 如果uci中配置了，但实际上mwan3中没有这个接口，则完全没有报错并跳过。
# 7. 每个接口有独立的延迟时间，初始为4秒，登录失败后指数增长，最大16384秒。登录成功或在线后重置为4秒(默认配置，可以由配置文件更改)。


# 登录脚本路径,这个在luci app中会自动配置，先写在这
LOGIN_SCRIPT_PATH="/etc/multilogin/login.sh"

# 全局参数 (将由UCI配置覆盖)
INITIAL_RETRY_DELAY=4
MAX_RETRY_DELAY=16384
ALREADY_LOGGED_DELAY=16
MAIN_LOOP_SLEEP=5

# 日志函数增强
log() {
  local level=$1
  local message=$2
  
  # 可以根据UCI中的log_level来决定是否输出
  case "$level" in
    "debug")
      # 在生产环境中可以注释掉 return 来启用debug日志
      return
      ;;
    "info"|"notice"|"warning"|"error")
      logger -t "multi_login[$$]" -p "user.$level" "[$level] $message"
      ;;
    *)
      logger -t "multi_login[$$]" -p "user.info" "[unknown] $message"
      ;;
  esac
}

# 登录函数
login_interface() {
  local logical_interface=$1
  local account=$2
  local password=$3
  local ua_type=$4
  local login_script=$5
  local delay_var=$6

  eval "current_delay=\${$delay_var}"

  [ -f "$login_script" ] || {
    log "error" "$logical_interface 错误：登录脚本 '$login_script' 未找到"
    return 3
  }

  # 执行登录脚本并传递参数
  sh "$login_script" --mwan3 "$logical_interface" --account "$account" --password "$password" --ua-type "$ua_type" >/tmp/login_output_$logical_interface 2>&1
  local login_result=$?
  local login_output=$(cat /tmp/login_output_$logical_interface)
  rm -f /tmp/login_output_$logical_interface

  case $login_result in
    0)
      new_delay=$INITIAL_RETRY_DELAY
      eval "$delay_var=$new_delay"
      log "notice" "$logical_interface 登录成功 - 重置延迟为 $new_delay 秒"
      log "debug" "登录输出: $login_output"
      return 0
      ;;
    1)
      new_delay=$(( current_delay * 2 ))
      [ $new_delay -gt $MAX_RETRY_DELAY ] && new_delay=$MAX_RETRY_DELAY
      eval "$delay_var=$new_delay"
      log "warning" "$logical_interface 登录失败 - 下次延迟为 $new_delay 秒"
      log "debug" "失败输出: $login_output"
      return 1
      ;;
    2)
      eval "$delay_var=$ALREADY_LOGGED_DELAY"
      log "info" "$logical_interface 已登录状态 - 设置固定延迟 $ALREADY_LOGGED_DELAY 秒"
      return 2
      ;;
    *)
      log "error" "$logical_interface 未知返回码 $login_result"
      log "debug" "完整输出: $login_output"
      return 3
      ;;
  esac
}

# 主程序
main() {
  # 检查 mwan3 是否存在
  if ! command -v mwan3 >/dev/null 2>&1; then
    log "error" "错误: mwan3 未安装或不在 PATH 中。此脚本依赖 mwan3，无法继续执行。"
    exit 1
  fi

  # 从UCI加载全局设置
  if ! uci get multilogin.@settings[0] >/dev/null 2>&1; then
    log "error" "UCI配置 'multilogin' 未找到或全局设置缺失。"
    exit 1
  fi
  
  local global_enabled=$(uci get multilogin.@settings[0].enabled)
  if [ "$global_enabled" != "1" ]; then
    log "notice" "多拨登录功能已在全局设置中禁用，正在退出。"
    exit 0
  fi

  # 使用uci的值覆盖默认值
  INITIAL_RETRY_DELAY=$(uci get multilogin.@settings[0].retry_interval 2>/dev/null || echo $INITIAL_RETRY_DELAY)
  MAIN_LOOP_SLEEP=$(uci get multilogin.@settings[0].check_interval 2>/dev/null || echo $MAIN_LOOP_SLEEP)
  MAX_RETRY_DELAY=$(uci get multilogin.@settings[0].max_retry_delay 2>/dev/null || echo $MAX_RETRY_DELAY)
  ALREADY_LOGGED_DELAY=$(uci get multilogin.@settings[0].already_logged_delay 2>/dev/null || echo $ALREADY_LOGGED_DELAY)

  local logical_interfaces=()
  local accounts=()
  local passwords=()
  local ua_types=()
  local scripts=()
  local delays=()

  # 使用uci-show解析配置并加载实例
  uci show multilogin | grep "multilogin\..*='instance'" | sed "s/multilogin\.\(.*\)\.=.*/\1/" | while read -r section_name; do
    local enabled=$(uci get multilogin."$section_name".enabled 2>/dev/null)
    [ "$enabled" != "1" ] && continue

    local logical_interface=$(uci get multilogin."$section_name".interface)
    local account=$(uci get multilogin."$section_name".username)
    local password=$(uci get multilogin."$section_name".password)
    local ua_type=$(uci get multilogin."$section_name".ua_type)
    
    # 检查必须的参数是否存在
    if [ -z "$logical_interface" ] || [ -z "$account" ] || [ -z "$password" ] || [ -z "$ua_type" ]; then
      log "warning" "实例 '$section_name' 配置不完整，已跳过。"
      continue
    fi
    
    logical_interfaces+=("$logical_interface")
    accounts+=("$account")
    passwords+=("$password")
    ua_types+=("$ua_type")
    scripts+=("$LOGIN_SCRIPT_PATH") # 使用统一的登录脚本
    
    eval "delay_$logical_interface=$INITIAL_RETRY_DELAY"
    delays+=("delay_$logical_interface")
  done

  if [ ${#logical_interfaces[@]} -eq 0 ]; then
    log "notice" "没有找到任何已启用的登录实例，程序退出。"
    exit 0
  fi

  log "info" "启动多WAN口自动登录守护进程 (PID: $$)"
  log "debug" "加载接口配置: ${logical_interfaces[@]}"

  # 主循环
 while true; do
    local max_delay=1
    local interface_status=""
    # 获取 mwan3 接口状态
    interface_status=$(mwan3 interfaces 2>/dev/null)
    if [ $? -ne 0 ]; then
        log "warning" "执行 'mwan3 interfaces' 失败，可能 mwan3 服务未运行。将在 $MAIN_LOOP_SLEEP 秒后重试。"
        sleep $MAIN_LOOP_SLEEP
        continue
    fi
    local need_action=false
    
    for ((i=0; i<${#logical_interfaces[@]}; i++)); do
      local logical_interface="${logical_interfaces[i]}"
      local account="${accounts[i]}"
      local password="${passwords[i]}"
      local ua_type="${ua_types[i]}"
      local script="${scripts[i]}"
      local delay_var="${delays[i]}"

      # 检查接口是否离线
      if echo "$interface_status" | grep -qw "interface $logical_interface is offline"; then
        need_action=true
        log "debug" "$logical_interface 检测到离线状态"
        login_interface "$logical_interface" "$account" "$password" "$ua_type" "$script" "$delay_var"
        retval=$?
        
        eval "current_delay=\${$delay_var}"
        [ $current_delay -gt $max_delay ] && max_delay=$current_delay
        
        case $retval in
          0) log "info" "$logical_interface 处理完成: 登录成功" ;;
          1) log "warning" "$logical_interface 处理完成: 登录失败" ;;
          2) log "info" "$logical_interface 处理完成: 已登录却掉线" ;;
          3) log "error" "$logical_interface 处理完成: 脚本错误" ;;
        esac
      else
        eval "$delay_var=$INITIAL_RETRY_DELAY"
        log "debug" "$logical_interface 在线状态正常"
      fi
    done

    if $need_action; then
      log "debug" "本轮检测完成，最大延迟 $max_delay 秒"
      sleep $max_delay
    else
      log "debug" "所有接口正常，休眠 $MAIN_LOOP_SLEEP 秒"
      sleep $MAIN_LOOP_SLEEP
    fi
  done
}

trap 'log "notice" "收到终止信号，退出程序"; exit 0' INT TERM
main

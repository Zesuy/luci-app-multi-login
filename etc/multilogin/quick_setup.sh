#!/bin/sh

# Quick Setup Script for Virtual Interfaces & mwan3
# Usage: /etc/multilogin/quick_setup.sh <base_interface> <count>
# Example: /etc/multilogin/quick_setup.sh eth0 3

BASE_IF=$1
COUNT=$2

if [ -z "$BASE_IF" ] || [ -z "$COUNT" ]; then
    echo "Usage: $0 <base_interface> <count>"
    exit 1
fi

COUNT=$((COUNT))

echo "Starting configuration for $COUNT interfaces based on $BASE_IF..."

# 1. Cleanup existing `auto_` configs
echo "Cleaning up old auto_ configurations..."
for type in network firewall mwan3; do
    uci show $type | grep 'auto_' | awk -F. '{print $2}' | awk -F= '{print $1}' | sort -u | while read -r section; do
        uci -q delete $type."$section"
    done
done

# 2. Add Firewall Zone `wan` mapping if needed (usually we just add to existing wan zone, but UCI makes it tricky if networks list exists)
# Find the wan zone
WAN_ZONE=$(uci show firewall | grep "=zone" | grep -B1 "name='wan'" | awk -F. '{print $2}' | head -n1)
if [ -z "$WAN_ZONE" ]; then
    # Fallback to creating one if not exists, though unlikely
    uci set firewall.wan=zone
    uci set firewall.wan.name='wan'
    uci set firewall.wan.input='REJECT'
    uci set firewall.wan.output='ACCEPT'
    uci set firewall.wan.forward='REJECT'
    uci set firewall.wan.masq='1'
    uci set firewall.wan.mtu_fix='1'
    WAN_ZONE="wan"
fi

# Cleanup old auto_ interfaces from wan zone
for intf in $(uci -q get firewall."$WAN_ZONE".network); do
    case "$intf" in
        auto_*) uci del_list firewall."$WAN_ZONE".network="$intf" ;;
    esac
done

# Cleanup old auto_ members from balanced policy
for mem in $(uci -q get mwan3.balanced.use_member); do
    case "$mem" in
        auto_*) uci del_list mwan3.balanced.use_member="$mem" ;;
    esac
done

# We'll collect all our new logical interfaces to add them to the wan zone
NEW_INTERFACES=""

# 3. Create Networks, Macvlans, and mwan3 configs
for i in $(seq 1 $COUNT); do
    # Define names
    MACVLAN_DEV="auto_${BASE_IF}_${i}"
    LOGICAL_IF="auto_vwan_${i}"
    MWAN_MEMBER="auto_vwan_${i}_m1_w5"
    METRIC=$((10 + i)) # Assign unique metrics 11, 12, 13...

    # --- NETWORK ---
    # Create macvlan device
    uci set network.$MACVLAN_DEV=device
    uci set network.$MACVLAN_DEV.type='macvlan'
    uci set network.$MACVLAN_DEV.ifname="$BASE_IF"
    uci set network.$MACVLAN_DEV.mode='vepa'

    # Create logical interface
    uci set network.$LOGICAL_IF=interface
    uci set network.$LOGICAL_IF.proto='dhcp'
    uci set network.$LOGICAL_IF.device="$MACVLAN_DEV"
    uci set network.$LOGICAL_IF.metric="$METRIC"
    
    NEW_INTERFACES="$NEW_INTERFACES $LOGICAL_IF"

    # --- MWAN3 ---
    # Tracking interface
    uci set mwan3.$LOGICAL_IF=interface
    uci set mwan3.$LOGICAL_IF.enabled='1'
    uci set mwan3.$LOGICAL_IF.family='ipv4'
    uci set mwan3.$LOGICAL_IF.reliability='1'
    uci set mwan3.$LOGICAL_IF.count='1'
    uci set mwan3.$LOGICAL_IF.timeout='2'
    uci set mwan3.$LOGICAL_IF.interval='5'
    uci set mwan3.$LOGICAL_IF.down='3'
    uci set mwan3.$LOGICAL_IF.up='3'
    uci add_list mwan3.$LOGICAL_IF.track_ip='114.114.114.114'
    uci add_list mwan3.$LOGICAL_IF.track_ip='223.5.5.5'

    # Member
    uci set mwan3.$MWAN_MEMBER=member
    uci set mwan3.$MWAN_MEMBER.interface="$LOGICAL_IF"
    uci set mwan3.$MWAN_MEMBER.metric='1'
    uci set mwan3.$MWAN_MEMBER.weight='5'

    # Add member to 'balanced' policy
    # Ensure policy exists
    uci -q get mwan3.balanced >/dev/null || uci set mwan3.balanced=policy
    uci add_list mwan3.balanced.use_member="$MWAN_MEMBER"
done

# Add interfaces to WAN zone
for intf in $NEW_INTERFACES; do
    uci add_list firewall."$WAN_ZONE".network="$intf"
done

echo "Committing UCI changes..."
uci commit network
uci commit firewall
uci commit mwan3

echo "Reloading services..."
/etc/init.d/network reload
/etc/init.d/firewall reload
/etc/init.d/mwan3 reload

echo "Configuration applied successfully!"
exit 0

#!/bin/sh
# Compatibility CLI: the fixed backend is the sole network/UCI writer.
if [ "$#" -ne 2 ]; then
	printf '%s\n' 'usage: quick_setup.sh <base_interface> <count>' >&2
	exit 1
fi

/usr/libexec/multilogin-config cli quick_setup "$1" "$2"
exit $?

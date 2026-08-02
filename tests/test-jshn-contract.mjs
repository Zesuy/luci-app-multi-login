#!/usr/bin/env node
/* Execute the real OpenWrt SDK JSHN implementation with BusyBox ash.
 * This is deliberately a library-contract test, not an OpenWrt service or
 * rootfs simulation. Set MULTILOGIN_JSHN_ROOT to an SDK staging directory. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.env.MULTILOGIN_JSHN_ROOT || '';
const required = process.env.MULTILOGIN_REQUIRE_JSHN === '1';
const jshnScript = root && path.join(root, 'share/libubox/jshn.sh');
const jshnBin = root && path.join(root, 'bin/jshn');
const busybox = process.env.MULTILOGIN_BUSYBOX || 'busybox';

if (!root || !fs.existsSync(jshnScript) || !fs.existsSync(jshnBin)) {
  if (required) {
    process.stderr.write('real SDK JSHN contract tooling is required but unavailable\n');
    process.exit(1);
  }
  process.stdout.write('SKIP  real SDK JSHN contract tooling unavailable\n');
  process.exit(0);
}

const probe = `
set -e
. "$JSHN_SH"

strict_json_load() {
    jshn -r "$1" >/dev/null 2>&1 || return 1
    json_load "$1"
}

json_init
json_load '{}'
json_get_keys keys ''
if json_get_type missing_type missing; then
    echo 'missing field unexpectedly accepted' >&2
    exit 10
fi
json_get_var missing_value missing ''
[ -z "$missing_value" ] || {
    echo 'missing field default was not applied' >&2
    exit 13
}

json_init
json_load '{"data":{}}'
json_select data
if json_get_type nested_type missing; then
    echo 'missing nested field unexpectedly accepted' >&2
    exit 11
fi
json_get_var nested_value missing ''
[ -z "$nested_value" ] || {
    echo 'missing nested field default was not applied' >&2
    exit 14
}
json_select ..

if "$JSHN_BIN" -r '{' >/dev/null 2>&1; then
    echo 'malformed JSON unexpectedly accepted by jshn' >&2
    exit 12
fi
if strict_json_load '{bad}'; then
    echo 'malformed brace-delimited JSON unexpectedly accepted by strict loader' >&2
    exit 15
fi

json_init
json_add_boolean ok 1
json_add_string code ok
json_add_object data
json_add_string outcome native
json_close_object
json_dump
`;

const result = spawnSync(busybox, ['ash', '-c', probe], {
  env: {
    ...process.env,
    JSHN_SH: jshnScript,
    JSHN_BIN: jshnBin,
    PATH: `${path.dirname(jshnBin)}:${process.env.PATH || ''}`,
  },
  encoding: 'utf8',
  timeout: 5000,
});

assert.equal(result.error, undefined, result.error?.message);
assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
const response = JSON.parse(result.stdout.trim());
assert.deepEqual(response, { ok: true, code: 'ok', data: { outcome: 'native' } });
process.stdout.write('PASS  real SDK JSHN contract: normal, missing, malformed, nested, and repeated-init paths\n');

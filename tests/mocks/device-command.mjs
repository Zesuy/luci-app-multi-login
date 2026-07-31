#!/usr/bin/env node

import process from 'node:process';

const [command, ...args] = process.argv.slice(2);
const settings = {
  interface: process.env.MULTILOGIN_MOCK_INTERFACE ?? 'wan-test',
  v6face: process.env.MULTILOGIN_MOCK_V6FACE ?? 'wan6-test',
  device: process.env.MULTILOGIN_MOCK_DEVICE ?? 'eth-test',
  v6device: process.env.MULTILOGIN_MOCK_V6_DEVICE ?? 'eth6-test',
  ipv4: process.env.MULTILOGIN_MOCK_IPV4 ?? '192.0.2.10',
  ipv6: process.env.MULTILOGIN_MOCK_IPV6 ?? '2001:db8::10',
  mac: process.env.MULTILOGIN_MOCK_MAC ?? '02:00:00:00:00:10',
};

function same(actual, expected) {
  return actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

switch (command) {
  case 'ifstatus': {
    if (process.env.MULTILOGIN_MOCK_NO_DEVICE === '1') {
      process.stdout.write('{}\n');
      break;
    }
    if (same(args, [settings.interface]))
      process.stdout.write(`${JSON.stringify({ l3_device: settings.device })}\n`);
    else if (same(args, [settings.v6face]))
      process.stdout.write(`${JSON.stringify({ l3_device: settings.v6device })}\n`);
    else
      process.exitCode = 1;
    break;
  }
  case 'uci':
    process.exitCode = 1;
    break;
  case 'ip':
    if (same(args, ['-4', 'addr', 'show', 'dev', settings.device]) && process.env.MULTILOGIN_MOCK_NO_IPV4 !== '1')
      process.stdout.write(`2: ${settings.device}    inet ${settings.ipv4}/24 scope global ${settings.device}\n`);
    else if (same(args, ['-6', 'addr', 'show', 'dev', settings.v6device, 'scope', 'global']) && process.env.MULTILOGIN_MOCK_NO_IPV6 !== '1')
      process.stdout.write(`3: ${settings.v6device}    inet6 ${settings.ipv6}/64 scope global\n`);
    else if (same(args, ['link', 'show', 'dev', settings.device]) && process.env.MULTILOGIN_MOCK_NO_MAC !== '1')
      process.stdout.write(`2: ${settings.device}: <UP> mtu 1500\n    link/ether ${settings.mac} brd ff:ff:ff:ff:ff:ff\n`);
    else
      process.exitCode = 1;
    break;
  case 'logger':
  case 'sleep':
    break;
  default:
    process.exitCode = 98;
}

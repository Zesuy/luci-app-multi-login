#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));

function fail(message) {
  process.stderr.write(`fixture check: ${message}\n`);
  process.exitCode = 1;
}

function parseJsonp(source) {
  const match = source.match(/^fixtureCallback\(([\s\S]*)\);?\s*$/);
  if (!match)
    throw new Error('invalid JSONP wrapper');
  return JSON.parse(match[1]);
}

function auditRedaction(name, source) {
  const forbidden = [
    [/\b(?:\d{1,3}\.){3}\d{1,3}\b/, 'IPv4 address'],
    [/(?:[0-9a-f]{2}:){5}[0-9a-f]{2}/i, 'MAC address'],
    [/\b[0-9a-f]{12}\b/i, 'compact MAC address'],
    [/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i, 'email address'],
    [/\b(?:user(?:name|_account|_password)?|password|account_id)\b/i, 'credential field'],
    [/\b\d{8,}\b/, 'long numeric identifier'],
  ];

  for (const [pattern, label] of forbidden) {
    if (pattern.test(source))
      fail(`${name} contains a forbidden ${label}`);
  }
}

function checkSingle(file) {
  const source = fs.readFileSync(file, 'utf8');
  auditRedaction(path.basename(file), source);
  parseJsonp(source);
}

if (process.argv[2] === '--require-valid') {
  if (process.argv.length !== 4) {
    fail('usage: check-fixtures.mjs --require-valid FILE');
  } else {
    try {
      checkSingle(process.argv[3]);
    } catch (error) {
      fail(`${path.basename(process.argv[3])}: ${error.message}`);
    }
  }
} else {
  const fixtureDir = path.resolve(currentDirectory, 'fixtures/portal');
  const manifest = JSON.parse(fs.readFileSync(path.join(fixtureDir, 'manifest.json'), 'utf8'));
  const requiredScenarios = new Set([
    'offline',
    'pc_online',
    'mobile_online',
    'login_success',
    'login_auth_failure',
    'malformed_jsonp',
    'unbind',
    'check_logout',
    'delayed_logout_online_1',
    'delayed_logout_online_2',
    'delayed_logout_offline',
  ]);

  if (manifest.schema !== 1 || !Array.isArray(manifest.fixtures))
    fail('manifest schema is invalid');

  for (const fixture of manifest.fixtures) {
    requiredScenarios.delete(fixture.scenario);
    const file = path.join(fixtureDir, fixture.file);
    if (!fs.existsSync(file)) {
      fail(`manifest file is missing: ${fixture.file}`);
      continue;
    }

    const source = fs.readFileSync(file, 'utf8');
    auditRedaction(fixture.file, source);
    try {
      const payload = parseJsonp(source);
      if (!fixture.valid) {
        fail(`${fixture.file} was expected to be malformed`);
        continue;
      }
      if (payload.result !== fixture.result)
        fail(`${fixture.file} has an unexpected result`);
      if (Object.hasOwn(fixture, 'phone_flag')) {
        if (!Array.isArray(payload.list) || payload.list.length !== 1 || payload.list[0].phone_flag !== fixture.phone_flag)
          fail(`${fixture.file} has an unexpected phone_flag`);
      }
    } catch (error) {
      if (fixture.valid)
        fail(`${fixture.file}: ${error.message}`);
    }
  }

  if (requiredScenarios.size > 0)
    fail(`missing required scenarios: ${[...requiredScenarios].sort().join(', ')}`);
}

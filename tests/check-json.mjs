#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(currentDirectory, '..');
const ignoredDirectories = new Set(['.git', '.codegraph', 'node_modules']);
let failures = 0;

function fail(message) {
  process.stderr.write(`JSON check: ${message}\n`);
  failures += 1;
}

function walk(directory, output = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name))
      continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory())
      walk(fullPath, output);
    else if (entry.isFile() && entry.name.endsWith('.json'))
      output.push(fullPath);
  }
  return output;
}

function requireObject(value, label) {
  if (value === null || Array.isArray(value) || typeof value !== 'object') {
    fail(`${label} must be an object`);
    return false;
  }
  return true;
}

const parsed = new Map();
for (const file of walk(repository).sort()) {
  try {
    parsed.set(path.relative(repository, file), JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch (error) {
    fail(`${path.relative(repository, file)}: ${error.message}`);
  }
}

const menuPath = 'root/usr/share/luci/menu.d/luci-app-multi-login.json';
const menu = parsed.get(menuPath);
if (!requireObject(menu, menuPath)) {
  // Error already recorded.
} else {
  for (const [route, entry] of Object.entries(menu)) {
    if (!route.startsWith('admin/services/multilogin'))
      fail(`${menuPath}: route outside MultiLogin namespace: ${route}`);
    if (!requireObject(entry, `${menuPath}:${route}`))
      continue;
    if (typeof entry.title !== 'string' || entry.title.length === 0)
      fail(`${menuPath}:${route} has no title`);
    if (!requireObject(entry.action, `${menuPath}:${route}.action`))
      continue;
    if (!['alias', 'view'].includes(entry.action.type))
      fail(`${menuPath}:${route} has unsupported action type`);
    if (typeof entry.action.path !== 'string' || entry.action.path.length === 0)
      fail(`${menuPath}:${route} has no action path`);
  }
}

const aclPath = 'root/usr/share/rpcd/acl.d/luci-app-multi-login.json';
const acl = parsed.get(aclPath);
const grant = acl?.['luci-app-multi-login'];
if (requireObject(acl, aclPath) && requireObject(grant, `${aclPath}:grant`)) {
  for (const access of ['read', 'write']) {
    const section = grant[access];
    if (!requireObject(section, `${aclPath}:${access}`))
      continue;
    for (const key of ['uci', 'file']) {
      if (Object.hasOwn(section, key) && (!Array.isArray(section[key]) || section[key].some((item) => typeof item !== 'string')))
        fail(`${aclPath}:${access}.${key} must be an array of strings`);
    }
    if (Object.hasOwn(section, 'ubus') && requireObject(section.ubus, `${aclPath}:${access}.ubus`)) {
      for (const [object, methods] of Object.entries(section.ubus)) {
        if (!Array.isArray(methods) || methods.some((method) => typeof method !== 'string'))
          fail(`${aclPath}:${access}.ubus.${object} must be an array of strings`);
      }
    }
  }
}

if (failures > 0)
  process.exitCode = 1;

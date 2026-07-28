#!/usr/bin/env node
// Load local.env (gitignored) and run webpack dev-server with MM_SERVICESETTINGS_SITEURL.

const fs = require('fs');
const path = require('path');
const {spawn} = require('child_process');

const envPath = path.join(__dirname, '..', 'local.env');
const examplePath = path.join(__dirname, '..', 'local.env.example');

if (!fs.existsSync(envPath)) {
    console.error('Missing local.env');
    console.error(`Copy ${path.basename(examplePath)} → local.env and set MM_SERVICESETTINGS_SITEURL`);
    console.error('See docs/DEV.md');
    process.exit(1);
}

const fileEnv = {};
for (const rawLine of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
        continue;
    }
    const eq = line.indexOf('=');
    if (eq <= 0) {
        continue;
    }
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
    ) {
        value = value.slice(1, -1);
    }
    fileEnv[key] = value;
}

const siteURL = fileEnv.MM_SERVICESETTINGS_SITEURL || process.env.MM_SERVICESETTINGS_SITEURL;
if (!siteURL) {
    console.error('MM_SERVICESETTINGS_SITEURL is empty in local.env');
    console.error('See docs/DEV.md');
    process.exit(1);
}

const child = spawn(
    process.platform === 'win32' ? 'npm.cmd' : 'npm',
    ['run', 'dev-server'],
    {
        cwd: path.join(__dirname, '..'),
        env: {
            ...process.env,
            ...fileEnv,
            MM_SERVICESETTINGS_SITEURL: siteURL,
        },
        stdio: 'inherit',
    },
);

child.on('exit', (code, signal) => {
    if (signal) {
        process.kill(process.pid, signal);
        return;
    }
    process.exit(code || 0);
});

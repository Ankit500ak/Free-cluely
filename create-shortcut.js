p// create-shortcut.js
// Requires: npm install windows-shortcuts
const ws = require('windows-shortcuts');
const path = require('path');
const os = require('os');

const desktop = path.join(os.homedir(), 'Desktop');
const nodePath = process.execPath;
const scriptPath = path.join(__dirname, 'replace.js');
const shortcutPath = path.join(desktop, 'Replace OCR.lnk');

ws.create(shortcutPath, {
    target: nodePath,
    args: scriptPath,
    desc: 'Run Replace OCR Script',
    icon: nodePath
}, function(err) {
    if (err) {
        console.error('Failed to create shortcut:', err);
    } else {
        console.log('Shortcut created on desktop:', shortcutPath);
    }
});

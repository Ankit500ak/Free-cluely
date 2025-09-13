// Standalone script: remove '4' under mouse cursor using screenshot-desktop and tesseract.js
// Requires: npm install screenshot-desktop tesseract.js

const screenshot = require('screenshot-desktop');
const Tesseract = require('tesseract.js');
const { exec } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

function getMousePos() {
    return new Promise((resolve, reject) => {
        const ps = `$pos = [System.Windows.Forms.Cursor]::Position; Write-Output \"$($pos.X),$($pos.Y)\"`;
        const command = `powershell -NoProfile -Command \"Add-Type -AssemblyName System.Windows.Forms; ${ps}\"`;
        exec(command, { shell: true }, (err, stdout) => {
            if (err) return reject(err);
            const [x, y] = (stdout || '').trim().split(',').map(Number);
            resolve({ x, y });
        });
    });
}

function pressKey(key) {
    return new Promise((resolve, reject) => {
        const psCmd = `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${key}');`;
        const command = `powershell -NoProfile -WindowStyle Hidden -Command \"${psCmd.replace(/\"/g, '\\"')}\"`;
        exec(command, { shell: true }, (err) => {
            if (err) return reject(err);
            resolve();
        });
    });
}

async function ocrCharAtMouse() {
    const mouse = await getMousePos();
    const region = { left: mouse.x, top: mouse.y, width: 20, height: 20 };
    const tmpPath = path.join(os.tmpdir(), `ocr_mouse_${Date.now()}.png`);
    try {
        await screenshot({ filename: tmpPath, screen: 0, format: 'png', ...region });
        const { data: { text } } = await Tesseract.recognize(tmpPath, 'eng', { tessedit_char_whitelist: '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ' });
        fs.unlinkSync(tmpPath);
        return (text || '').trim();
    } catch (e) {
        if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
        return '';
    }
}

async function loopDelete4() {
    while (true) {
        let char = await ocrCharAtMouse();
        if (char === '4') {
            await pressKey('{DELETE}');
        } else {
            await pressKey('{RIGHT}');
        }
        await new Promise(r => setTimeout(r, 200));
    }
}

loopDelete4();

const EventEmitter = require('events');

class TypingSimulator extends EventEmitter {
    /**
     * Options:
     *  - delayMs: default delay between keystrokes
     *  - batchMode: if true, sends whole words (faster)
     */
    constructor(options = {}) {
        super();
        this.queue = [];
        this.isRunning = false;
        this.isPaused = false;
        this.currentJob = null;
    this.defaultDelay = 2;
    this.batchMode = false;
    }

    enqueueText(text, delayMs = this.defaultDelay, meta = {}) {
        if (!text) return null;
        const job = { text: String(text), delayMs, meta };
        this.queue.push(job);
        this.emit('queued', job);
        this._ensureRunning();
        return job;
    }

    async typeClipboard(delayMs = this.defaultDelay) {
        // Hide all app windows before typing to ensure focus is on the target app
        try {
            const windowManager = require('./src/managers/window.manager');
            if (windowManager && typeof windowManager.hideAllWindows === 'function') {
                windowManager.hideAllWindows();
            }
        } catch (e) {}
        // Wait a bit for the target app to regain focus
        await new Promise((r) => setTimeout(r, 250));
        const { clipboard } = require('electron');
        const text = clipboard.readText();
        if (!text) return false;
        this.enqueueText(text, delayMs, { source: 'clipboard' });
        return true;
    }

    pause() {
        this.isPaused = true;
        this.emit('paused');
    }

    resume() {
        if (!this.isPaused) return;
        this.isPaused = false;
        this.emit('resumed');
        this._ensureRunning();
    }

    stop() {
        this.queue = [];
        this.isPaused = false;
        this.currentJob = null;
        this.emit('stopped');
    }

    async _ensureRunning() {
        if (this.isRunning || this.isPaused) return;
        this.isRunning = true;
        this.emit('started');

        while (this.queue.length && !this.isPaused) {
            const job = this.queue.shift();
            this.currentJob = job;
            try {
                await this._runJob(job);
                this.emit('job-done', job);
            } catch (e) {
                this.emit('job-error', { job, error: e });
            }
            this.currentJob = null;
        }

        this.isRunning = false;
        this.emit('idle');
    }

    async _runJob(job) {
        const str = job.text;
        if (this.batchMode) {
            // send as words to be faster
            const words = str.split(/(\s+)/);
            for (let i = 0; i < words.length; i++) {
                if (this.isPaused) break;
                await this._sendToken(words[i]);
                this.emit('progress', { job, index: i, token: words[i] });
                if (job.delayMs > 0) await new Promise((r) => setTimeout(r, job.delayMs));
            }
        } else {
            for (let i = 0; i < str.length; i++) {
                if (this.isPaused) break;
                const ch = str[i];
                await this._sendToken(ch);
                this.emit('progress', { job, index: i, char: ch });
                if (job.delayMs > 0) await new Promise((r) => setTimeout(r, job.delayMs));
            }
        }
    }

    _sendToken(token) {
        return new Promise((resolve, reject) => {
            let psKey = token;
            if (psKey === '\n') psKey = '{ENTER}';
            else if (psKey === '\t') psKey = '{TAB}';
            else if (psKey === '\r') return resolve();
            else if (psKey === ' ') psKey = ' ';
            // Escape single quote for PowerShell
            const esc = psKey.replace(/'/g, "''");
            const psCmd = `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${esc}');`;
            const command = `powershell -NoProfile -WindowStyle Hidden -Command \"${psCmd.replace(/\"/g, '\\\"')}\"`;
            require('child_process').exec(command, { shell: true }, (err) => {
                if (err) {
                    console.error(`[TypingSimulator] Error typing token '${token}':`, err);
                    return reject(err);
                }
                resolve();
            });
        });
    }
}

module.exports = TypingSimulator;

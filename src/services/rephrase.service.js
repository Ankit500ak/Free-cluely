const { BrowserWindow } = require('electron');
const logger = require('../core/logger').createServiceLogger('REPHRASE');
const llmService = require('./llm.service');

class RephraseService {
  async rephraseText(text) {
    try {
      logger.info('Rephrasing text:', { text });
      const rephrasedText = await llmService.executeRequest({
        prompt: `Rephrase the following text to ensure no plagiarism:\n\n${text}`,
        maxTokens: 500,
      });
      logger.info('Rephrased text received:', { rephrasedText });
      return rephrasedText;
    } catch (error) {
      logger.error('Failed to rephrase text', { error: error.message });
      throw error;
    }
  }

  async rephraseScreenText() {
    try {
      const focusedWindow = BrowserWindow.getFocusedWindow();
      if (!focusedWindow) {
        throw new Error('No focused window to capture text from.');
      }

      const text = await focusedWindow.webContents.executeJavaScript(
        'window.getSelection ? window.getSelection().toString() : ""'
      );

      if (!text) {
        throw new Error('No text selected on the screen.');
      }

      return await this.rephraseText(text);
    } catch (error) {
      logger.error('Failed to rephrase screen text', { error: error.message });
      throw error;
    }
  }
}

module.exports = new RephraseService();

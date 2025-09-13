// Web Speech API service - free alternative to Azure Speech
const { EventEmitter } = require('events');
const logger = require('../core/logger').createServiceLogger('WEB_SPEECH');

class WebSpeechService extends EventEmitter {
  constructor() {
    super();
    this.recognition = null;
    this.isRecording = false;
    this.available = false;
    this.sessionStartTime = null;
    
    this.checkAvailability();
  }

  checkAvailability() {
    // Web Speech API is available in Electron renderer process
    // We'll communicate with renderer via IPC
    this.available = true; // Assume available, check in renderer
    logger.info('Web Speech API service initialized');
    this.emit('status', 'Web Speech API ready (browser-based)');
  }

  startRecording() {
    if (this.isRecording) {
      logger.warn('Recording already in progress');
      return;
    }

    this.sessionStartTime = Date.now();
    this.isRecording = true;
    
    logger.info('Starting Web Speech API recognition');
    this.emit('recording-started');

    // Send message to renderer to start Web Speech API
    if (global.windowManager) {
      global.windowManager.sendToRenderer('start-web-speech');
    }
  }

  stopRecording() {
    if (!this.isRecording) {
      return;
    }

    this.isRecording = false;
    const sessionDuration = this.sessionStartTime ? Date.now() - this.sessionStartTime : 0;
    
    logger.info('Stopping Web Speech API recognition', { 
      sessionDuration: `${sessionDuration}ms` 
    });

    this.emit('recording-stopped');
    
    // Send message to renderer to stop Web Speech API
    if (global.windowManager) {
      global.windowManager.sendToRenderer('stop-web-speech');
    }
  }

  // Handle messages from renderer process
  handleRendererMessage(event, data) {
    switch (event) {
      case 'web-speech-interim':
        this.emit('interim-transcription', data.text);
        break;
      case 'web-speech-final':
        this.emit('transcription', data.text);
        logger.info('Web Speech transcription received', {
          text: data.text,
          confidence: data.confidence
        });
        break;
      case 'web-speech-error':
        logger.error('Web Speech error', { error: data.error });
        this.emit('error', data.error);
        this.isRecording = false;
        break;
      case 'web-speech-not-supported':
        this.available = false;
        this.emit('error', 'Web Speech API not supported in this browser');
        break;
      case 'voice-question-detected':
        logger.info('Voice question detected from renderer', { 
          text: data.text, 
          source: data.source 
        });
        // Forward to main app for processing
        if (global.windowManager) {
          global.windowManager.broadcastToAllWindows('voice-question-detected', data);
        }
        break;
    }
  }

  async recognizeFromFile(audioFilePath) {
    throw new Error('File recognition not supported with Web Speech API');
  }

  getStatus() {
    return {
      isRecording: this.isRecording,
      isInitialized: this.available,
      sessionDuration: this.sessionStartTime ? Date.now() - this.sessionStartTime : 0,
      retryCount: 0,
      type: 'Web Speech API'
    };
  }

  async testConnection() {
    return { 
      success: this.available, 
      message: this.available ? 'Web Speech API available' : 'Web Speech API not supported' 
    };
  }

  isAvailable() {
    return this.available;
  }
}

module.exports = new WebSpeechService();

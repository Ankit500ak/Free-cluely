// Web Speech API client-side implementation - Optimized for fast question detection
class WebSpeechClient {
  constructor() {
    this.recognition = null;
    this.isRecording = false;
    this.isSupported = false;
    this.finalTranscript = '';
    this.interimTranscript = '';
    this.silenceTimer = null;
    this.lastSpeechTime = 0;
    this.questionAccumulator = '';
    this.isProcessing = false;
    
    // Optimized settings for faster detection
    this.SILENCE_THRESHOLD = 2000; // 2 seconds of silence to trigger processing
    this.MIN_QUESTION_LENGTH = 8; // Minimum characters for a valid question
    this.PROCESSING_DEBOUNCE = 500; // Prevent multiple processing calls
    
    this.checkSupport();
    this.setupIPC();
  }

  checkSupport() {
    // Check for Web Speech API support
    this.isSupported = 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window;
    
    if (!this.isSupported) {
      console.warn('Web Speech API not supported in this browser');
      window.electronAPI?.sendToMain('web-speech-not-supported');
      return;
    }

    // Initialize speech recognition
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    this.recognition = new SpeechRecognition();
    
    // Optimize for fast, continuous recognition
    this.recognition.continuous = true;
    this.recognition.interimResults = true;
    this.recognition.lang = 'en-US';
    this.recognition.maxAlternatives = 1;
    
    // Reduce delays for faster response
    this.recognition.serviceURI = '';
    
    this.setupEventHandlers();
    this.checkMicrophonePermission();
    console.log('🎤 Fast Web Speech API initialized - checking microphone permissions...');
  }

  async checkMicrophonePermission() {
    try {
      // Check if navigator.permissions is available
      if (navigator.permissions && navigator.permissions.query) {
        const permission = await navigator.permissions.query({ name: 'microphone' });
        console.log('🎤 Microphone permission status:', permission.state);
        
        if (permission.state === 'granted') {
          console.log('✅ Microphone permission already granted!');
        } else if (permission.state === 'prompt') {
          console.log('⚠️ Microphone permission will be requested when needed');
        } else {
          console.log('❌ Microphone permission denied');
          this.showPermissionHelp();
        }
      } else {
        console.log('⚠️ Permission API not available, will request when needed');
      }
    } catch (error) {
      console.log('Permission check failed:', error.message);
    }
  }

  showPermissionHelp() {
    const helpMessage = `
    🎤 MICROPHONE PERMISSION NEEDED:
    
    To use voice recognition, please:
    1. Click the microphone button
    2. When prompted, click "Allow" for microphone access
    3. If blocked, check your browser/system microphone settings
    
    💡 This permission is required for Web Speech API to work.
    `;
    console.log(helpMessage);
  }

  setupEventHandlers() {
    if (!this.recognition) return;

    this.recognition.onstart = () => {
      console.log('🎤 LISTENING: Speak your question now...');
      this.isRecording = true;
      this.finalTranscript = '';
      this.interimTranscript = '';
      this.questionAccumulator = '';
      this.lastSpeechTime = Date.now();
      this.isProcessing = false;
    };

    this.recognition.onresult = (event) => {
      this.lastSpeechTime = Date.now(); // Update last speech time
      
      let latestInterim = '';
      let newFinal = '';

      // Process all results
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript.trim();
        const confidence = event.results[i][0].confidence;

        if (event.results[i].isFinal) {
          newFinal += transcript + ' ';
          console.log('✅ Final text:', transcript);
          
          // Add to question accumulator
          this.questionAccumulator += transcript + ' ';
          
          // Send final result immediately
          window.electronAPI?.sendToMain('web-speech-final', {
            text: transcript,
            confidence: confidence || 0.9
          });
          
        } else {
          latestInterim = transcript; // Only keep the latest interim
          
          // Send interim result for real-time feedback
          window.electronAPI?.sendToMain('web-speech-interim', {
            text: transcript
          });
        }
      }

      // Update transcripts
      if (newFinal) {
        this.finalTranscript += newFinal;
      }
      this.interimTranscript = latestInterim;

      // Start/reset silence detection timer
      this.startSilenceDetection();
    };

    this.recognition.onerror = (event) => {
      console.error('🚨 Speech error:', event.error);
      
      // Handle different error types
      switch (event.error) {
        case 'no-speech':
          // Don't treat this as error, just continue
          console.log('⏸️ No speech detected, waiting...');
          return;
        case 'audio-capture':
          this.showError('🎤 Microphone access failed. Please check microphone permissions and try again.');
          this.showPermissionInstructions();
          break;
        case 'not-allowed':
          this.showError('🚫 Microphone access denied. Please allow microphone permissions and restart.');
          this.showPermissionInstructions();
          break;
        case 'network':
          this.showError('🌐 Network error. Web Speech API requires internet connection.');
          this.showNetworkTroubleshooting();
          break;
        case 'service-not-allowed':
          this.showError('🔒 Speech service not allowed. Please check permissions.');
          this.showPermissionInstructions();
          break;
        case 'bad-grammar':
          console.log('⚠️ Grammar error, restarting recognition...');
          this.restartRecognition();
          return;
        case 'language-not-supported':
          this.showError('🌍 Language not supported. Trying alternative settings...');
          this.tryAlternativeLanguage();
          return;
        default:
          this.showError(`❌ Speech error: ${event.error}`);
          this.showGeneralTroubleshooting();
      }
      
      this.isRecording = false;
    };

    this.recognition.onend = () => {
      console.log('🔇 Recognition ended');
      
      // If we have accumulated text and we're supposed to be recording, process it
      if (this.questionAccumulator.trim() && this.isRecording) {
        this.processAccumulatedQuestion();
      }
      
      // Auto-restart if still supposed to be recording
      if (this.isRecording) {
        console.log('🔄 Auto-restarting recognition...');
        setTimeout(() => {
          if (this.isRecording) {
            this.startRecognition();
          }
        }, 100);
      }
    };
  }

  // Start silence detection timer
  startSilenceDetection() {
    // Clear existing timer
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
    }
    
    // Set new timer
    this.silenceTimer = setTimeout(() => {
      const silenceDuration = Date.now() - this.lastSpeechTime;
      
      if (silenceDuration >= this.SILENCE_THRESHOLD) {
        console.log(`⏳ ${silenceDuration}ms of silence detected - processing question...`);
        this.processAccumulatedQuestion();
      }
    }, this.SILENCE_THRESHOLD);
  }

  // Process accumulated question
  processAccumulatedQuestion() {
    const fullQuestion = this.questionAccumulator.trim();
    
    // Prevent multiple processing
    if (this.isProcessing || fullQuestion.length < this.MIN_QUESTION_LENGTH) {
      return;
    }
    
    this.isProcessing = true;
    
    console.log('🚀 PROCESSING QUESTION:', fullQuestion);
    
    // Clear the accumulator
    this.questionAccumulator = '';
    
    // Send to main process for AI processing
    window.electronAPI?.sendToMain('voice-question-detected', {
      text: fullQuestion,
      timestamp: Date.now(),
      source: 'voice-recognition-auto',
      confidence: 0.9
    });
    
    // Reset processing flag after debounce period
    setTimeout(() => {
      this.isProcessing = false;
    }, this.PROCESSING_DEBOUNCE);
  }

  // Show error message
  showError(message) {
    window.electronAPI?.sendToMain('web-speech-error', { error: message });
  }

  showPermissionInstructions() {
    const instructions = `
    🔧 HOW TO FIX MICROPHONE PERMISSIONS:
    
    1. 🖱️ Click the microphone icon in your browser's address bar
    2. ✅ Select "Always allow" for microphone access
    3. 🔄 Refresh the page or restart the app
    4. 🎤 Try the microphone button again
    
    If still not working:
    - Check Windows microphone privacy settings
    - Ensure your microphone is not used by another app
    - Try running the app as administrator
    `;
    console.log(instructions);
    window.electronAPI?.sendToMain('web-speech-error', { 
      error: 'Please check the console for detailed permission instructions.' 
    });
  }

  showNetworkTroubleshooting() {
    const instructions = `
    🌐 NETWORK ERROR TROUBLESHOOTING:
    
    Web Speech API requires internet connection because it uses Google's servers.
    
    ✅ Solutions:
    1. 🌍 Check your internet connection
    2. 🔄 Try restarting your router/modem
    3. 🚫 Disable VPN if you're using one
    4. 🔒 Check if your firewall is blocking the app
    5. 📡 Try using a different network (mobile hotspot)
    
    💡 Alternative: Consider using Azure Speech SDK for offline capability
    `;
    console.log(instructions);
    window.electronAPI?.sendToMain('web-speech-error', { 
      error: 'Network error: Web Speech API needs internet. Check console for solutions.' 
    });
  }

  showGeneralTroubleshooting() {
    const instructions = `
    🔧 GENERAL SPEECH RECOGNITION TROUBLESHOOTING:
    
    1. 🎤 Test your microphone in other apps
    2. 🔄 Restart the application
    3. 🔊 Check system audio settings
    4. 🌐 Ensure stable internet connection
    5. 🖥️ Try using a different browser
    6. 🛡️ Check antivirus/firewall settings
    
    If problems persist, consider using Azure Speech SDK.
    `;
    console.log(instructions);
  }

  restartRecognition() {
    console.log('🔄 Restarting speech recognition due to recoverable error...');
    
    setTimeout(() => {
      if (this.isRecording) {
        try {
          this.recognition.stop();
          setTimeout(() => {
            if (this.isRecording) {
              this.recognition.start();
            }
          }, 1000);
        } catch (error) {
          console.error('Failed to restart recognition:', error);
        }
      }
    }, 500);
  }

  tryAlternativeLanguage() {
    console.log('🌍 Trying alternative language settings...');
    
    // Try different language configurations
    const altLanguages = ['en-US', 'en-GB', 'en'];
    const currentLang = this.recognition.lang;
    
    for (let lang of altLanguages) {
      if (lang !== currentLang) {
        console.log(`🔄 Switching to language: ${lang}`);
        this.recognition.lang = lang;
        
        setTimeout(() => {
          if (this.isRecording) {
            try {
              this.recognition.start();
            } catch (error) {
              console.error(`Failed to start with language ${lang}:`, error);
            }
          }
        }, 1000);
        break;
      }
    }
  }

  setupIPC() {
    // Listen for messages from main process
    window.electronAPI?.onMainMessage?.((event, data) => {
      switch (event) {
        case 'start-web-speech':
          this.startRecognition();
          break;
        case 'stop-web-speech':
          this.stopRecognition();
          break;
      }
    });
  }

  startRecognition() {
    if (!this.isSupported || !this.recognition) {
      this.showError('Web Speech API not supported');
      return;
    }

    if (this.isRecording) {
      console.warn('⚠️ Already recording');
      return;
    }

    // Check internet connectivity first
    this.checkInternetConnection().then((isOnline) => {
      if (!isOnline) {
        this.showError('🌐 No internet connection. Web Speech API requires internet access.');
        this.showNetworkTroubleshooting();
        return;
      }

      try {
        console.log('🚀 Starting FAST voice recognition...');
        console.log('🎤 TIP: If prompted, please ALLOW microphone access');
        console.log('💡 Speak your question clearly, then pause for 2 seconds');
        
        // Request microphone permission explicitly before starting
        this.requestMicrophonePermission().then(() => {
          this.recognition.start();
        }).catch((error) => {
          console.error('Failed to get microphone permission:', error);
          this.showError('Microphone permission denied. Please allow microphone access.');
          this.showPermissionInstructions();
        });
        
      } catch (error) {
        console.error('Failed to start recognition:', error);
        this.showError(`Failed to start: ${error.message}`);
        this.showPermissionInstructions();
      }
    });
  }

  async checkInternetConnection() {
    try {
      // Try to fetch a small resource to check connectivity
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      
      const response = await fetch('https://www.google.com/favicon.ico', {
        method: 'HEAD',
        signal: controller.signal,
        cache: 'no-cache'
      });
      
      clearTimeout(timeoutId);
      console.log('✅ Internet connection verified');
      return response.ok;
    } catch (error) {
      console.warn('🌐 Internet connectivity check failed:', error.message);
      return false;
    }
  }

  async requestMicrophonePermission() {
    try {
      // Request microphone access using getUserMedia
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      console.log('✅ Microphone permission granted!');
      
      // Stop the stream immediately as we only needed permission
      stream.getTracks().forEach(track => track.stop());
      
      return true;
    } catch (error) {
      console.error('❌ Microphone permission denied:', error);
      throw error;
    }
  }

  stopRecognition() {
    if (!this.recognition) {
      return;
    }

    console.log('⏹️ Stopping voice recognition...');
    this.isRecording = false;
    
    // Clear timers
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
    
    // Process any remaining question
    if (this.questionAccumulator.trim()) {
      this.processAccumulatedQuestion();
    }

    try {
      this.recognition.stop();
    } catch (error) {
      console.error('Failed to stop recognition:', error);
    }
  }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    window.webSpeechClient = new WebSpeechClient();
  });
} else {
  window.webSpeechClient = new WebSpeechClient();
}

// Export for manual initialization
window.WebSpeechClient = WebSpeechClient;

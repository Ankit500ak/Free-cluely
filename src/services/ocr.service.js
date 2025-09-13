const { createWorker } = require('tesseract.js');
const logger = require('../core/logger').createServiceLogger('OCR');

// Optional fast image preprocessing using sharp for better OCR accuracy
let sharpAvailable = false;
let sharp;
try {
  sharp = require('sharp');
  sharpAvailable = true;
} catch (e) {
  logger.warn('sharp not available, continuing without advanced preprocessing');
}

// Create a single persistent worker to reuse across requests
let workerPromise = null;
async function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      // createWorker may return a ready-to-use worker depending on tesseract.js version
      const w = await createWorker('eng');
      // Some versions expose lifecycle methods; call them only if available
      try {
        if (typeof w.load === 'function') await w.load();
        if (typeof w.loadLanguage === 'function') await w.loadLanguage('eng');
        if (typeof w.initialize === 'function') await w.initialize('eng');
        if (typeof w.setParameters === 'function') {
          await w.setParameters({
            tessedit_pageseg_mode: '6', // single uniform block
            tessedit_ocr_engine_mode: '1', // LSTM only
            preserve_interword_spaces: '1'
          });
        }
      } catch (e) {
        logger.debug('Optional worker init skipped or failed', { error: e.message });
      }
      return w;
    })();
  }
  return workerPromise;
}

/**
 * Basic image preprocessing: convert to grayscale, increase contrast, optionally resize
 */
async function preprocessImage(buffer) {
  // default preprocessing: greyscale + normalize for better OCR of text
  // when emojiPreserve is requested we avoid greyscale to keep colored glyphs
  if (!sharpAvailable) return buffer;
  try {
    // default pipeline
    let img = sharp(buffer);
    const metadata = await img.metadata();
    const targetWidth = Math.max(metadata.width || 0, 1600);

    img = img.resize({ width: targetWidth, withoutEnlargement: false }).sharpen().gamma(1.1);

    // apply greyscale/normalize for standard OCR; callers can pass options to skip this
    if (!preprocessImage._skipGreyscale) {
      img = img.greyscale().normalise ? img.normalise() : img.normalize();
    }

    const processed = await img.toBuffer();
    return processed;
  } catch (err) {
    logger.warn('Image preprocessing failed, using original buffer', { error: err.message });
    return buffer;
  }
}

// Heuristic: detect if image is colorful (used as a proxy for presence of emoji)
async function detectColorfulness(buffer) {
  if (!sharpAvailable) return false;
  try {
    // Resize to small thumbnail to analyze color variance cheaply
    const thumb = await sharp(buffer).resize({ width: 100 }).raw().toBuffer({ resolveWithObject: true });
    const { data, info } = thumb;
    const pixels = info.width * info.height;
    if (info.channels < 3) return false;

    let sumR = 0, sumG = 0, sumB = 0;
    for (let i = 0; i < data.length; i += info.channels) {
      sumR += data[i];
      sumG += data[i + 1];
      sumB += data[i + 2];
    }
    const avgR = sumR / pixels;
    const avgG = sumG / pixels;
    const avgB = sumB / pixels;

    // compute average color distance from gray
    let colorfulnessSum = 0;
    for (let i = 0; i < data.length; i += info.channels) {
      const dr = Math.abs(data[i] - avgR);
      const dg = Math.abs(data[i + 1] - avgG);
      const db = Math.abs(data[i + 2] - avgB);
      colorfulnessSum += (dr + dg + db) / 3;
    }
    const avgColorfulness = colorfulnessSum / pixels; // 0-255 roughly

    // threshold: if average deviation is > 10, consider colorful
    return avgColorfulness > 10;
  } catch (e) {
    return false;
  }
}

// Normalize numeric OCR confusions in a token-aware manner
function normalizeNumericTokens(text) {
  if (!text || typeof text !== 'string') return text;
  const mapping = {
    'O': '0',
    'o': '0',
    'l': '1',
    'I': '1',
    'i': '1',
    '|': '1',
    'S': '5',
    's': '5',
    'Z': '2',
    'z': '2',
    'B': '8',
    'b': '6',
    'g': '9',
    'q': '9'
  };

  return text.split(/(\s+|[^\w\d.,:\-\/])/).map((tok) => {
    if (!tok) return tok;
    // quick checks: if token already has many digits, try to correct confusables
    const digitCount = (tok.match(/[0-9]/g) || []).length;
    const letterCount = (tok.match(/[A-Za-z]/g) || []).length;
    const confusableCount = (tok.match(/[OolISZBbgq|]/g) || []).length;

    // apply mapping when token looks numeric-ish: contains digits or many confusables
    if (digitCount > 0 || confusableCount > 0 || (/^[\dOolISZBbgq|.,:\-\/]+$/.test(tok))) {
      let out = '';
      for (let ch of tok) {
        out += (mapping[ch] !== undefined) ? mapping[ch] : ch;
      }
      return out;
    }
    return tok;
  }).join('');
}

async function extractTextFromImage(imageBuffer, mimeType = 'image/png', options = {}) {
  const start = Date.now();
  try {
    // If emoji preservation requested, detect colorfulness and avoid greyscale
    preprocessImage._skipGreyscale = false;
    if (options && options.emojiPreserve) {
      const colorful = await detectColorfulness(imageBuffer);
      if (colorful) {
        // skip greyscale so colored emoji remain visually distinct
        preprocessImage._skipGreyscale = true;
      }
    }

    const prepared = await preprocessImage(imageBuffer);

    const worker = await getWorker();

    // Apply runtime parameters if provided
    try {
      const params = {};
      if (options.psm) params.tessedit_pageseg_mode = String(options.psm);
      if (options.whitelist) params.tessedit_char_whitelist = String(options.whitelist);
      if (options.oem) params.tessedit_ocr_engine_mode = String(options.oem);
      if (Object.keys(params).length && typeof worker.setParameters === 'function') {
        await worker.setParameters(params);
      }
    } catch (e) {
      logger.debug('Failed to set worker parameters', { error: e.message });
    }

  // Recognize
    let res = await worker.recognize(prepared);
    let text = res?.data?.text || '';

    const words = res?.data?.words || [];
    const avgConf = words.length ? (words.reduce((s, w) => s + (w.confidence || 0), 0) / words.length) : 100;

    // Retry logic for low confidence
    if (avgConf < (options.minConfidence || 60)) {
      try {
        logger.info('Low OCR confidence detected, retrying with alternate PSM', { avgConf });
        if (typeof worker.setParameters === 'function') {
          await worker.setParameters({ tessedit_pageseg_mode: options.retryPsm || '6' });
        }
        const alt = await worker.recognize(prepared);
        const altText = alt?.data?.text || '';
        const altWords = alt?.data?.words || [];
        const altAvg = altWords.length ? (altWords.reduce((s, w) => s + (w.confidence || 0), 0) / altWords.length) : 0;
        if ((altText.length > text.length) || altAvg > avgConf) {
          text = altText;
        }
      } catch (e) {
        logger.warn('Alternate OCR retry failed', { error: e.message });
      }
    }

    let cleaned = (text || '').replace(/\u00A0/g, ' ').trim();

    // Emoji preservation note: keep unicode characters intact; Tesseract may or may not detect
    // colored emoji correctly. We avoid stripping non-ASCII when emojiPreserve is requested.
    if (options && options.numeric) {
      cleaned = normalizeNumericTokens(cleaned);
    }

    // If not preserving emoji, optionally strip unlikely non-text glyphs (control chars)
    if (!(options && options.emojiPreserve)) {
      // keep basic punctuation and unicode letters/numbers
      cleaned = cleaned.replace(/[\x00-\x1F\x7F]/g, '');
    }

    logger.info('OCR extraction completed', { length: cleaned.length, durationMs: Date.now() - start, avgConf });
    return cleaned;
  } catch (err) {
    logger.error('OCR extraction failed', { error: err.message });
    return '[OCR extraction failed]';
  }
}

module.exports = { extractTextFromImage };

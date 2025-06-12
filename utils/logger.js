/* eslint-disable no-console */
/**
 * Simple Logger Utility for Thoth Chrome Extension
 * Provides detailed timestamped logs with configurable log levels.
 */

// Log levels
const LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
};

// Default log level (can be overridden via chrome.storage or query param)
let currentLevel = LEVELS.DEBUG;

/**
 * Format current date/time as ISO string with milliseconds.
 * @returns {string}
 */
function time() {
  return new Date().toISOString();
}

/**
 * Generic log function that respects log level.
 * @param {number} level
 * @param {string} tag - Log tag e.g. "BG", "CONTENT"
 * @param {...any} args - Arguments to log
 */
function log(level, tag, ...args) {
  if (level < currentLevel) return;

  const prefix = `[${time()}] [${tag}]`;
  switch (level) {
    case LEVELS.DEBUG:
      console.debug(prefix, ...args);
      break;
    case LEVELS.INFO:
      console.info(prefix, ...args);
      break;
    case LEVELS.WARN:
      console.warn(prefix, ...args);
      break;
    case LEVELS.ERROR:
      console.error(prefix, ...args);
      break;
    default:
      console.log(prefix, ...args);
  }
}

/**
 * Load persisted log level from chrome.storage if available.
 */
function init() {
  try {
    chrome.storage.sync.get(['logLevel'], (result) => {
      if (result.logLevel !== undefined && LEVELS[result.logLevel] !== undefined) {
        currentLevel = LEVELS[result.logLevel];
        log(LEVELS.INFO, 'LOGGER', `Log level set to ${result.logLevel}`);
      }
    });
  } catch (e) {
    // chrome.storage may not be available in some contexts
    console.warn('Logger init failed to access chrome.storage', e);
  }
}

// Initialize immediately
init();

export { LEVELS, log };

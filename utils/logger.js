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
 * @param {...any} args - Arguments to log (Error stacks and objects are formatted)
 */
function log(level, tag, ...args) {
  if (level < currentLevel) return;

  const prefix = `[${time()}] [${tag}]`;
  // Format arguments: print Error stacks and JSON.stringify objects for clarity
  const formattedArgs = args.map(arg => {
    if (arg instanceof Error) {
      return arg.stack || arg.toString();
    }
    if (arg !== null && typeof arg === 'object') {
      try {
        return JSON.stringify(arg, null, 2);
      } catch (_) {
        return String(arg);
      }
    }
    return arg;
  });
  switch (level) {
    case LEVELS.DEBUG:
      console.debug(prefix, ...formattedArgs);
      break;
    case LEVELS.INFO:
      console.info(prefix, ...formattedArgs);
      break;
    case LEVELS.WARN:
      console.warn(prefix, ...formattedArgs);
      break;
    case LEVELS.ERROR:
      console.error(prefix, ...formattedArgs);
      break;
    default:
      console.log(prefix, ...formattedArgs);
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

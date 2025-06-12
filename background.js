import { log, LEVELS } from './utils/logger.js';
import { sendNotification } from './utils/notifier.js';

/**
 * Map that stores the last URL we notified for each tabId.
 * Helps avoid duplicate notifications for repeated updates.
 * @type {Map<number, string>}
 */
const lastURLMap = new Map();

// Authentication state
const AUTH_TOKEN_KEY = 'authToken';
let isAuthenticated = false;

// Retrieve token on startup
chrome.storage.local.get([AUTH_TOKEN_KEY], (result) => {
  if (result[AUTH_TOKEN_KEY]) {
    isAuthenticated = true;
    log(LEVELS.INFO, 'BG', 'Authenticated session detected on startup');
  }
});

// Listen for login/logout events from popup
chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === 'login-success') {
    isAuthenticated = true;
    log(LEVELS.INFO, 'BG', 'Login success – tracking enabled');
  } else if (message?.type === 'logout') {
    isAuthenticated = false;
    lastURLMap.clear();
    log(LEVELS.INFO, 'BG', 'Logged out – tracking disabled & cache cleared');
  }
});

log(LEVELS.INFO, 'BG', 'Background service worker initialised');

/**
 * Handle tab activation – fired when the active tab in a window changes.
 */
chrome.tabs.onActivated.addListener(({ tabId, windowId }) => {
  log(LEVELS.DEBUG, 'BG', 'onActivated fired', { tabId, windowId });

  chrome.tabs.get(tabId, (tab) => {
    if (chrome.runtime.lastError) {
      log(LEVELS.ERROR, 'BG', 'tabs.get error', chrome.runtime.lastError);
      return;
    }

    processTabUpdate(tabId, tab);
  });
});

/**
 * Handle tab updates – fired whenever a tab changes (*including* URL changes).
 */
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // We only care when the loading is complete and the URL is available.
  if (changeInfo.status === 'complete' && tab.url) {
    log(LEVELS.DEBUG, 'BG', 'onUpdated complete', { tabId, url: tab.url });
    processTabUpdate(tabId, tab);
  }
});

/**
 * Process a tab to determine whether to send a notification.
 *
 * @param {number} tabId
 * @param {chrome.tabs.Tab} tab
 */
function processTabUpdate(tabId, tab) {
  // Only operate when user is authenticated
  if (!isAuthenticated) return;

  const currentURL = tab.url;
  const lastURL = lastURLMap.get(tabId);

  if (currentURL && currentURL !== lastURL) {
    log(LEVELS.INFO, 'BG', 'New URL detected', { tabId, currentURL, title: tab.title });

    // Update last notified URL
    lastURLMap.set(tabId, currentURL);

    // Send the notification
    sendNotification(tab.title || 'New Page', currentURL);
  } else {
    log(LEVELS.DEBUG, 'BG', 'URL unchanged – no notification', { tabId, currentURL });
  }
}

/**
 * Cleanup when a tab is removed.
 */
chrome.tabs.onRemoved.addListener((tabId) => {
  log(LEVELS.DEBUG, 'BG', 'Tab removed – clearing cache', { tabId });
  lastURLMap.delete(tabId);
});

// Optional: clear cache when extension is reloaded to avoid stale data
chrome.runtime.onInstalled.addListener(() => {
  log(LEVELS.INFO, 'BG', 'Extension installed/reloaded – clearing lastURLMap');
  lastURLMap.clear();
});

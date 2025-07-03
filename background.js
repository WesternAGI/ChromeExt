import { log, LEVELS } from './utils/logger.js';
import { sendNotification } from './utils/notifier.js';

// ----------------- Constants -----------------
const API_BASE = 'https://web-production-d7d37.up.railway.app';
const DEVICE_NAME = 'browser-chrome';
const DEVICE_TYPE = 'browser';
const HEARTBEAT_ALARM = 'deviceHeartbeat';
const HEARTBEAT_INTERVAL_MS = 1000; // 1 second heartbeat when service worker is awake
let heartbeatIntervalId = null; // stores setInterval id

// Authentication state
const AUTH_TOKEN_KEY = 'authToken';
let isAuthenticated = false;

// Utility: get auth token from storage (callback with token or undefined)
function getAuthToken(cb) {
  chrome.storage.local.get([AUTH_TOKEN_KEY], (result) => cb(result[AUTH_TOKEN_KEY]));
}

// Send heartbeat to backend
function sendHeartbeat(details = {}) {
  if (!isAuthenticated) return;
  getAuthToken((token) => {
    if (!token) return;

    const body = new URLSearchParams();
    body.append('device_name', DEVICE_NAME);
    body.append('device_type', DEVICE_TYPE);
    if (details.current_app) body.append('current_app', details.current_app);
    if (details.current_page) body.append('current_page', details.current_page);
    if (details.current_url) body.append('current_url', details.current_url);

    fetch(`${API_BASE}/device/heartbeat`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body,
    }).catch((err) => log(LEVELS.ERROR, 'BG', 'Heartbeat error', err));
  });
}

// Send heartbeat including active tab info plus aggregated browser details
function heartbeatWithActiveTab() {
  // Get the current window with all tabs populated so we can compute metrics
  chrome.windows.getCurrent({ populate: true }, (window) => {
    if (chrome.runtime.lastError || !window) {
      log(LEVELS.ERROR, 'BG', 'windows.getCurrent error', chrome.runtime.lastError);
      sendHeartbeat({ current_app: 'chrome' });
      return;
    }

    const tabs = window.tabs || [];
    const tabCount = tabs.length;
    const titles = tabs.map((t) => t.title).filter(Boolean);
    const activeTab = tabs.find((t) => t.active) || tabs[0];

    // Compose current_app string with extended info
    const titlesStr = titles.join(' | ');
    const current_app = `chrome|tabs:${tabCount}|titles:${titlesStr}`;

    const details = { current_app };
    if (activeTab) {
      details.current_page = activeTab.title;
      details.current_url = activeTab.url;
    }

    sendHeartbeat(details);
  });
}

// Notify backend on logout
function sendLogout() {
  getAuthToken((token) => {
    if (!token) return;
    const body = new URLSearchParams();
    body.append('device_name', DEVICE_NAME);

    fetch(`${API_BASE}/device/logout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body,
    }).catch((err) => log(LEVELS.ERROR, 'BG', 'Logout error', err));
  });
}

function scheduleHeartbeat() {
  // Fallback alarm to wake the service worker at least once per minute
  chrome.alarms.create(HEARTBEAT_ALARM, { periodInMinutes: 1 });

  // Additionally, maintain an in-memory 1-second interval while the
  // service-worker is alive. Note: the interval is cleared when the worker is
  // suspended by Chrome, but will resume on the next alarm wake-up.
  if (heartbeatIntervalId === null) {
    heartbeatIntervalId = setInterval(heartbeatWithActiveTab, HEARTBEAT_INTERVAL_MS);
  }
}

function clearHeartbeat() {
  chrome.alarms.clear(HEARTBEAT_ALARM);
  if (heartbeatIntervalId !== null) {
    clearInterval(heartbeatIntervalId);
    heartbeatIntervalId = null;
  }
}

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
    heartbeatWithActiveTab();
    scheduleHeartbeat();
    log(LEVELS.INFO, 'BG', 'Login success – tracking enabled');
  } else if (message?.type === 'logout') {
    sendLogout();
    isAuthenticated = false;
    lastURLMap.clear();
    clearHeartbeat();
    log(LEVELS.INFO, 'BG', 'Logged out – tracking disabled & cache cleared');
  }
});

log(LEVELS.INFO, 'BG', 'Background service worker initialised');

/**
 * Map that stores the last URL we notified for each tabId.
 * Helps avoid duplicate notifications for repeated updates.
 * @type {Map<number, string>}
 */
const lastURLMap = new Map();

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

    // Heartbeat with current URL
    sendHeartbeat({
      current_app: 'chrome',
      current_page: tab.title,
      current_url: currentURL,
    });
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

// Alarm handler for periodic heartbeat
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === HEARTBEAT_ALARM) {
    heartbeatWithActiveTab();
  }
});

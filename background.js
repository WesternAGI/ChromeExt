import { log, LEVELS } from './utils/logger.js';
import { sendNotification } from './utils/notifier.js';
import { getCurrentServer, SERVERS } from './utils/storage.js';

// ----------------- Constants -----------------
let API_BASE = 'https://web-production-d7d37.up.railway.app';

// Initialize the API base URL
(async () => {
  try {
    const server = await getCurrentServer();
    API_BASE = server.url;
    log(LEVELS.INFO, 'BG', `Using server: ${server.name} (${server.url})`);
  } catch (error) {
    console.error('Failed to load server config:', error);
  }
})();
const DEVICE_NAME = 'browser-chrome';
const DEVICE_TYPE = 'browser';
const HEARTBEAT_ALARM = 'deviceHeartbeat';
const HEARTBEAT_INTERVAL_MS = 1000; // 1 second heartbeat when service worker is awake
const DEVICE_ID_KEY = 'device_id';
let heartbeatIntervalId = null; // stores setInterval id
let isWindowFocused = true; // track Chrome window focus state

// Authentication state
const AUTH_TOKEN_KEY = 'authToken';
let isAuthenticated = false;

// Utility: get auth token from storage (callback with token or undefined)
function getAuthToken(cb) {
  chrome.storage.local.get([AUTH_TOKEN_KEY], (result) => cb(result[AUTH_TOKEN_KEY]));
}

// Generate a stable device ID if it doesn't exist
async function getOrCreateDeviceId() {
  return new Promise((resolve) => {
    // First, try to get the device ID from storage
    chrome.storage.local.get([DEVICE_ID_KEY], (result) => {
      if (result && result[DEVICE_ID_KEY]) {
        // Validate the stored device ID is a valid UUID
        const storedId = result[DEVICE_ID_KEY].trim();
        if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(storedId)) {
          log(LEVELS.INFO, 'BG', 'Using existing device ID', { deviceId: storedId });
          resolve(storedId);
          return;
        } else {
          log(LEVELS.WARN, 'BG', 'Invalid device ID format in storage, generating new one', { 
            storedId,
            isValid: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(storedId)
          });
        }
      }
      
      // If we get here, either no device ID exists or it's invalid
      const newDeviceId = crypto.randomUUID();
      
      // Store the new device ID
      chrome.storage.local.set({ [DEVICE_ID_KEY]: newDeviceId }, () => {
        if (chrome.runtime.lastError) {
          log(LEVELS.ERROR, 'BG', 'Failed to store device ID', { 
            error: chrome.runtime.lastError,
            newDeviceId 
          });
          // Still resolve with the new ID even if storage failed
          resolve(newDeviceId);
        } else {
          log(LEVELS.INFO, 'BG', 'Generated and stored new device ID', { 
            deviceId: newDeviceId,
            storedAt: new Date().toISOString()
          });
          resolve(newDeviceId);
        }
      });
    });
  });
}

// Handle server changes
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'SERVER_CHANGED') {
    const { server } = request;
    API_BASE = server.url;
    log(LEVELS.INFO, 'BG', `Server changed to: ${server.name} (${server.url})`);
    
    // Re-authenticate if needed
    if (isAuthenticated) {
      // Clear any existing heartbeat
      clearHeartbeat();
      // Restart heartbeat with new server
      scheduleHeartbeat();
    }
  }
  return true; // Keep the message channel open for async response
});

// Send heartbeat to backend
async function sendHeartbeat(details = {}) {
  if (!isAuthenticated) {
    log(LEVELS.INFO, 'BG', 'Skipping heartbeat - not authenticated');
    return;
  }
  
  try {
    const token = await new Promise(resolve => getAuthToken(resolve));
    if (!token) {
      log(LEVELS.WARN, 'BG', 'No auth token available for heartbeat');
      return;
    }

    // Get or create device ID with detailed logging
    log(LEVELS.DEBUG, 'BG', 'Getting or creating device ID');
    const deviceId = await getOrCreateDeviceId();
    
    // Log the device ID being used (first 8 chars for security)
    const deviceIdPreview = deviceId ? `${deviceId.substring(0, 8)}...` : 'none';
    log(LEVELS.DEBUG, 'BG', 'Using device ID', { 
      deviceIdPreview,
      deviceIdLength: deviceId ? deviceId.length : 0,
      isValid: deviceId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(deviceId)
    });
    
    // Prepare request body as JSON with required heartbeat_data fields:
    // device_id, device_name, device_type, current_app, current_page, current_url
    const payload = {
      device_id: deviceId,
      device_name: DEVICE_NAME,
      device_type: DEVICE_TYPE,
      // Add optional fields if they exist
      ...(details.current_app && { current_app: details.current_app }),
      ...(details.current_page && { current_page: details.current_page }),
      ...(details.current_url && { current_url: details.current_url }),
      ...(typeof details.focused === 'boolean' && { focused: details.focused })
    };

    log(LEVELS.DEBUG, 'BG', 'Sending heartbeat request', { 
      url: `${API_BASE}/device/heartbeat`,
      hasToken: !!token,
      payload
    });

    try {
      const response = await fetch(`${API_BASE}/device/heartbeat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      const responseText = await response.text();
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}, response: ${responseText}`);
      }
      
      try {
        const responseData = responseText ? JSON.parse(responseText) : {};
        log(LEVELS.DEBUG, 'BG', 'Heartbeat successful', {
          status: response.status,
          response: responseData
        });
        // Emit heartbeat response as extension notification
        // sendNotification(
        //   'Heartbeat response',
        //   JSON.stringify(responseData, null, 2)
        // );
        return responseData;
      } catch (parseError) {
        log(LEVELS.WARN, 'BG', 'Failed to parse heartbeat response', { 
          status: response.status,
          responseText,
          error: parseError.message 
        });
        return { success: true }; // Consider successful if we can't parse the response
      }
    } catch (err) {
      log(LEVELS.ERROR, 'BG', 'Heartbeat request failed', { 
        error: err.message,
        stack: err.stack,
        url: `${API_BASE}/device/heartbeat`
      });
      throw err; // Re-throw to allow caller to handle if needed
    }
  } catch (err) {
    log(LEVELS.ERROR, 'BG', 'Unexpected error in sendHeartbeat', { 
      error: err.message,
      stack: err.stack,
      details: JSON.stringify(details, null, 2)
    });
    throw err;
  }
}

// Send heartbeat including active tab info plus aggregated browser details
function heartbeatWithActiveTab() {
  // Get the current window with all tabs populated so we can compute metrics
  chrome.windows.getCurrent({ populate: true }, async (window) => {
    if (chrome.runtime.lastError || !window) {
      log(LEVELS.ERROR, 'BG', 'windows.getCurrent error', chrome.runtime.lastError);
      await sendHeartbeat({ current_app: 'chrome' }).catch(err => {
        log(LEVELS.ERROR, 'BG', 'Failed to send heartbeat', err);
      });
      return;
    }

    const tabs = window.tabs || [];
    const tabCount = tabs.length;
    const titles = tabs.map((t) => t.title).filter(Boolean);
    const activeTab = tabs.find((t) => t.active) || tabs[0];

    // Compose current_app string with extended info
    const titlesStr = titles.join(' | ');
    const current_app = `chrome|tabs:${tabCount}|titles:${titlesStr}`;

    const details = { current_app, focused: isWindowFocused };
    if (activeTab) {
      details.current_page = activeTab.title;
      details.current_url = activeTab.url;
    }

    try {
      await sendHeartbeat(details);
    } catch (err) {
      log(LEVELS.ERROR, 'BG', 'Failed to send heartbeat', err);
    }
  });
}

// Notify backend on logout
function sendLogout() {
  getAuthToken((token) => {
    if (!token) return;
    
    const payload = {
      device_name: DEVICE_NAME
    };

    fetch(`${API_BASE}/device/logout`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}` 
      },
      body: JSON.stringify(payload),
    })
    .then(response => {
      if (!response.ok) {
        return response.text().then(text => {
          throw new Error(`Logout failed: ${response.status} - ${text}`);
        });
      }
      return response.json();
    })
    .catch((err) => {
      log(LEVELS.ERROR, 'BG', 'Logout error', {
        error: err.message,
        stack: err.stack
      });
    });
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

// Initialize extension
chrome.runtime.onInstalled.addListener(() => {
  // Generate device ID on installation
  getOrCreateDeviceId().then(deviceId => {
    log(LEVELS.INFO, 'BG', 'Extension installed', { deviceId });
  });
});

// Retrieve token on startup
chrome.storage.local.get([AUTH_TOKEN_KEY], (result) => {
  if (result[AUTH_TOKEN_KEY]) {
    isAuthenticated = true;
    log(LEVELS.INFO, 'BG', 'Authenticated session detected on startup');
  }
  
  // Log the device ID on startup for debugging
  getOrCreateDeviceId().then(deviceId => {
    log(LEVELS.INFO, 'BG', 'Extension started', { deviceId });
  });
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

    // Heartbeat with current URL
    sendHeartbeat({
      current_app: 'chrome',
      current_page: tab.title,
      current_url: currentURL,
      focused: isWindowFocused,
    });

    // Also capture page content and send details to backend for AI processing
    try {
      chrome.scripting.executeScript(
        {
          target: { tabId },
          func: () => {
            try {
              const title = document.title || '';
              const url = location.href || '';
              const content = document.body ? document.body.innerText || '' : '';
              return { title, url, content };
            } catch (e) {
              return { title: document.title || '', url: location.href || '', content: '' };
            }
          },
        },
        async (results) => {
          if (chrome.runtime.lastError) {
            log(LEVELS.ERROR, 'BG', 'executeScript error', chrome.runtime.lastError);
            return;
          }
          const result = (results && results[0] && results[0].result) || null;
          if (!result) return;

          // Limit content size to avoid large payloads
          const maxLen = 8000;
          const payload = {
            title: result.title || (tab.title || ''),
            url: result.url || currentURL,
            content: (result.content || '').slice(0, maxLen),
          };

          try {
            const [token, deviceId] = await Promise.all([
              new Promise(resolve => getAuthToken(resolve)),
              getOrCreateDeviceId(),
            ]);
            if (!token || !deviceId) return;
            const resp = await fetch(`${API_BASE}/active`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
              },
              body: JSON.stringify({
                device: deviceId,
                title: payload.title,
                url: payload.url,
                content: payload.content,
                focused: isWindowFocused,
              }),
            });
            // Handle backend hint to show a notification
            try {
              const data = await resp.json();
              if (data && data.show_notification && data.response && typeof data.response === 'string' && data.response.trim()) {
                sendNotification('Thoth', data.response.trim());
              }
            } catch (parseErr) {
              log(LEVELS.WARN, 'BG', 'Failed to parse /active response', { error: parseErr?.message });
            }
          } catch (e) {
            log(LEVELS.ERROR, 'BG', 'Failed to send page details', { error: e?.message });
          }
        }
      );
    } catch (e) {
      log(LEVELS.ERROR, 'BG', 'Failed to capture page content', { error: e?.message });
    }
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

// Track Chrome window focus/blur and notify backend quickly
chrome.windows.onFocusChanged.addListener((windowId) => {
  // When focus goes to another app, Chrome reports WINDOW_ID_NONE
  isWindowFocused = windowId !== chrome.windows.WINDOW_ID_NONE;
  log(LEVELS.INFO, 'BG', 'Window focus changed', { isWindowFocused, windowId });
  // Send a lightweight heartbeat immediately with updated focus state
  sendHeartbeat({ current_app: 'chrome', focused: isWindowFocused }).catch(() => {});
  // Also notify /active immediately with minimal payload to suppress AI/SMS promptly
  (async () => {
    try {
      const [token, deviceId] = await Promise.all([
        new Promise(resolve => getAuthToken(resolve)),
        getOrCreateDeviceId(),
      ]);
      if (!token || !deviceId) return;
      await fetch(`${API_BASE}/active`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ device: deviceId, focused: isWindowFocused }),
      });
    } catch (e) {
      // best effort; ignore
    }
  })();
});

import { log, LEVELS } from './utils/logger.js';
import { getCurrentServer, setCurrentServer, SERVERS } from './utils/storage.js';

const AUTH_TOKEN_KEY = 'authToken';
let API_BASE = 'https://web-production-d7d37.up.railway.app';

// Elements
const loginView = document.getElementById('login-view');
const loggedView = document.getElementById('loggedin-view');
const statusEl = document.getElementById('status');
const statusLoggedEl = document.getElementById('status-logged');
const usernameInput = document.getElementById('username');
const passwordInput = document.getElementById('password');
const loginBtn = document.getElementById('login-btn');
const logoutBtn = document.getElementById('logout-btn');

function showLogin() {
  loginView.classList.remove('hidden');
  loggedView.classList.add('hidden');
}

function showLogged() {
  loginView.classList.add('hidden');
  loggedView.classList.remove('hidden');
}

// Initialize UI based on auth state
chrome.storage.local.get([AUTH_TOKEN_KEY], (result) => {
  if (result[AUTH_TOKEN_KEY]) {
    showLogged();
  } else {
    showLogin();
  }
});

// Initialize server selection
async function initServerSelection() {
  const settingsButton = document.getElementById('settings-button');
  const settingsContainer = document.getElementById('settings-container');
  const serverSelect = document.getElementById('server-select');
  
  // Load current server
  const currentServer = await getCurrentServer();
  API_BASE = currentServer.url;
  
  // Set the selected server in the dropdown
  const selectedServer = Object.keys(SERVERS).find(
    key => SERVERS[key].url === currentServer.url
  ) || 'PRODUCTION';
  serverSelect.value = selectedServer;
  
  // Toggle settings visibility
  settingsButton.addEventListener('click', (e) => {
    e.stopPropagation();
    settingsContainer.classList.toggle('visible');
  });
  
  // Handle server change
  serverSelect.addEventListener('change', async (e) => {
    const selectedKey = e.target.value;
    const selectedServer = SERVERS[selectedKey];
    if (selectedServer) {
      await setCurrentServer(selectedServer);
      API_BASE = selectedServer.url;
      
      // Show status message
      const statusEl = document.getElementById('status');
      statusEl.textContent = `Switched to ${selectedServer.name} server`;
      statusEl.classList.remove('hidden');
      
      // Hide status after 3 seconds
      setTimeout(() => {
        statusEl.classList.add('hidden');
      }, 3000);
      
      // Notify background script
      chrome.runtime.sendMessage({
        type: 'SERVER_CHANGED',
        server: selectedServer
      });
    }
  });
}

// Initialize server selection when the popup loads
document.addEventListener('DOMContentLoaded', initServerSelection);

loginBtn.addEventListener('click', async () => {
  const username = usernameInput.value.trim();
  const password = passwordInput.value;
  if (!username || !password) {
    statusEl.textContent = 'Please enter username and password';
    return;
  }
  loginBtn.disabled = true;
  statusEl.textContent = 'Logging in...';
  try {
    // Using URLSearchParams as the server expects form-urlencoded
    const formData = new URLSearchParams();
    formData.append('username', username);
    formData.append('password', password);
    formData.append('grant_type', 'password');

    const res = await fetch(`${API_BASE}/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formData,
    });

    if (!res.ok) {
      throw new Error(`Login failed: ${res.status}`);
    }

    const data = await res.json();
    const token = data.access_token;
    if (!token) throw new Error('No token received');

    // Store token
    chrome.storage.local.set({ [AUTH_TOKEN_KEY]: token }, () => {
      log(LEVELS.INFO, 'POPUP', 'Token stored');
      chrome.runtime.sendMessage({ type: 'login-success' });
      showLogged();
      statusLoggedEl.textContent = 'Logged in';
    });
  } catch (err) {
    console.error(err);
    statusEl.textContent = err.message || 'Login failed';
  } finally {
    loginBtn.disabled = false;
  }
});

logoutBtn.addEventListener('click', () => {
  chrome.storage.local.remove([AUTH_TOKEN_KEY], () => {
    chrome.runtime.sendMessage({ type: 'logout' });
    showLogin();
    statusEl.textContent = 'Logged out';
  });
});

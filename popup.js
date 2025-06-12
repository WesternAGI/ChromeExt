import { log, LEVELS } from './utils/logger.js';

const AUTH_TOKEN_KEY = 'authToken';
const API_BASE = 'https://web-production-d7d37.up.railway.app';

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
    const body = new URLSearchParams();
    body.append('username', username);
    body.append('password', password);

    const res = await fetch(`${API_BASE}/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
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

export const SERVER_CONFIG_KEY = 'serverConfig';

export const SERVERS = {
  PRODUCTION: {
    name: 'Production',
    url: 'https://web-production-d7d37.up.railway.app'
  },
  LOCAL: {
    name: 'Local Development',
    url: 'http://localhost:7050'
  }
};

export async function getCurrentServer() {
  const result = await chrome.storage.local.get(SERVER_CONFIG_KEY);
  return result[SERVER_CONFIG_KEY] || SERVERS.PRODUCTION;
}

export async function setCurrentServer(server) {
  await chrome.storage.local.set({ [SERVER_CONFIG_KEY]: server });
}

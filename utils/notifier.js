import { log, LEVELS } from './logger.js';

/**
 * Send a Chrome notification with the given title and message.
 * Includes detailed logging before/after creating the notification.
 *
 * @param {string} title - Notification title
 * @param {string} message - Notification body (typically the URL)
 */
export function sendNotification(title, message) {
  const options = {
    type: 'basic',
    iconUrl: 'icons/icon48.png',
    title: title || 'New Site Opened',
    message: message || '',
    priority: 0, // Low priority; adjust if needed
  };

  log(LEVELS.INFO, 'NOTIFIER', 'Creating notification', { title, message, options });

  try {
    chrome.notifications.create('', options, (notificationId) => {
      if (chrome.runtime.lastError) {
        log(LEVELS.ERROR, 'NOTIFIER', 'Notification error', chrome.runtime.lastError);
      } else {
        log(LEVELS.DEBUG, 'NOTIFIER', `Notification created: ${notificationId}`);
      }
    });
  } catch (err) {
    // In case notifications API is not available or fails
    log(LEVELS.ERROR, 'NOTIFIER', 'Failed to create notification', err);
  }
}

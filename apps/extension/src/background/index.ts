import { createMessage, EXTENSION_MESSAGE_TYPES } from '../lib/messaging';
import { STORAGE_KEYS, getStorage, setStorage } from '../lib/storage';
import { fetchFeed } from '../lib/api-client';
import { normalizeFeed } from '../lib/extension-helpers';

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({
    [STORAGE_KEYS.MODE]: 'Work',
    [STORAGE_KEYS.FEED_CACHE]: [],
    [STORAGE_KEYS.LAST_SYNC]: null,
  });
});

const refreshFeed = async () => {
  try {
    const feedResponse = await fetchFeed();
    const normalizedFeed = normalizeFeed(feedResponse);
    await setStorage(STORAGE_KEYS.FEED_CACHE, normalizedFeed);
    await setStorage(STORAGE_KEYS.LAST_SYNC, new Date().toISOString());
    return normalizedFeed;
  } catch (error) {
    console.error('Failed to refresh extension feed', error);
    return [];
  }
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const { type, payload } = message as { type: string; payload?: { mode?: string; contentItemId?: string; eventType?: string } };

  if (type === EXTENSION_MESSAGE_TYPES.GET_FEED) {
    void getStorage(STORAGE_KEYS.FEED_CACHE, []).then((feed) => {
      sendResponse({ feed });
    });
    return true;
  }

  if (type === EXTENSION_MESSAGE_TYPES.SET_MODE) {
    void setStorage(STORAGE_KEYS.MODE, payload?.mode ?? 'Work');
    void refreshFeed();
    sendResponse({ ok: true });
    return true;
  }

  if (type === EXTENSION_MESSAGE_TYPES.FEEDBACK) {
    void setStorage(STORAGE_KEYS.LAST_SYNC, new Date().toISOString());
    sendResponse({ ok: true, contentItemId: payload?.contentItemId, eventType: payload?.eventType });
    return true;
  }

  if (type === EXTENSION_MESSAGE_TYPES.OPEN_OPTIONS) {
    void chrome.runtime.openOptionsPage();
    sendResponse({ ok: true });
    return true;
  }

  sendResponse({ ok: false });
  return true;
});

chrome.runtime.onMessageExternal.addListener((_message, _sender, sendResponse) => {
  sendResponse({ ok: true });
  return true;
});

const backgroundBootstrap = async () => {
  const mode = await getStorage(STORAGE_KEYS.MODE, 'Work');
  const feed = await getStorage(STORAGE_KEYS.FEED_CACHE, []);
  await refreshFeed();

  console.info('Personal Algorithm background ready', { mode, count: feed.length });
};

void backgroundBootstrap();

const message = createMessage(EXTENSION_MESSAGE_TYPES.GET_FEED, { algorithmId: 'demo' });
console.info('Background service worker ready', message);

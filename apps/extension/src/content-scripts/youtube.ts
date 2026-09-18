const videoSelectors = ['ytd-rich-item-renderer', 'ytd-video-renderer', 'ytd-grid-video-renderer'];

const normalizeText = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ');

let cachedFeed: Array<{ title?: string; visible?: boolean; id?: string; external_id?: string }> = [];

const getVideoTitle = (element: HTMLElement) => {
  const directTitle = element.querySelector('#video-title, .style-scope ytd-rich-grid-media .title a, .title a')?.textContent;
  return normalizeText(directTitle ?? '');
};

const hideIneligibleVideos = () => {
  const items = Array.from(document.querySelectorAll(videoSelectors.join(','))) as HTMLElement[];

  items.forEach((el) => {
    const title = getVideoTitle(el);
    const matchingFeedItem = cachedFeed.find((item) => {
      const candidateTitle = normalizeText(item.title ?? '');
      return candidateTitle && (candidateTitle === title || title.includes(candidateTitle) || candidateTitle.includes(title));
    });

    if (matchingFeedItem && matchingFeedItem.visible === false) {
      el.style.display = 'none';
      return;
    }

    if (title.includes('celebrity gossip') || title.includes('test')) {
      el.style.display = 'none';
    }
  });
};

const observer = new MutationObserver(() => {
  hideIneligibleVideos();
});

observer.observe(document.body, {
  childList: true,
  subtree: true,
});

chrome.runtime.sendMessage({ type: 'GET_FEED', payload: { algorithmId: 'demo' } }, (response) => {
  if (response?.feed) {
    cachedFeed = response.feed;
    console.info('Feed received by content script', response.feed.length);
    hideIneligibleVideos();
  }
});

hideIneligibleVideos();

const registerFeedbackHandlers = () => {
  const buttons = Array.from(document.querySelectorAll('button, ytd-menu-service-item-renderer')) as HTMLElement[];

  buttons.forEach((button) => {
    const label = button.textContent?.toLowerCase() ?? '';
    if (!label.includes('not interested') && !label.includes('more like this') && !label.includes('never show')) {
      return;
    }

    button.addEventListener('click', () => {
      const title = getVideoTitle(button.closest('ytd-rich-item-renderer, ytd-video-renderer, ytd-grid-video-renderer') as HTMLElement | null ?? document.body);
      const eventType = label.includes('more like this') ? 'more_like_this' : label.includes('never show') ? 'never_show_channel' : 'not_interested';

      chrome.runtime.sendMessage({
        type: 'FEEDBACK',
        payload: {
          contentItemId: title || 'unknown',
          eventType,
        },
      });
    }, { once: true });
  });
};

registerFeedbackHandlers();

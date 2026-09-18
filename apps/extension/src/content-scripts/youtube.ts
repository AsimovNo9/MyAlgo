const videoSelectors = ['ytd-rich-item-renderer', 'ytd-video-renderer', 'ytd-grid-video-renderer'];

const hideIneligibleVideos = () => {
  const items = Array.from(document.querySelectorAll(videoSelectors.join(','))) as HTMLElement[];

  items.forEach((el) => {
    const title = el.querySelector('#video-title, .style-scope ytd-rich-grid-media .title a')?.textContent?.trim() ?? '';
    if (title.toLowerCase().includes('test')) {
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

hideIneligibleVideos();

chrome.runtime.sendMessage({ type: 'GET_FEED', payload: { algorithmId: 'demo' } }, (response) => {
  if (response?.feed) {
    console.info('Feed received by content script', response.feed.length);
  }
});

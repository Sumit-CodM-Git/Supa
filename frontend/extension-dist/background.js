function youtubeUrl(value) {
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol)) return null;
    if (url.hostname === 'youtu.be' || url.hostname === 'youtube.com' || url.hostname.endsWith('.youtube.com')) return url.href;
  } catch {
    return null;
  }
  return null;
}

chrome.action.onClicked.addListener((tab) => {
  const target = new URL(chrome.runtime.getURL('index.html'));
  const url = youtubeUrl(tab.url);
  if (url) target.searchParams.set('url', url);
  chrome.tabs.create({ url: target.href });
  // Open the UI immediately; its health polling follows startup progress.
  chrome.runtime.sendNativeMessage('com.local.youtube_downloader', { action: 'start' }, (response) => {
    const error = chrome.runtime.lastError;
    if (error || !response?.ok) console.warn('Local backend startup:', error?.message ?? response?.error);
  });
});

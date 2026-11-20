(() => {
  const videoId = new URLSearchParams(location.search).get('video_id');
  let player;
  let ready = false;
  let end = null;
  const notify = (data) => parent.postMessage({ source: 'clip-preview', ...data }, '*');
  if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId ?? '')) {
    document.getElementById('player').textContent = 'Video preview is unavailable for this video.';
    notify({ type: 'error' });
    return;
  }
  window.onYouTubeIframeAPIReady = () => {
    player = new YT.Player('player', {
      videoId,
      playerVars: { playsinline: 1, rel: 0, origin: location.origin },
      events: {
        onReady: () => { ready = true; notify({ type: 'ready' }); },
        onError: () => notify({ type: 'error' }),
      },
    });
  };
  window.addEventListener('message', event => {
    if (event.source !== parent || !ready || event.data?.source !== 'clip-editor') return;
    const data = event.data;
    if (data.type === 'seek' && Number.isFinite(data.time) && data.time >= 0) {
      end = null;
      player.pauseVideo();
      player.seekTo(data.time, true);
    }
    if (data.type === 'range' && Number.isFinite(data.start) && Number.isFinite(data.end) && data.start >= 0 && data.end > data.start) {
      end = data.end;
      player.seekTo(data.start, true);
      player.playVideo();
    }
  });
  const timer = setInterval(() => {
    if (!ready) return;
    const time = player.getCurrentTime();
    if (end !== null && time >= end) {
      player.pauseVideo();
      end = null;
    }
    notify({ type: 'time', time });
  }, 150);
  window.addEventListener('pagehide', () => clearInterval(timer));
})();

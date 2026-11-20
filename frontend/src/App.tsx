import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import ClipEditor from './components/ClipEditor';
import SettingsPage from './pages/Settings';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Film, History, Settings, Sparkles } from 'lucide-react';
import {
  apiUrl,
  createDownload,
  createClips,
  getDownloads,
  getHealth,
  getSettings,
  inspectUrl,
  updateSettings,
} from './api/client';
import type { DownloadRecord, FormatRow, InspectResponse } from './api/types';

const activeStatuses = new Set(['queued', 'downloading', 'processing']);


function formatBytes(bytes?: number | null): string {
  if (!bytes || bytes <= 0) return 'Unknown';
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatDuration(seconds?: number | null): string {
  if (!seconds) return '—';
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}:${String(remainder).padStart(2, '0')}`;
}

function formatSpeed(bytesPerSecond?: number | null): string {
  return bytesPerSecond ? `${formatBytes(bytesPerSecond)}/s` : '—';
}

function App() {
  const queryClient = useQueryClient();
  const [url, setUrl] = useState(() => new URLSearchParams(location.search).get('url') ?? '');
  const [inspection, setInspection] = useState<InspectResponse | null>(null);
  const [clipFormat, setClipFormat] = useState<FormatRow | null>(null);
  const [clipNotice, setClipNotice] = useState('');
  const currentUrl = useRef('');
  const [inspectedUrl, setInspectedUrl] = useState('');
  const [page, setPage] = useState<'home' | 'history' | 'settings'>('home');

  const healthQuery = useQuery({ queryKey: ['health'], queryFn: getHealth, retry: false, refetchInterval: 5000 });
  const downloadsQuery = useQuery({
    queryKey: ['downloads'],
    queryFn: getDownloads,
    refetchInterval: (query) => query.state.data?.some((item) => activeStatuses.has(item.status)) ? 1000 : 5000,
  });
  const settingsQuery = useQuery({
    queryKey: ['settings'],
    queryFn: getSettings,

  });


  const inspectMutation = useMutation({
    mutationFn: inspectUrl,
    onSuccess: (result, requestedUrl) => {
      if (currentUrl.current !== requestedUrl) return;
      setInspection(result);
      setInspectedUrl(requestedUrl);
    },
  });
  const downloadMutation = useMutation({
    mutationFn: createDownload,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['downloads'] }),
  });
  const clipsMutation = useMutation({
    mutationFn: createClips,
    onSuccess: (result) => {
      setClipFormat(null);
      setClipNotice(`${result.ids.length} clips queued. Each clip will be saved as a separate file.`);
      queryClient.invalidateQueries({ queryKey: ['downloads'] });
    },
  });
  const settingsMutation = useMutation({
    mutationFn: updateSettings,
    onSuccess: (settings) => {
      queryClient.setQueryData(['settings'], settings);

    },
  });

  const downloads = downloadsQuery.data ?? [];
  const videoFormats = (inspection?.formats ?? [])
    .filter((format) => format.kind !== 'audio')
    .sort((a, b) => (b.height ?? 0) - (a.height ?? 0) || (b.fps ?? 0) - (a.fps ?? 0));
  const audioFormats = (inspection?.formats ?? []).filter((format) => format.kind === 'audio');
  const bestAudio = [...audioFormats].sort((a, b) => (b.abr ?? 0) - (a.abr ?? 0))[0];
  const activeDownloads = downloads.filter((item) => activeStatuses.has(item.status));
  const historyDownloads = downloads.filter((item) => !activeStatuses.has(item.status));

  const inspect = (value: string) => {
    const nextUrl = value.trim();
    currentUrl.current = nextUrl;
    setUrl(nextUrl);
    setInspection(null);
    setClipFormat(null);
    setClipNotice('');
    setInspectedUrl('');
    inspectMutation.reset();
    if (nextUrl) inspectMutation.mutate(nextUrl);
  };

  const handleInspect = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (url.trim()) inspect(url);
  };

  const handleDownload = (format: FormatRow, audioBitrate?: number) => {
    downloadMutation.mutate({
      url: inspectedUrl,
      kind: format.kind,
      format_id: format.format_id,
      ...(audioBitrate ? { audio_format: 'mp3', audio_bitrate: audioBitrate } : {}),
      ...(format.kind !== 'audio' ? { container: format.ext } : {}),
    });
  };

  const mutationError = inspectMutation.error ?? downloadMutation.error ?? settingsMutation.error;

  const downloadsPanel = (
    <section className="mt-6 rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
      <h2 className="mb-4 text-xl font-semibold">Downloads</h2>
      {downloadsQuery.error && <p role="alert" className="mb-3 text-sm text-red-300">{downloadsQuery.error.message}</p>}
      {activeDownloads.length ? (
        <DownloadList downloads={activeDownloads} />
      ) : (
        <p className="text-sm text-slate-400">No active downloads. Completed downloads remain available in History.</p>
      )}
    </section>
  );

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur-sm">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3 text-lg font-semibold">
            <Download className="h-5 w-5 text-cyan-400" />
            YT Downloader
          </div>
          <nav className="flex flex-wrap items-center gap-3 text-sm text-slate-300 sm:gap-6">
            <button onClick={() => setPage('home')} className="flex items-center gap-2 hover:text-white">
              <Film className="h-4 w-4" /> Home
            </button>
            <button onClick={() => setPage('history')} className="flex items-center gap-2 hover:text-white">
              <History className="h-4 w-4" /> History
            </button>
            <button
              onClick={() => { settingsMutation.reset(); setPage('settings'); }}
              aria-label="Settings"
              className="rounded-md border border-slate-700 p-2 hover:border-cyan-400 hover:text-white"
            >
              <Settings className="h-4 w-4" /><span className="ml-2">Settings &amp; Editing</span>
            </button>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8">
        {healthQuery.error && (
          <div role="alert" className="mb-5 rounded-xl border border-red-800 bg-red-950/60 p-4 text-sm text-red-200">
            {healthQuery.error.message}
            <button onClick={() => healthQuery.refetch()} className="ml-3 underline">Retry connection</button>
          </div>
        )}
        {location.protocol === 'chrome-extension:' && healthQuery.data && !healthQuery.error && (
          <p className="mb-4 text-sm text-green-400">Connected to local downloader · 127.0.0.1:8000</p>
        )}
        {healthQuery.data && !healthQuery.data.ffmpeg && (
          <div className="mb-5 rounded-xl border border-amber-700 bg-amber-950/60 p-4 text-sm text-amber-200">
            ffmpeg was not detected. Video/audio merging and audio conversion may fail until ffmpeg is installed and the app is restarted.
          </div>
        )}

        {page === 'settings' ? (settingsQuery.data ? <SettingsPage settings={settingsQuery.data} onSave={value => settingsMutation.mutate(value)} pending={settingsMutation.isPending} error={settingsMutation.error?.message} saved={settingsMutation.isSuccess} /> : <p role="status">{settingsQuery.error?.message ?? 'Loading settings…'}</p>) : page === 'home' ? (
          <>
            <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 shadow-xl">
              <form onSubmit={handleInspect} className="flex flex-col gap-3 md:flex-row">
                <input
                  value={url}
                  onChange={(event) => {
                    currentUrl.current = event.target.value.trim();
                    setUrl(event.target.value);
                    setInspection(null);
                    setClipFormat(null);
                    setClipNotice('');
                    inspectMutation.reset();
                  }}
                  onPaste={(event) => {
                    const pasted = event.clipboardData.getData('text').trim();
                    if (/^https?:\/\/(?:[a-z0-9-]+\.)*(?:youtube\.com|youtu\.be)(?:[/?#]|$)/i.test(pasted)) {
                      event.preventDefault();
                      inspect(pasted);
                    }
                  }}
                  placeholder="Paste a YouTube video, Shorts, or playlist URL"
                  aria-label="YouTube URL"
                  className="flex-1 rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100 outline-none transition focus:border-cyan-400"
                />
                <button
                  type="submit"
                  disabled={!url.trim() || inspectMutation.isPending}
                  className="rounded-xl bg-cyan-500 px-5 py-3 font-medium text-slate-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {inspectMutation.isPending ? 'Inspecting…' : 'Inspect'}
                </button>
              </form>
              <div className="mt-4 flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-sm text-slate-300">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-cyan-400" />
                  {inspectMutation.isPending ? 'Fetching available formats…' : 'Ready'}
                </div>
                <span className="text-slate-500">Local-only mode</span>
              </div>
            </section>

            {downloadsPanel}
            {clipNotice && <p role="status" className="mt-4 text-sm text-green-300">{clipNotice}</p>}

            {mutationError && (
              <div role="alert" className="mt-4 rounded-xl border border-red-800 bg-red-950/60 p-4 text-sm text-red-200">
                {mutationError.message}
              </div>
            )}

            {inspection?.type === 'playlist' && (
              <section className="mt-6 rounded-2xl border border-amber-800 bg-amber-950/40 p-5">
                <h2 className="font-semibold">{inspection.title}</h2>
                <p className="mt-1 text-sm text-amber-200">
                  Playlist entries were found. Choose an individual video URL to download a format.
                </p>
                <ul className="mt-3 space-y-2">
                  {inspection.entries?.map((entry) => (
                    <li key={`${entry.index}-${entry.id}`}>
                      <button
                        onClick={() => {
                          inspect(entry.url);
                        }}
                        className="text-left text-sm text-cyan-300 hover:underline"
                      >
                        {entry.index}. {entry.title}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {inspection?.type === 'video' && (
              <section className="mt-6 rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
                <div className="mb-5 flex flex-col gap-4 sm:flex-row">
                  {inspection.thumbnail && (
                    <img src={inspection.thumbnail} alt="" className="aspect-video w-full rounded-xl object-cover sm:w-56" />
                  )}
                  <div className="min-w-0">
                    <h1 className="text-xl font-semibold">{inspection.title}</h1>
                    <p className="mt-2 text-sm text-slate-400">
                      {inspection.channel || 'Unknown channel'} · {formatDuration(inspection.duration)}
                      {inspection.is_live ? ' · Live' : ''}
                    </p>
                  </div>
                </div>

                {clipFormat && (
                  <ClipEditor defaults={settingsQuery.data} key={`${inspectedUrl}-${clipFormat.format_id}`} url={inspectedUrl} videoId={inspection.video_id} formatLabel={clipFormat.label} duration={inspection.duration ?? 0} pending={clipsMutation.isPending} error={clipsMutation.error?.message} onClose={() => setClipFormat(null)} onConfirm={(ranges, captions, autoPortrait) => clipsMutation.mutate({ url: inspectedUrl, kind: clipFormat.kind, format_id: clipFormat.format_id, container: clipFormat.ext, ranges, show_captions: !!captions?.length, captions, auto_portrait: autoPortrait })} />
                )}
                <div className="max-h-[400px] overflow-y-auto rounded-xl border border-slate-700" role="region" aria-label="Available video and audio formats" tabIndex={0}>
                  <h2 className="bg-slate-800 px-4 py-4 text-lg font-semibold">Video</h2>
                  {videoFormats.length ? videoFormats.map((format) => (
                    <div key={`${format.kind}-${format.format_id}`} className="flex flex-wrap items-center gap-3 border-t border-slate-800 px-4 py-4">
                      <span className="rounded-lg bg-cyan-950 px-3 py-2 text-sm font-semibold uppercase text-cyan-300">{format.ext}</span>
                      <span className="text-lg font-semibold">{format.height ? `${format.height}p` : 'Video'}</span>
                      {format.height && format.height >= 720 ? <span className="rounded bg-slate-700 px-2 py-1 text-xs">{format.height >= 2160 ? '4K' : format.height >= 1080 ? 'FHD' : 'HD'}</span> : null}
                      <span className="text-xs text-slate-400">{format.fps ? `${format.fps} fps · ` : ''}{format.vcodec} · {format.format_id} · {format.protocol}{format.drange && format.drange !== 'SDR' ? ` · ${format.drange}` : ''}</span>
                      <span className="text-sm text-slate-400">{format.expected_size ? `~${formatBytes(format.expected_size)}` : 'Size unknown'}</span>
                      <button onClick={() => handleDownload(format)} disabled={downloadMutation.isPending} className="ml-auto flex items-center gap-2 rounded-xl border border-green-500 px-4 py-2 font-medium text-green-400 hover:bg-green-950 disabled:opacity-50">
                        <Download className="h-4 w-4" /> Download entire video
                      </button>
                      <button type="button" disabled={clipsMutation.isPending || !settingsQuery.data || !healthQuery.data?.ffmpeg || !inspection.duration || inspection.is_live} onClick={() => { clipsMutation.reset(); setClipNotice(''); setClipFormat(format); }} className="rounded-xl border border-cyan-500 px-4 py-2 font-medium text-cyan-300 hover:bg-cyan-950 disabled:opacity-50">Clip cut download</button>
                    </div>
                  )) : <p className="p-4 text-sm text-slate-400">No video formats available.</p>}
                  <h2 className="border-t border-slate-700 bg-slate-800 px-4 py-4 text-lg font-semibold">Audio</h2>
                  {bestAudio && [320, 256, 128].map((bitrate) => (
                    <div key={bitrate} className="flex flex-wrap items-center gap-3 border-t border-slate-800 px-4 py-4">
                      <span className="rounded-lg bg-cyan-950 px-3 py-2 text-sm font-semibold text-cyan-300">MP3</span>
                      <span className="text-lg font-semibold">{bitrate}<span className="ml-1 text-sm font-normal text-slate-400">kbps</span></span>
                      <span className="text-sm text-slate-400">{inspection.duration ? `~${formatBytes(inspection.duration * bitrate * 1000 / 8)}` : 'Size unknown'}</span>
                      <button onClick={() => handleDownload(bestAudio, bitrate)} disabled={downloadMutation.isPending || !healthQuery.data?.ffmpeg} className="ml-auto flex items-center gap-2 rounded-xl border border-green-500 px-4 py-2 font-medium text-green-400 hover:bg-green-950 disabled:opacity-50">
                        <Download className="h-4 w-4" /> Download
                      </button>
                    </div>
                  ))}
                  {bestAudio && <p className="px-4 py-3 text-xs text-slate-400">MP3 options convert the best available audio using ffmpeg. Higher output bitrate does not improve the source quality. Sizes are estimates.</p>}
                  {audioFormats.map((format) => (
                    <div key={format.format_id} className="flex flex-wrap items-center gap-3 border-t border-slate-800 px-4 py-4">
                      <span className="rounded-lg bg-cyan-950 px-3 py-2 text-sm font-semibold uppercase text-cyan-300">{format.ext}</span>
                      <span className="font-medium">{format.abr ? `${Math.round(format.abr)} kbps` : 'Original audio'}</span>
                      <span className="text-xs text-slate-400">{format.acodec} · {format.format_id} · {format.protocol} · Source</span>
                      <span className="text-sm text-slate-400">{format.expected_size ? `~${formatBytes(format.expected_size)}` : 'Size unknown'}</span>
                      <button onClick={() => handleDownload(format)} disabled={downloadMutation.isPending} className="ml-auto flex items-center gap-2 rounded-xl border border-green-500 px-4 py-2 font-medium text-green-400 hover:bg-green-950 disabled:opacity-50">
                        <Download className="h-4 w-4" /> Download
                      </button>
                    </div>
                  ))}
                  {!audioFormats.length && <p className="p-4 text-sm text-slate-400">No separate audio formats available.</p>}
                </div>
              </section>
            )}
          </>
        ) : (
          <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
            <h1 className="mb-4 text-xl font-semibold">Download history</h1>
            <DownloadList downloads={historyDownloads} />
          </section>
        )}

        {page === 'history' && downloadsPanel}
      </main>


    </div>
  );
}

function DownloadList({ downloads }: { downloads: DownloadRecord[] }) {
  if (downloads.length === 0) return <p className="text-sm text-slate-400">Nothing to show yet.</p>;

  return (
    <div className="space-y-3">
      {downloads.map((item) => (
        <article key={item.id} className="rounded-xl border border-slate-800 bg-slate-950 p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate font-medium">{item.title || item.label}</p>
              <p className="mt-1 text-xs text-slate-400">{item.label} · {item.status}</p>
            </div>
            <span className="text-sm text-cyan-300">{Math.round(item.progress || 0)}%</span>
          </div>
          {activeStatuses.has(item.status) && (
            <>
              <div className="mt-3 h-2 rounded-full bg-slate-800">
                <div className="h-2 rounded-full bg-cyan-400 transition-all" style={{ width: `${Math.min(100, Math.max(0, item.progress || 0))}%` }} />
              </div>
              <p className="mt-2 text-xs text-slate-400">
                {formatSpeed(item.speed)} · {item.eta ? `${item.eta}s remaining` : 'ETA —'}
              </p>
            </>
          )}
          {item.error && <p className="mt-2 text-sm text-red-300">{item.error}</p>}
          {item.filepath && (
            <div className="mt-3 space-y-2">
              <p className="break-all text-xs text-slate-400"><span className="text-slate-300">File path:</span> {item.filepath}</p>
              {item.status === 'completed' && (
                <a className="inline-block text-sm text-cyan-300 hover:underline" href={apiUrl(`/downloads/${encodeURIComponent(item.id)}/file`)} target="_blank" rel="noreferrer">
                  Open downloaded file
                </a>
              )}
            </div>
          )}
        </article>
      ))}
    </div>
  );
}

export default App;

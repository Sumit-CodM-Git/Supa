import type { CaptionCue, Transcript, DownloadRecord, FormatKind, InspectResponse, SettingsConfig } from './types';

export const backendOrigin = location.protocol === 'chrome-extension:' ? 'http://127.0.0.1:8000' : '';
export const apiUrl = (path: string) => `${backendOrigin}/api${path}`;

const api = async <T>(path: string, options?: RequestInit): Promise<T> => {
  const response = await fetch(apiUrl(path), {
    headers: { 'Content-Type': 'application/json', ...(options?.headers ?? {}) },
    ...options,
  }).catch(() => { throw new Error('Waiting for the local downloader at 127.0.0.1:8000. If it stays offline, install the automatic startup helper (see README) or run ./run.sh.'); });

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const message = body?.detail?.error?.message ?? body?.error?.message ?? `Request failed (${response.status})`;
    const error = new Error(message) as Error & { retryAfter?: number };
    if (response.status === 429) error.retryAfter = Number(response.headers.get('Retry-After')) || 60;
    throw error;
  }

  return response.json() as Promise<T>;
};

export const inspectUrl = (url: string) => api<InspectResponse>('/inspect', {
  method: 'POST',
  body: JSON.stringify({ url }),
});

export const getHealth = () => api<{ ok: boolean; ffmpeg: boolean; yt_dlp_version: string; download_dir_writable: boolean; auto_portrait?: boolean }>('/health');

export const getDownloads = () => api<DownloadRecord[]>('/downloads');

export type DownloadInput = {
  url: string;
  kind: FormatKind;
  format_id: string;
  audio_format?: string;
  audio_bitrate?: number;
  container?: string;
};

export const createClips = (body: DownloadInput & { ranges: Array<{ start: number; end: number }>; show_captions?: boolean; captions?: CaptionCue[]; auto_portrait?: boolean }) => api<{ ids: string[] }>('/clips', {
  method: 'POST',
  body: JSON.stringify(body),
});

export const createDownload = (body: DownloadInput) => api<{ id: string }>('/downloads', {
  method: 'POST',
  body: JSON.stringify(body),
});

export const getSettings = () => api<SettingsConfig>('/settings');

export const updateSettings = (settings: SettingsConfig) => api<SettingsConfig>('/settings', {
  method: 'PUT',
  body: JSON.stringify(settings),
});

export const getTranscript = (url: string, language?: string) => api<Transcript>('/transcript', { method: 'POST', body: JSON.stringify({ url, language }) });

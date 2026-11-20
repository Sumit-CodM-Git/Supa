export type FormatKind = 'video' | 'audio' | 'combined';

export interface FormatRow {
  kind: FormatKind;
  format_id: string;
  protocol?: string;
  label: string;
  height?: number;
  fps?: number;
  ext?: string;
  vcodec?: string;
  drange?: string;
  abr?: number;
  acodec?: string;
  expected_size?: number;
}

export interface InspectResponse {
  type: 'video' | 'playlist';
  title: string;
  video_id?: string;
  channel?: string;
  duration?: number;
  thumbnail?: string;
  is_live?: boolean;
  formats?: FormatRow[];
  subtitles?: string[];
  audio_languages?: string[];
  entries?: Array<{ index: number; id: string; title: string; duration: number; url: string; thumbnail?: string }>;
}

export interface DownloadRecord {
  id: string;
  url: string;
  title: string;
  kind: FormatKind;
  label: string;
  status: string;
  progress: number;
  speed: number | null;
  eta: number | null;
  expected_size: number;
  error: string | null;
  filepath: string | null;
  created_at: string;
  updated_at: string;
  thumbnail?: string;
}

export interface CaptionStyle {
  font: 'Arial' | 'Helvetica' | 'Georgia' | 'Verdana' | 'Courier New' | 'Times New Roman';
  size: number; color: string; outline_color: string; background_color: string;
  background: boolean; bold: boolean; italic: boolean;
  position: 'top' | 'middle' | 'bottom'; align: 'left' | 'center' | 'right';
  margin: number; outline: number; shadow: number;
}

export interface SettingsConfig {
  default_caption_language: string;
  captions_enabled: boolean;
  auto_portrait: boolean;
  caption_style: CaptionStyle;
  download_dir: string;
  max_concurrent: number;
  cookiefile: string | null;
  cookies_from_browser: string | null;
  proxy: string | null;
  player_clients: string[];
  default_container: string;
  prefer_mp4: boolean;
  subtitle_langs: string[];
  keep_original: boolean;
  filename_template: string;
}

export interface CaptionCue { start: number; end: number; text: string }
export interface Transcript { language: string; automatic: boolean; languages: string[]; cues: CaptionCue[] }

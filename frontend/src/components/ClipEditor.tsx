import { useEffect, useRef, useState } from 'react';
import { apiUrl, getTranscript } from '../api/client';

import { CaptionOverlay, defaultCaptionStyle } from './CaptionAppearance';
import type { CaptionCue, SettingsConfig } from '../api/types';

type Range = { start: number; end: number };
type SavedRange = Range & { id: number };

function timestamp(value: number): string {
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor(value % 3600 / 60);
  const seconds = (value % 60).toFixed(1).padStart(4, '0');
  return `${hours ? `${hours}:` : ''}${String(minutes).padStart(2, '0')}:${seconds}`;
}

// Keep existing cue times while mapping paragraph edits back onto their text.
export function editTranscript(cues: CaptionCue[], text: string): CaptionCue[] {
  const before = cues.map(cue => cue.text).join('\n');
  let prefix = 0;
  while (prefix < before.length && prefix < text.length && before[prefix] === text[prefix]) prefix++;
  let suffix = 0;
  while (suffix < before.length - prefix && suffix < text.length - prefix && before[before.length - suffix - 1] === text[text.length - suffix - 1]) suffix++;
  const oldEnd = before.length - suffix;
  const newEnd = text.length - suffix;
  let oldOffset = 0;
  let newOffset = 0;
  return cues.map((cue, index) => {
    oldOffset += cue.text.length;
    let boundary = oldOffset;
    if (index === cues.length - 1) boundary = text.length;
    else if (boundary >= oldEnd) boundary += text.length - before.length;
    else if (boundary > prefix) {
      boundary = prefix + Math.round((boundary - prefix) / (oldEnd - prefix) * (newEnd - prefix));
      // Keep whole words when a pasted paragraph spans several timed captions.
      while (boundary < newEnd && boundary > 0 && !/\s/u.test(text[boundary]) && !/\s/u.test(text[boundary - 1])) boundary++;
    }
    boundary = Math.max(newOffset, Math.min(text.length, boundary));
    const next = { ...cue, text: text.slice(newOffset, boundary).trim() };
    newOffset = boundary;
    // The separator belongs to the editor, rather than the caption text.
    if (text[newOffset] === '\n') newOffset++;
    oldOffset++;
    return next;
  });
}

export default function ClipEditor({ duration, url, videoId, defaults, formatLabel, pending, error, onConfirm, onClose }: {
  duration: number;
  defaults?: SettingsConfig;
  url?: string;
  videoId?: string;
  formatLabel: string;
  pending: boolean;
  error?: string;
  onConfirm: (ranges: Range[], captions?: CaptionCue[], autoPortrait?: boolean) => void;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<SavedRange[]>([]);
  const [draft, setDraft] = useState<Range>({ start: 0, end: duration });
  const [draftChanged, setDraftChanged] = useState(false);
  const [ready, setReady] = useState(false);
  const [previewError, setPreviewError] = useState(false);
  const [playhead, setPlayhead] = useState(0);
  const [captions, setCaptions] = useState<CaptionCue[]>([]);
  const [original, setOriginal] = useState<CaptionCue[]>([]);
  const [showCaptions, setShowCaptions] = useState(defaults?.captions_enabled ?? false);
  const [autoPortrait, setAutoPortrait] = useState(defaults?.auto_portrait ?? false);
  const [language, setLanguage] = useState(defaults?.default_caption_language === 'original' ? '' : defaults?.default_caption_language ?? '');
  const [languages, setLanguages] = useState<string[]>([]);
  const [loadingTranscript, setLoadingTranscript] = useState(false);
  const [captionError, setCaptionError] = useState('');
  const [automatic, setAutomatic] = useState(false);
  const [onlySelection, setOnlySelection] = useState(true);
  const [retrySeconds, setRetrySeconds] = useState(0);
  const [transcriptEdit, setTranscriptEdit] = useState<{ key: string; text: string; baseline: CaptionCue[] } | null>(null);
  const loadingGuard = useRef(false);
  const nextId = useRef(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const busy = useRef(pending);
  busy.current = pending;
  const previewUrl = apiUrl(`/preview/player?video_id=${encodeURIComponent(videoId ?? '')}`);
  const previewOrigin = new URL(previewUrl, location.href).origin;
  const gap = Math.min(0.1, duration);

  useEffect(() => {
    const modal = dialog.current;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    modal?.showModal();
    const cancel = (event: Event) => { event.preventDefault(); if (!busy.current) close.current(); };
    modal?.addEventListener('cancel', cancel);
    return () => {
      modal?.removeEventListener('cancel', cancel);
      modal?.close();
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, []);

  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.origin !== previewOrigin || event.source !== frame.current?.contentWindow || event.data?.source !== 'clip-preview') return;
      if (event.data.type === 'ready') { setReady(true); setPreviewError(false); }
      if (event.data.type === 'error') { setPreviewError(true); setReady(false); }
      if (event.data.type === 'time' && Number.isFinite(event.data.time)) setPlayhead(event.data.time);
    };
    window.addEventListener('message', receive);
    const timeout = window.setTimeout(() => setPreviewError(true), 15000);
    return () => { window.removeEventListener('message', receive); window.clearTimeout(timeout); };
  }, [previewOrigin]);

  const command = (data: object) => frame.current?.contentWindow?.postMessage({ source: 'clip-editor', ...data }, previewOrigin);
  const select = (field: keyof Range, value: number) => {
    const time = Math.round(value * 10) / 10;
    const next = field === 'start'
      ? { ...draft, start: Math.max(0, Math.min(time, draft.end - gap)) }
      : { ...draft, end: Math.min(duration, Math.max(time, draft.start + gap)) };
    setDraft(next);
    setDraftChanged(true);
    command({ type: 'seek', time: next[field] });
  };
  const save = () => {
    setRows([...rows, { ...draft, id: nextId.current++ }]);
    setDraft({ start: 0, end: duration });
    setDraftChanged(false);
    command({ type: 'seek', time: 0 });
  };

  useEffect(() => {
    if (retrySeconds <= 0) return;
    const timer = window.setTimeout(() => setRetrySeconds(Math.max(0, retrySeconds - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [retrySeconds]);

  const loadCaptions = async (selected?: string) => {
    if (loadingGuard.current || retrySeconds > 0) return;
    loadingGuard.current = true;
    setLoadingTranscript(true);
    setCaptionError('');
    try {
      const result = await getTranscript(url || `https://www.youtube.com/watch?v=${videoId}`, selected);
      setCaptions(result.cues);
      setTranscriptEdit(null);
      setOriginal(result.cues.map(cue => ({ ...cue })));
      setLanguage(result.language);
      setLanguages(result.languages);
      setAutomatic(result.automatic);
      setShowCaptions(true);
    } catch (error) {
      setCaptionError(error instanceof Error ? error.message : 'Could not load transcript.');
      const delay = (error as { retryAfter?: number })?.retryAfter;
      if (delay && Number.isFinite(delay)) setRetrySeconds(Math.ceil(delay));
    }
    finally { loadingGuard.current = false; setLoadingTranscript(false); }
  };
  useEffect(() => {
    if (defaults?.captions_enabled) void loadCaptions(language || undefined);
  }, []);

  const visibleIndices = captions.flatMap((cue, index) => !onlySelection || (cue.end > draft.start && cue.start < draft.end) ? [index] : []);
  const selectionKey = `${onlySelection ? `${draft.start}:${draft.end}` : 'all'}:${visibleIndices.join(',')}`;
  const visibleCues = visibleIndices.map(index => captions[index]);
  const session = transcriptEdit?.key === selectionKey ? transcriptEdit : null;
  const transcriptText = session?.text ?? visibleCues.map(cue => cue.text).join('\n');
  const editSelection = (text: string) => {
    const baseline = session?.baseline ?? visibleCues;
    const updated = editTranscript(baseline, text);
    const next = [...captions];
    visibleIndices.forEach((index, i) => { next[index] = updated[i]; });
    setCaptions(next);
    setTranscriptEdit({ key: selectionKey, text, baseline });
  };
  const invalidCaptions = showCaptions && (!captions.length || captions.some(cue => !Number.isFinite(cue.start) || !Number.isFinite(cue.end) || cue.start < 0 || cue.end <= cue.start || cue.end > duration) || rows.some(row => !captions.some(cue => cue.text.trim() && cue.end > row.start && cue.start < row.end)));
  const captionStyle = { ...defaultCaptionStyle, ...defaults?.caption_style };
  const activeCaption = showCaptions ? captions.filter(cue => cue.start <= playhead && cue.end > playhead).map(cue => cue.text).join('\n') : '';

  return (
    <dialog ref={dialog} aria-labelledby="clip-editor-title" className="clip-modal w-[calc(100%-2rem)] max-w-4xl rounded-2xl border border-slate-700 bg-slate-900 p-0 text-slate-100 shadow-2xl">
      <div className="max-h-[90vh] overflow-y-auto p-5 sm:p-6">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 id="clip-editor-title" className="text-xl font-semibold">Cut video clips</h2>
            <p className="mt-1 text-sm text-cyan-300">{formatLabel}</p>
          </div>
          <button type="button" disabled={pending} onClick={onClose} aria-label="Close clip editor" className="rounded-lg border border-slate-600 px-3 py-2 text-sm disabled:opacity-50">Close</button>
        </div>
        <div className="relative aspect-video overflow-hidden rounded-xl border border-slate-700 bg-black" style={{ containerType: 'size' }}>
          <iframe ref={frame} src={previewUrl} title="Video playback for clip selection" className="h-full w-full border-0" allow="autoplay; encrypted-media; fullscreen; picture-in-picture" allowFullScreen />
          {activeCaption && <CaptionOverlay style={captionStyle} text={activeCaption} />}
        </div>
        {showCaptions && <div aria-label="Caption preview" className="min-h-14 whitespace-pre-line rounded-b-lg bg-black px-5 py-3 text-center text-lg font-semibold text-white">{activeCaption || <span className="text-sm font-normal text-slate-400">Caption preview · play your selection to preview captions</span>}</div>}
        {previewError && !ready && <p role="status" className="mt-2 text-sm text-amber-300">Playback is unavailable or still loading. Some videos do not allow embedded playback. You can still choose clip ranges below.</p>}
        <fieldset disabled={pending} className="mt-4 rounded-xl border border-slate-700 bg-slate-950 p-4">
          <legend className="px-2 text-sm font-semibold">Current selection</legend>
          <div className="flex flex-wrap justify-between gap-2 text-sm">
            <span className="text-cyan-300">Start: <strong>{timestamp(draft.start)}</strong></span>
            <span className="text-slate-400">Playback: {timestamp(playhead)}</span>
            <span className="text-violet-300">End: <strong>{timestamp(draft.end)}</strong></span>
          </div>
          <div className="clip-timeline relative mx-2 my-5 h-8">
            <div className="absolute inset-x-0 top-3 h-2 rounded bg-slate-700" />
            <div className="absolute top-3 h-2 bg-cyan-500" style={{ left: `${draft.start / duration * 100}%`, width: `${(draft.end - draft.start) / duration * 100}%` }} />
            <input type="range" min={0} max={duration} step="0.1" value={draft.start} aria-label="Clip start time" aria-valuetext={timestamp(draft.start)} onChange={event => select('start', Number(event.target.value))} className="clip-handle clip-start" />
            <input type="range" min={0} max={duration} step="0.1" value={draft.end} aria-label="Clip end time" aria-valuetext={timestamp(draft.end)} onChange={event => select('end', Number(event.target.value))} className="clip-handle clip-end" />
          </div>
          <div className="flex justify-between text-xs text-slate-500"><span>00:00.0</span><span>{timestamp(duration)}</span></div>
          <p className="mt-3 text-sm text-slate-400">Drag the cyan handle for start and the violet handle for end. Add the selection to save it and reset both handles for the next clip.</p>
          <div className="mt-4 flex flex-wrap gap-3">
            <button type="button" disabled={!ready} onClick={() => command({ type: 'range', ...draft })} className="rounded-lg border border-slate-600 px-3 py-2 text-sm disabled:opacity-50">Play selection</button>
            <button type="button" disabled={rows.length >= 50} onClick={save} className="rounded-lg border border-cyan-600 px-3 py-2 text-sm text-cyan-300 disabled:opacity-50">Add selection</button>
            <button type="button" onClick={() => { setDraft({ start: 0, end: duration }); setDraftChanged(false); command({ type: 'seek', time: 0 }); }} className="rounded-lg border border-slate-600 px-3 py-2 text-sm">Reset current range</button>
            <span className="self-center text-sm text-slate-400">Length: {timestamp(draft.end - draft.start)}</span>
          </div>
        </fieldset>
        <fieldset disabled={pending} className="mt-5 rounded-xl border border-slate-700 bg-slate-950 p-4">
          <legend className="px-2 font-semibold">Mobile framing</legend>
          <label className="flex items-center gap-3 text-base"><input aria-label="Automatically follow people" type="checkbox" checked={autoPortrait} onChange={event => setAutoPortrait(event.target.checked)} />Portrait 9:16 · Automatically follow people</label>
          <p className="mt-2 text-sm text-slate-400">Export a 1080 × 1920 MP4. The crop follows the main person, holds position through brief gaps, and uses the center if nobody is detected. With multiple people, one main subject is prioritized.</p>
          {autoPortrait && <p role="status" className="mt-2 text-sm text-cyan-300">Tracking runs locally after downloading each clip and takes extra processing time. This source preview stays uncropped; the downloaded clip uses the moving portrait crop. Captions are placed inside the portrait frame.</p>}
        </fieldset>
        <fieldset disabled={pending || loadingTranscript} className="mt-5 rounded-xl border border-slate-700 bg-slate-950 p-4">
          <legend className="px-2 font-semibold">Transcript captions</legend>
          <p className="text-sm text-slate-400">Load the video's transcript, then edit your selected range together in one text box. Enabled captions are permanently visible in downloaded clips (MP4).</p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button type="button" disabled={retrySeconds > 0 || loadingTranscript} onClick={() => loadCaptions(language || undefined)} className="rounded-lg border border-cyan-600 px-3 py-2 text-sm text-cyan-300">{retrySeconds > 0 ? `Try again in ${retrySeconds}s` : loadingTranscript ? 'Loading transcript…' : captions.length ? 'Reload transcript' : 'Load transcript'}</button>
            {!!language && !languages.length && <span className="text-sm text-cyan-300">Requested caption language: {language}</span>}
            {!!languages.length && <label className="text-sm">Language <select aria-label="Transcript language" value={language} onChange={event => setLanguage(event.target.value)} className="ml-2 rounded border border-slate-600 bg-slate-900 p-2">{languages.map(lang => <option key={lang} value={lang}>{lang}</option>)}</select></label>}
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={showCaptions} disabled={!captions.length} onChange={event => setShowCaptions(event.target.checked)} />Show captions in clips</label>
          </div>
          {captionError && <p role="alert" className="mt-3 text-sm text-red-300">{captionError}</p>}
          {!!captions.length && <>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm">
              <span className="text-slate-400">{automatic ? 'Automatic' : 'Manual'} transcript · {onlySelection ? `${timestamp(draft.start)} – ${timestamp(draft.end)}` : 'Entire video'}</span>
              <label className="flex items-center gap-2"><input aria-label="Only current selection" type="checkbox" checked={onlySelection} onChange={event => { setOnlySelection(event.target.checked); setTranscriptEdit(null); }} />Only current selection</label>
            </div>
            <label htmlFor="selection-transcript" className="mt-3 block font-medium">{onlySelection ? 'Selected range transcript' : 'Full transcript'}</label>
            <textarea id="selection-transcript" aria-label="Transcript text" aria-describedby="transcript-edit-help" value={transcriptText} disabled={!visibleCues.length} rows={9} onChange={event => editSelection(event.target.value)} placeholder="No transcript is available for this range. Adjust the clip selection to include speech." className="mt-2 w-full resize-y rounded-lg border border-slate-600 bg-slate-900 p-4 text-base leading-7 text-slate-100 focus:border-cyan-400 focus:outline-none disabled:opacity-60" />
            <p id="transcript-edit-help" className="mt-2 text-sm text-slate-400">Edit the whole passage here. Caption timing is kept automatically; larger rewrites are spread across the existing caption times. Reloading replaces edits.</p>
            <div className="mt-3 flex flex-wrap gap-4 text-sm">
              <button type="button" disabled={!ready || !visibleCues.length} onClick={() => command({ type: 'range', start: onlySelection ? draft.start : 0, end: onlySelection ? draft.end : duration })} className="text-cyan-300 disabled:opacity-50">Preview transcript</button>
              <button type="button" onClick={() => { setCaptions(original.map(cue => ({ ...cue }))); setTranscriptEdit(null); }} className="text-cyan-300">Reset transcript edits</button>
            </div>
          </>}
          {invalidCaptions && <p role="alert" className="mt-3 text-sm text-amber-300">Ensure each saved clip has a nonempty caption, or turn captions off.</p>}
        </fieldset>
        <section aria-labelledby="saved-clips-title" className="mt-5">
          <h3 id="saved-clips-title" className="font-semibold">Saved selections ({rows.length}/50)</h3>
          {!rows.length && <p className="mt-2 text-sm text-slate-400">No saved clips. Choose a range and click Add selection.</p>}
          <ul className="mt-3 max-h-48 space-y-2 overflow-y-auto" aria-live="polite">
            {rows.map((row, index) => (
              <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm">
                <span>Clip {index + 1} · {timestamp(row.start)} – {timestamp(row.end)}</span>
                <div className="flex gap-3">
                  <button type="button" disabled={pending || !ready} onClick={() => command({ type: 'range', start: row.start, end: row.end })} className="text-cyan-300 disabled:opacity-50" aria-label={`Play clip ${index + 1}`}>Play</button>
                  <button type="button" disabled={pending} onClick={() => setRows(rows.filter(item => item.id !== row.id))} className="text-red-300 disabled:opacity-50" aria-label={`Delete clip ${index + 1}`}>Delete</button>
                </div>
              </li>
            ))}
          </ul>
        </section>
        {error && <p role="alert" className="mt-3 text-sm text-red-300">{error}</p>}
        {draftChanged && <p role="status" className="mt-3 text-sm text-amber-300">Your current range is not saved yet. Click Add selection to include it.</p>}
        <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-slate-700 pt-4">
          <button type="button" disabled={pending || loadingTranscript || invalidCaptions || !rows.length || draftChanged} onClick={() => onConfirm(rows.map(({ start, end }) => ({ start, end })), showCaptions ? captions : undefined, autoPortrait)} className="rounded-lg bg-cyan-500 px-4 py-2 font-medium text-slate-950 disabled:opacity-50">{pending ? 'Queuing clips…' : `Download ${rows.length} clip${rows.length === 1 ? '' : 's'}`}</button>
          <button type="button" disabled={pending} onClick={onClose} className="rounded-lg border border-slate-600 px-4 py-2">Cancel</button>
          <p className="text-xs text-slate-400">Only saved selections download, each as a separate file.</p>
        </div>
      </div>
    </dialog>
  );
}

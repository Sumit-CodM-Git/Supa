import { useEffect, useState } from 'react';
import type { CaptionStyle, SettingsConfig } from '../api/types';
import { CaptionOverlay, defaultCaptionStyle } from '../components/CaptionAppearance';

const languages = [['original', 'Original video language'], ['en', 'English'], ['hi', 'Hindi'], ['bn', 'Bengali'], ['ta', 'Tamil'], ['te', 'Telugu'], ['mr', 'Marathi'], ['gu', 'Gujarati'], ['kn', 'Kannada'], ['ml', 'Malayalam'], ['pa', 'Punjabi'], ['ur', 'Urdu'], ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'], ['pt', 'Portuguese'], ['ar', 'Arabic'], ['ja', 'Japanese'], ['ko', 'Korean'], ['zh-Hans', 'Chinese (Simplified)']];
const input = 'mt-2 w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-base';

export default function SettingsPage({ settings, onSave, pending, error, saved }: {
  settings: SettingsConfig; onSave: (value: SettingsConfig) => void; pending: boolean; error?: string; saved: boolean;
}) {
  const [draft, setDraft] = useState(settings);
  useEffect(() => setDraft(settings), [settings]);
  const [sample, setSample] = useState('Your story, in your words.\nअपनी कहानी, अपनी ज़ुबानी।');
  const [portraitPreview, setPortraitPreview] = useState(false);
  const style = { ...defaultCaptionStyle, ...draft.caption_style };
  const update = (changes: Partial<SettingsConfig>) => setDraft({ ...draft, ...changes });
  const appearance = (changes: Partial<CaptionStyle>) => update({ caption_style: { ...style, ...changes } });
  const dirty = JSON.stringify(draft) !== JSON.stringify(settings);

  return <section>
    <h1 className="text-3xl font-semibold">Settings &amp; Editing</h1>
    <p className="mt-2 text-slate-400">Save your caption appearance, language, and clip defaults for future edits.</p>
    <form onSubmit={event => { event.preventDefault(); onSave(draft); }} className="mt-6 grid gap-6 lg:grid-cols-[1fr_380px]">
      <fieldset disabled={pending} className="space-y-6">
        <div className="rounded-2xl border border-slate-700 bg-slate-900 p-5">
          <h2 className="text-xl font-semibold">Caption language &amp; clip defaults</h2>
          <label className="mt-4 block">Default caption language<select aria-label="Default caption language" value={draft.default_caption_language} onChange={event => update({ default_caption_language: event.target.value })} className={input}>{languages.map(([code, name]) => <option key={code} value={code}>{name}</option>)}{!languages.some(([code]) => code === draft.default_caption_language) && <option value={draft.default_caption_language}>{draft.default_caption_language}</option>}</select></label>
          <p className="mt-2 text-sm text-slate-400">A selected language requests matching or auto-translated YouTube captions even if the video is spoken in another language. Translations depend on YouTube availability and rate limits. Original video language avoids requesting translation.</p>
          <label className="mt-4 flex gap-3"><input type="checkbox" checked={draft.captions_enabled} onChange={event => update({ captions_enabled: event.target.checked })} />Enable captions by default</label>
          <label className="mt-3 flex gap-3"><input type="checkbox" checked={draft.auto_portrait} onChange={event => update({ auto_portrait: event.target.checked })} />Default to 9:16 portrait with automatic person tracking</label>
        </div>
        <div className="rounded-2xl border border-slate-700 bg-slate-900 p-5">
          <h2 className="text-xl font-semibold">Caption appearance</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label>Font family<select value={style.font} onChange={event => appearance({ font: event.target.value as CaptionStyle['font'] })} className={input}>{['Arial', 'Helvetica', 'Georgia', 'Verdana', 'Courier New', 'Times New Roman'].map(font => <option key={font}>{font}</option>)}</select></label>
            <label>Font size · {style.size}<input type="range" min={12} max={48} value={style.size} onChange={event => appearance({ size: Number(event.target.value) })} className="mt-4 w-full" /></label>
            {(['color', 'outline_color', 'background_color'] as const).map((key, index) => <label key={key}>{['Text color', 'Outline color', 'Background & shadow color'][index]}<input type="color" value={style[key]} onChange={event => appearance({ [key]: event.target.value })} className="mt-2 block h-11 w-full rounded border border-slate-600 bg-slate-950" /></label>)}
            <label>Vertical position<select value={style.position} onChange={event => appearance({ position: event.target.value as CaptionStyle['position'] })} className={input}>{['top', 'middle', 'bottom'].map(position => <option key={position}>{position}</option>)}</select></label>
            <label>Alignment<select value={style.align} onChange={event => appearance({ align: event.target.value as CaptionStyle['align'] })} className={input}>{['left', 'center', 'right'].map(align => <option key={align}>{align}</option>)}</select></label>
            {(['margin', 'outline', 'shadow'] as const).map(key => <label key={key} className="capitalize">{key} · {style[key]}<input type="range" min={0} max={key === 'margin' ? 80 : 5} value={style[key]} onChange={event => appearance({ [key]: Number(event.target.value) })} className="mt-4 w-full" /></label>)}
          </div>
          <div className="mt-5 flex flex-wrap gap-5">{(['bold', 'italic', 'background'] as const).map(key => <label key={key} className="flex gap-2 capitalize"><input type="checkbox" checked={style[key]} onChange={event => appearance({ [key]: event.target.checked })} />{key === 'background' ? 'Background box' : key}</label>)}</div>
          <button type="button" onClick={() => appearance(defaultCaptionStyle)} className="mt-5 text-sm text-cyan-300">Reset caption appearance</button>
        </div>
        <div className="rounded-2xl border border-slate-700 bg-slate-900 p-5">
          <h2 className="text-xl font-semibold">Downloads</h2>
          <label className="mt-4 block">Download folder<input required value={draft.download_dir} onChange={event => update({ download_dir: event.target.value })} className={input} /></label>
          <label className="mt-4 block">Concurrent downloads<input type="number" min={1} max={8} value={draft.max_concurrent} onChange={event => update({ max_concurrent: Number(event.target.value) })} className={input} /></label>
          <label className="mt-4 flex gap-3"><input type="checkbox" checked={draft.keep_original} onChange={event => update({ keep_original: event.target.checked })} />Keep partial files when canceled</label>
        </div>
        {error && <p role="alert" className="text-red-300">{error}</p>}
        {saved && !dirty && <p role="status" className="text-green-300">Settings saved. New clip sessions use these defaults.</p>}
        {dirty && <p className="text-sm text-amber-300">You have unsaved changes.</p>}
        <button type="submit" disabled={pending || !draft.download_dir.trim() || !dirty} className="rounded-lg bg-cyan-500 px-5 py-3 font-semibold text-slate-950 disabled:opacity-50">{pending ? 'Saving…' : 'Save defaults'}</button>
      </fieldset>
      <aside className="self-start rounded-2xl border border-slate-700 bg-slate-900 p-5 lg:sticky lg:top-5">
        <h2 className="text-xl font-semibold">Caption preview</h2>
        <label className="my-4 flex gap-2 text-sm"><input type="checkbox" checked={portraitPreview} onChange={event => setPortraitPreview(event.target.checked)} />Portrait preview</label>
        <div className={`relative mx-auto overflow-hidden rounded-xl border border-slate-600 bg-gradient-to-b from-slate-700 via-slate-800 to-black ${portraitPreview ? 'aspect-[9/16] max-w-64' : 'aspect-video w-full'}`} style={{ containerType: 'size' }}>
          <div className="absolute inset-0 flex items-center justify-center text-sm text-slate-500">Sample video frame</div>
          <CaptionOverlay style={style} text={sample} />
        </div>
        <label className="mt-4 block text-sm">Preview text<textarea value={sample} onChange={event => setSample(event.target.value)} rows={3} className={input} /></label>
        <p className="mt-3 text-sm text-slate-400">Appearance preview only. Available fonts and wrapping may differ slightly in the exported video. Font size and margins scale with the frame.</p>
      </aside>
    </form>
  </section>;
}

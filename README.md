# YouTube Downloader

A local-only YouTube downloader built with FastAPI and a React frontend.

## Chrome extension

1. Run `./run.sh` and leave the terminal open. This builds the website and Chrome extension and starts the local backend.
2. Open `chrome://extensions` in Chrome and enable **Developer mode**.
3. Click **Load unpacked** and select the `frontend/extension-dist` folder in this project.
4. Pin **Local YouTube Downloader** using Chrome's Extensions menu.
5. Open a YouTube video and click the extension icon. The downloader opens in a new tab with that URL filled in. Click **Inspect**, then choose a format to download. You can also paste URLs directly.

The extension includes formats, MP3 conversion, download progress, history, folder settings, and links to completed files. Downloads continue in the local backend when the extension tab is closed. Reopen the extension to see progress and history. Files are saved to the backend's configured download folder.

The backend is required: Chrome cannot run Python, yt-dlp, or ffmpeg inside the extension. It uses port **8000** for extension use. Install automatic startup below to launch it when you click the extension. Node.js or Deno and ffmpeg requirements below also apply to the extension.

### Automatic startup on macOS

After the initial `./run.sh` setup and loading the extension, copy its 32-character ID from its card at `chrome://extensions`. From the project folder, run this once with that ID as the final argument:

```bash
.venv/bin/python -m backend.install_native_host YOUR_EXTENSION_ID
```

Reload the extension to grant its new native messaging permission. Clicking the toolbar icon now opens the downloader and starts the backend automatically. An existing running backend is reused. There is no terminal to keep open; the backend continues running after the extension tab closes and stops at shutdown. After reboot, clicking the extension starts it again. Opening a previously saved extension tab directly does not trigger startup; use the toolbar icon.

The helper is registered only for the specified extension in `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.local.youtube_downloader.json`. Its launcher lives in `data/start-native-host.sh`, and backend logs go to `data/backend.log`. The helper only accepts a fixed start action, binds the backend to `127.0.0.1:8000`, and does not install dependencies on launch. If you move the project or change the extension ID, run the installer again. Delete that native host JSON file to remove automatic startup.

To rebuild only the extension after editing it:

```bash
cd frontend
npm run build:extension
```

Then click **Reload** on its card at `chrome://extensions` and reopen its tab. The extension uses Manifest V3, bundled scripts, temporary access to the tab where its icon is clicked, native messaging for local startup, and host access only to `127.0.0.1`. It does not inject scripts or request cookies or browsing history.

## Quick start

```bash
./run.sh
```

The app listens on http://127.0.0.1:8000.

Paste a YouTube video URL to automatically load all available source formats, including codec and streaming protocol variants. You can also select **Inspect**. Use a format's **Download** button to queue it. Completed entries show the saved file path and an **Open downloaded file** link.

## Multiple clips

After inspecting a video, each video format offers **Download entire video** and **Clip cut download**. Choose **Clip cut download** to open a modal with video playback. Drag the cyan start handle and violet end handle on the timeline; timestamps update automatically. **Play selection** previews the current range and pauses at its end. **Add selection** saves the range and resets both handles to the full timeline for the next selection, preserving earlier clips. Add up to 50 selections, preview saved clips, or delete unwanted ones. **Reset current range** discards an unsaved range. No downloads start while editing. Click **Download clips** (the button includes the clip count) to queue the saved selections as separate files. Clips appear individually in Downloads and History, with their time ranges in the labels and unique filenames. Overlapping ranges are allowed.

Clipping requires ffmpeg and a finished video with a known duration. Precise cuts re-encode video and may take time. Depending on the stream, extra media data may be fetched. Playback uses YouTube's embedded player through a local preview page; videos that block embedding may not play, but their clip ranges can still be selected. Reload the extension and restart the backend after updating to add the preview routes.

## Mobile portrait clips with automatic person tracking

In **Clip cut download**, enable **Mobile framing → Portrait 9:16 · Automatically follow people**. Each saved selection exports as a **1080 × 1920 MP4**, using local face/person detection to follow a main subject with smooth pans. The source preview stays uncropped; tracking runs after download and the result is available from Downloads/History. Enable transcript captions as usual: captions render after the crop so they remain inside the portrait frame.

Tracking uses Apple's built-in Vision and AVFoundation frameworks on macOS, with no cloud service, additional Python packages, or downloaded models. Apple's command line tools (`xcode-select --install`) are required; the native helper is compiled into `data/native` on first use. Processing takes extra time and can be canceled. Multiple people are handled by prioritizing a prominent subject and continuity; a narrow crop cannot retain everyone. Brief detection gaps hold the last position. If nobody is detected, the clip uses a centered portrait crop and its history label says so. Fast cuts, obscured people, and poor source quality can reduce tracking accuracy. Higher-resolution source formats produce sharper portrait clips.

## Editable transcript captions

In **Clip cut download**, choose **Load transcript** under **Transcript captions**. The editor prefers manual captions and original-language automatic transcripts. This avoids choosing automatically translated captions by default. Other available languages remain selectable. Select another language and click **Reload transcript** to load it; reloading replaces edits. Videos without an available transcript can still be clipped with captions off. This feature uses existing transcripts, rather than generating speech recognition locally. Successful transcripts are cached locally for 24 hours, including across backend restarts. YouTube rate limits (HTTP 429) show a retry countdown of at least 60 seconds, respecting a longer server Retry-After value. Repeated clicks during cooldown do not request YouTube again; loaded transcripts and edits remain available. Translation requests may still be rate limited by YouTube.

Enable **Show captions in clips** to preview captions during playback and permanently render them into every downloaded clip. The transcript for the current selection appears together in one editable text box. Edit the whole passage without opening separate caption cards. Existing caption times are preserved automatically; larger rewrites are spread across those times. **Preview transcript** plays the selected range, **Only current selection** switches between the selected passage and the entire video, and **Reset transcript edits** restores the loaded transcript. Remove text to omit it. Edits apply across the saved clips in the current editor session; closing the editor discards edits.

Each caption is trimmed and timed relative to its downloaded clip automatically. Every saved clip must contain a nonempty caption when captions are enabled. Captioned clips are exported as MP4 with H.264 video and AAC audio; rendering takes extra time and requires ffmpeg with its `subtitles` filter (libass). Turning captions off preserves ordinary clip downloads. After updating, restart the backend and reload the unpacked Chrome extension to use the new editor.

## Settings & Editing

Open **Settings & Editing** in the main navigation to save defaults locally. The page includes a live caption appearance preview in landscape or portrait, font family and size, bold/italic text, text/outline/background colors, a background box, shadow, vertical position, alignment, and margins. Preview text is editable. Save with **Save defaults**; caption appearance is applied to clip previews and burned-in exports. Queued jobs retain the style they were queued with. Font fallback and wrapping may differ slightly between the browser and ffmpeg.

Choose a **Default caption language** to request that language even when the video uses another spoken language. YouTube's matching manual captions or auto-translated transcript are used when available. The app reports unavailable languages and translation rate limits rather than silently switching back to the source language. This uses YouTube translations; it does not include a separate translation or speech-recognition model. **Original video language** retains original-track selection. Successful translations use the existing 24-hour transcript cache and rate-limit cooldown.

You can also enable captions by default (automatically loads the transcript when opening a new clip editor), default to person-following portrait crops, and set the download folder, concurrency, and partial-file retention. These defaults persist across restarts. Existing edited captions are not automatically retranslated after changing the language; open a new clip session or reload the chosen language.

## Download folder

Open **Settings & Editing**, enter an absolute folder path (or a path relative to the app folder) under Downloads, and choose **Save defaults**. The app creates the folder if needed, checks that it is writable, and persists the setting in `data/config.json`. New downloads use the selected folder.

## Development

```bash
python -m pip install -r requirements.txt
cd frontend && npm install
npm run dev
```

The backend can also be run directly:

```bash
uvicorn backend.main:app --host 127.0.0.1 --port 8000 --reload
```

## YouTube format extraction

Install Node.js (22 or newer) or Deno and keep it on the backend's PATH. The backend automatically enables either runtime for YouTube JavaScript challenges. The pinned `yt-dlp[default]` dependency installs the matching challenge solver scripts. ffmpeg is required to merge separate video/audio streams and convert MP3s.

The app uses yt-dlp's maintained default YouTube clients. Legacy `android,web` settings are migrated automatically because they can return only 360p. Extraction warnings remain visible in the backend terminal. Only formats returned by YouTube are listed; DRM formats and storyboards are excluded.

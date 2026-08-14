# Video Viewer

A fast, mobile-first, **single-file** video viewer. Drag & drop a `.webm`,
`.mp4`, `.m4v`, `.ogv`, `.mov`, or `.mkv` and watch it — with keyboard
shortcuts, a metadata readout, and one-click **frame capture to PNG**. It's a
**viewer** — no accounts, no uploads. Everything runs locally in your browser.

🔗 **Live:** <https://video-viewer.us/>

![Single file](https://img.shields.io/badge/build-single%20HTML%20file-success) ![No build step](https://img.shields.io/badge/build%20step-none-success) ![License](https://img.shields.io/badge/license-MIT-blue)

> Part of the **[File Viewer](https://file-viewer.us/) family** — HTML, Markdown,
> ePUB, PDF, Data, DOCX, Sheets, EML, PPTX, Log, Cert, PUB, Image, Audio, and
> Video each have their own dedicated viewer. Use the **☰ menu** in the header
> to jump between them.

## Features

- 🎬 **Native playback** — the browser's own `<video>` decoder plays your file
  straight from an in-memory object URL. No re-encoding, no upload, no wait.
- 📸 **Grab any frame as a PNG** — pause (or don't) and hit the camera button:
  the current frame is saved at the video's intrinsic resolution as
  `name-1m23s.png`. Works fully offline.
- ⌨️ **Keyboard shortcuts** — <kbd>Space</kbd> play/pause, <kbd>←</kbd>/<kbd>→</kbd>
  seek ±5 s, <kbd>↑</kbd>/<kbd>↓</kbd> volume, <kbd>M</kbd> mute,
  <kbd>F</kbd> fullscreen.
- 📐 **Metadata at a glance** — intrinsic dimensions, duration, MIME type, and
  file size under the stage.
- 🖤 **Neutral stage** — the video sits on a dark letterbox; your chosen
  background color themes the chrome, never the picture.
- ☰ **Family menu** · 🫥 **auto-hiding header** · 🎨 **pick any background color**.
- 🪶 **One file, no build, no dependencies** — works offline, even from `file://`.
- 📊 **Privacy-friendly analytics** — self-hosted, cookieless
  [Plausible](https://plausible.io/); your videos never leave your device.

## Supported file types

`.webm` `.mp4` `.m4v` `.ogv` `.mov` `.mkv`

**Honesty about codecs:** the viewer hands your file to the *browser's* decoder,
so support varies by browser. `.webm` (VP8/VP9/AV1) and `.mp4` (H.264) play
almost everywhere; `.mov`, `.mkv`, and HEVC/H.265-in-MP4 play in some browsers
and not others. When the browser can't decode a file you get an honest hint
card — never a silent failure.

`.avi` and `.wmv` are accepted with a notice: browsers have no native decoder
for them. Convert to MP4 (H.264) or WebM first — e.g. with
[HandBrake](https://handbrake.fr/) or `ffmpeg -i input.avi output.mp4` — and
drop the result here.

## Quick start

**Just open it.** Download [`index.html`](index.html), double-click it — no
server, no build, no internet needed.

```sh
python3 -m http.server 8080   # then open http://localhost:8080
```

## Deploy to Cloudflare Pages

The repo deploys via GitHub Actions
([`deploy.yml`](.github/workflows/deploy.yml)) to the Pages project
**video-viewer-us** — push to `main` deploys production, PRs get preview
deployments. The [`_headers`](_headers) file applies a strict CSP
automatically. Add the custom domain **video-viewer.us** under the project's
Custom domains tab.

## How it works

Everything is in [`index.html`](index.html) — **no third-party libraries.** The
file you drop is wrapped in an object URL (`URL.createObjectURL`) and mounted
on a native `<video controls playsinline>` element; nothing is ever read into
JS memory for playback, and the URL is revoked the moment you replace or close
the file. Frame capture draws the current frame onto a canvas at
`videoWidth × videoHeight` and downloads the PNG blob. The viewer's CSP stays
strict (`default-src 'none'`, `media-src 'self' blob:` only).

## Credits

No bundled libraries — playback is the browser's native `<video>` element and
frame capture is the Canvas API. The filmstrip icon is by the author. Headings
use the [JetBrains Mono](https://github.com/JetBrains/JetBrainsMono) typeface
(SIL OFL-1.1). Analytics by [Plausible](https://plausible.io/).

## License

[MIT](LICENSE) © 2026 Michal Ferber, aka **TechGuyWithABeard**.

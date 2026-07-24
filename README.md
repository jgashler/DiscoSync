<p align="center">
  <img src="DiscoSync_logo_noBG.png" alt="DiscoSync" width="140">
</p>

<h1 align="center">DiscoSync</h1>

<p align="center">Multi-angle video sync review tool for legal discovery footage</p>

Desktop app (Tauri + React + TypeScript + Tailwind), fully local/offline,
read-only against source video files. Built for reviewing multiple camera
angles of the same event, side by side, in perfect sync.

## Features

- **Add one video, or several angles of the same event.** Type in each
  one's start time of day and DiscoSync lines them up to play together
  automatically.
- **Drag and drop to rearrange.**
- **Fine-tune sync by hand**: When a video looks slightly out of step, adjust one
  frame at a time.
- **Slow down to a crawl (one frame per second) or speed up to 16x.**
- **Zoom into video**
- **Bookmark important moments** and jump straight back to them.
- **Loop a stretch of footage** to watch it over and over without
  re-scrubbing.
- **Save your project and pick up exactly where you left off**

## Install

See releases for the latest build. Currently Windows only.

## Development Setup

```sh
npm install
npm run tauri dev
```

## Development Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [Rust toolchain](https://www.rust-lang.org/tools/install) (via `rustup`),
  required by Tauri to build the native backend.
- Platform build tools per the [Tauri prerequisites guide](https://tauri.app/start/prerequisites/)
  (on Windows: the MSVC C++ build tools / Visual Studio Build Tools, and
  WebView2, which ships with Windows 10/11 by default).

## Project layout

```
src/                  # React frontend
  components/         # UI screens/components
  lib/                # Native (Tauri) bridges, time-sync math
  types/               # Shared TypeScript types (project/session model)
src-tauri/            # Rust backend (Tauri)
  capabilities/        # Permission scopes (dialog, read-only fs, asset protocol)
  src/                 # Rust source
```

## Build

```sh
npm run tauri build
```

## Contributing

Issues and pull requests are welcome. Free to fork and adapt for your own
use.

## License

MIT, see [LICENSE](LICENSE).

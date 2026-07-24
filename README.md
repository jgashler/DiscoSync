# DiscoSync

Multi-angle video sync review tool for legal discovery footage

Desktop app (Tauri + React + TypeScript + Tailwind), fully local/offline,
read-only against source video files.


## Install

See releases for latest release. Currently just Windows.

## Development Setup

```sh
npm install
npm run tauri dev
```

## Development Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [Rust toolchain](https://www.rust-lang.org/tools/install) (via `rustup`) —
  required by Tauri to build the native backend. Not installed on this
  machine yet as of scaffolding time.
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
# DiscoSync

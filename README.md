# AI Chat Duplicate Image Guard

A lightweight WebExtension for **Zen Browser**, **Firefox**, and other Gecko-based browsers that prevents accidentally pasting the exact same image or screenshot twice into the same message draft on AI chat platforms.

## Supported Platforms
- **Google Gemini** (`gemini.google.com`)
- **ChatGPT** (`chatgpt.com`)
- **Claude** (`claude.ai`)

## Features
- **Exact Byte-Level Detection (SHA-256):** Computes an in-memory SHA-256 fingerprint via the Web Crypto API, catching duplicate clipboard screenshots regardless of generic filenames (`image.png`).
- **Draft-Scoped Memory:** Tracks only the currently active message draft. Automatically resets when the message is sent, the conversation changes, or a preview thumbnail is removed (`X`).
- **Gemini Filename Collision Fix:** Prevents Firefox/Zen's generic clipboard filename (`image.png` / `resim.png`) from triggering duplicate filename errors when pasting multiple distinct screenshots into Gemini.
- **Zero Data Collection:** Runs 100% locally in browser memory with zero network requests, telemetry, or disk storage.

## Project Structure
- `manifest.json` — Extension configuration (Manifest V3)
- `content.js` — Clipboard interception, SHA-256 hashing, and DOM preview lifecycle tracking
- `page_bridge.js` — Main-world event bridge for seamless multi-image injection
- `icon.svg` — Vector extension icon

## Local Installation (Development)
1. Open `about:debugging` in Zen Browser or Firefox.
2. Navigate to **This Firefox / This Zen**.
3. Click **Load Temporary Add-on...** and select `manifest.json`.

## License
[MIT](LICENSE)
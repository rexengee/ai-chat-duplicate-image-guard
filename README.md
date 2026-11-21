# AI Chat Duplicate Image Guard

A lightweight Manifest V3 WebExtension for **Firefox**, **Zen Browser**, and other Gecko-based browsers that prevents accidentally pasting the exact same image or screenshot twice into the same message draft on AI chat platforms.

## Installation

### Firefox / Zen Browser (Recommended)
Install directly from [Mozilla Add-ons (AMO)]([AMO_ADDON_URL]).

### Local Installation (Development)
1. Open `about:debugging` in Firefox or Zen Browser.
2. Go to **This Firefox** / **This Zen**.
3. Click **Load Temporary Add-on...** and select `manifest.json`.

## Supported Platforms
- **Google Gemini** (`gemini.google.com`)
- **ChatGPT** (`chatgpt.com`)
- **Claude** (`claude.ai`)

## Features
- **Exact Byte-Level Detection (SHA-256):** Computes an in-memory SHA-256 fingerprint via the Web Crypto API, catching duplicate clipboard screenshots regardless of generic filenames (`image.png`).
- **Draft-Scoped Lifecycle Tracking:** Tracks only the currently active message draft and clears entries automatically when a thumbnail is removed (`X`), a message is sent, or the conversation changes.
- **Gemini Filename Collision Fix:** Assigns unique filenames when pasting multiple distinct screenshots into Gemini so generic browser clipboard names do not collide.
- **Multi-MIME Clipboard Deduplication:** Prevents redundant format entries for a single clipboard image (e.g., PNG + BMP) from being attached twice while keeping multi-file pastes intact.
- **Zero Data Collection:** Runs 100% locally in memory with no extra permissions, no network requests, and no persistent storage.

## Changelog

### v1.1.1
- Removed the timed 400 ms fallback drop on ChatGPT and Claude to prevent double-paste on slower uploads.
- Tightened preview card tracking and removed the 2-second automatic hash rollback so slow renders cannot weaken duplicate protection.
- Added multi-MIME clipboard deduplication, singleton script guards, and strict `window.location.origin` messaging.
- Fixed `Enter`-key draft reset when the cursor is inside a text node on Gecko browsers.

### v1.1.0
- Initial public release on Mozilla Add-ons.

## Project Structure
- `manifest.json` — Extension configuration (Manifest V3)
- `content.js` — Clipboard interception, SHA-256 hashing, and DOM preview lifecycle tracking
- `page_bridge.js` — Main-world event bridge for seamless multi-image injection
- `icon.svg` — Vector extension icon

## License
[MIT](LICENSE)
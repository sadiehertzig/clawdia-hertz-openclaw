# Voice Trivia

Voice-first trivia game powered by OpenAI's Realtime API, served as a Telegram Mini App. Falls back to text-based trivia when voice isn't available.

## Usage

- "Let's play trivia"
- "Voice trivia"
- "/trivia"

## How It Works

**Voice mode (Telegram):**
1. Bot sends a Mini App launcher button
2. Tap to open the voice trivia interface
3. Play trivia with voice interaction via OpenAI Realtime API
4. Score tracking and category/difficulty selection

**Text fallback:**
1. Fetches questions from OpenTDB
2. Multiple choice format (A/B/C/D)
3. Grades answers and gives fun facts

## Setup

The voice mode requires a running Express server:

```bash
cd server && npm install
node index.js
```

### Environment Variables

- `TRIVIA_PORT` — Server port (default: 3456)
- `APP_BASE_URL` — Public URL for the Mini App (e.g., Cloudflare tunnel)
- `TRIVIA_VOICE_BASE_URL` — Legacy alias for `APP_BASE_URL` (supported as fallback)
- `OPENCLAW_TELEGRAM_BOT_TOKEN` — Telegram bot token
- `OPENCLAW_TELEGRAM_CHAT_ID` — Chat ID for startup button (optional)
- `OPENAI_API_KEY` — Required for Realtime API voice sessions

### Systemd Service

Install `trivia-voice.service` to run as a background service.

## Hardening (recommended)

By default, voice trivia uses a quick Cloudflare tunnel (`cloudflared tunnel --url`) which generates a random URL on each restart. This causes `APP_BASE_URL` to go stale, breaking the Telegram Mini App launcher.

**Fix:** Use a named Cloudflare tunnel for a stable URL. See [HARDENING.md](HARDENING.md) for setup steps.

Quick version:
```bash
cloudflared tunnel create trivia-voice
cloudflared tunnel route dns trivia-voice trivia.yourdomain.com
# Set APP_BASE_URL=https://trivia.yourdomain.com in ~/.openclaw/.env
systemctl --user enable --now trivia-voice-tunnel
```

## Dependencies

- Node.js >= 20
- OpenAI API key (for Realtime API)
- Telegram bot token

## License

MIT

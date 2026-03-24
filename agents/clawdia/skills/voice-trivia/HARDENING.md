# Voice Trivia Hardening

## Root Cause: Quick Tunnel URL Drift

The default setup uses `cloudflared tunnel --url http://localhost:3456` which creates a **quick tunnel** with a random hostname like `https://random-words.trycloudflare.com`. Every time cloudflared restarts (crash, reboot, network blip), you get a new URL.

This means `APP_BASE_URL` in `~/.openclaw/.env` goes stale, the Telegram Mini App button points to a dead URL, and the game stops working until someone manually updates the env and restarts.

## Fix: Named Cloudflare Tunnel

A named tunnel gets a stable hostname that survives restarts.

### Prerequisites

- `cloudflared` installed (`sudo apt install cloudflared` or [docs](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/))
- A Cloudflare account with a domain (free tier works)
- Logged in: `cloudflared tunnel login`

### Setup Steps

1. **Create the tunnel:**
   ```bash
   cloudflared tunnel create trivia-voice
   ```
   This creates `~/.cloudflared/<tunnel-id>.json` with credentials.

2. **Route DNS:**
   ```bash
   cloudflared tunnel route dns trivia-voice trivia.yourdomain.com
   ```
   This creates a CNAME record pointing to the tunnel.

3. **Create tunnel config** (`~/.cloudflared/config.yml`):
   ```yaml
   tunnel: trivia-voice
   credentials-file: /home/openclaw/.cloudflared/<tunnel-id>.json

   ingress:
     - hostname: trivia.yourdomain.com
       service: http://localhost:3456
     - service: http_status:404
   ```

4. **Set env values** in `~/.openclaw/.env`:
   ```
   APP_BASE_URL=https://trivia.yourdomain.com
   TRIVIA_TUNNEL_NAME=trivia-voice
   ```

5. **Enable the tunnel service:**
   ```bash
   systemctl --user enable --now trivia-voice-tunnel
   ```

6. **Restart trivia voice:**
   ```bash
   systemctl --user restart trivia-voice
   ```

## Service Files

| Service | Purpose |
|---------|---------|
| `trivia-voice.service` | Express server on localhost:3456 |
| `trivia-voice-tunnel.service` | Cloudflare named tunnel → localhost:3456 |

The tunnel service starts before the voice server (`Before=trivia-voice.service`) and has its own preflight checks for `TRIVIA_TUNNEL_NAME` and `cloudflared`.

## Health Checks

```bash
# Tunnel running?
systemctl --user status trivia-voice-tunnel

# Server running?
systemctl --user status trivia-voice

# Server responding?
curl -s http://localhost:3456/api/health

# Tunnel reachable?
curl -s https://trivia.yourdomain.com/api/health
```

## Preflight Checks

The `trivia-voice.service` validates at startup:
- `~/.openclaw/.env` is readable (warns if permissions aren't 600)
- `OPENCLAW_GATEWAY_TOKEN` is set
- `OPENCLAW_TELEGRAM_BOT_TOKEN` is set
- `OPENCLAW_TELEGRAM_CHAT_ID` is set and numeric
- `APP_BASE_URL` starts with `https://`
- `node_modules/` exists in the server directory

The `trivia-voice-tunnel.service` validates:
- `~/.openclaw/.env` is readable
- `TRIVIA_TUNNEL_NAME` is set
- `cloudflared` is in PATH

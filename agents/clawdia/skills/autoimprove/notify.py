"""
AutoImprove Telegram notification and approval.
Sends diffs to the user via Telegram and waits for accept/reject.
"""

import asyncio
import difflib
import json
import os
import subprocess
import sys
from pathlib import Path

import httpx

# Load config
_OC_CONFIG = Path.home() / ".openclaw" / "openclaw.json"
_ENV_FILE = Path.home() / ".openclaw" / ".env"


def _load_telegram_config() -> dict:
    """Load bot token and owner chat ID from OpenClaw config.

    Env vars (highest priority):
        OPENCLAW_TELEGRAM_BOT_TOKEN — the bot token
        OPENCLAW_TELEGRAM_OWNER_CHAT_ID — the owner's chat ID (preferred)
        OPENCLAW_TELEGRAM_CHAT_ID — fallback chat ID
    """
    bot_token = os.environ.get("OPENCLAW_TELEGRAM_BOT_TOKEN", "")

    # Try openclaw.json
    if not bot_token and _OC_CONFIG.exists():
        try:
            cfg = json.loads(_OC_CONFIG.read_text())
            tg = cfg.get("channels", {}).get("telegram", {})
            bot_token = bot_token or tg.get("botToken", "")
            # Check accounts.default too
            if not bot_token:
                bot_token = tg.get("accounts", {}).get("default", {}).get("botToken", "")
        except (json.JSONDecodeError, KeyError):
            pass

    # Validate bot token — real tokens are ~46 chars (e.g. "123456789:AABBccdd...")
    if bot_token and len(bot_token) < 30:
        print(f"WARNING: TELEGRAM_BOT_TOKEN looks invalid ({len(bot_token)} chars, "
              f"expected ~46). Telegram notifications disabled.", file=sys.stderr)
        bot_token = ""

    # Find the owner's chat ID — prefer explicit env var over session auto-detect
    chat_id = (
        os.environ.get("OPENCLAW_TELEGRAM_OWNER_CHAT_ID", "")
        or os.environ.get("OPENCLAW_TELEGRAM_CHAT_ID", "")
    )
    if not chat_id:
        # Fallback: try openclaw.json for owner chat ID
        if _OC_CONFIG.exists():
            try:
                cfg = json.loads(_OC_CONFIG.read_text())
                tg = cfg.get("channels", {}).get("telegram", {})
                chat_id = str(tg.get("ownerChatId", ""))
            except (json.JSONDecodeError, KeyError):
                pass

    if not chat_id:
        # Last resort: session auto-detect (may pick wrong user)
        sessions_file = Path.home() / ".openclaw" / "agents" / "main" / "sessions" / "sessions.json"
        if sessions_file.exists():
            try:
                sessions = json.loads(sessions_file.read_text())
                for key in sessions:
                    if "telegram:direct:" in key:
                        chat_id = key.split("telegram:direct:")[-1]
                        print(f"WARNING: Using auto-detected Telegram chat_id={chat_id}. "
                              f"Set OPENCLAW_TELEGRAM_OWNER_CHAT_ID to override.",
                              file=sys.stderr)
                        break
            except (json.JSONDecodeError, KeyError):
                pass

    return {"bot_token": bot_token, "chat_id": chat_id}


def make_diff_summary(original: str, modified: str, skill_name: str) -> str:
    """Create a readable diff summary for Telegram."""
    orig_lines = original.splitlines(keepends=True)
    mod_lines = modified.splitlines(keepends=True)

    diff = list(difflib.unified_diff(orig_lines, mod_lines,
                                      fromfile=f"{skill_name} (current)",
                                      tofile=f"{skill_name} (proposed)"))

    if not diff:
        return "No changes."

    # Count additions/removals
    added = sum(1 for l in diff if l.startswith("+") and not l.startswith("+++"))
    removed = sum(1 for l in diff if l.startswith("-") and not l.startswith("---"))

    # Build summary — Telegram has 4096 char limit per message
    header = (
        f"<b>AutoImprove: {skill_name}</b>\n\n"
        f"Lines: {len(orig_lines)} → {len(mod_lines)} "
        f"(+{added}, -{removed})\n\n"
    )

    # Show only the added content (most useful for review)
    new_sections = []
    current_section = []
    for line in diff:
        if line.startswith("+") and not line.startswith("+++"):
            current_section.append(line[1:].rstrip())
        elif current_section:
            new_sections.append("\n".join(current_section))
            current_section = []
    if current_section:
        new_sections.append("\n".join(current_section))

    additions = "\n---\n".join(new_sections)

    # Truncate if too long for Telegram
    body = f"<b>New content:</b>\n<pre>{_escape_html(additions[:2500])}</pre>"

    return header + body


def _escape_html(text: str) -> str:
    """Escape HTML special chars for Telegram."""
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


class TelegramApproval:
    """Sends skill diffs to Telegram and waits for user approval."""

    def __init__(self):
        cfg = _load_telegram_config()
        self.bot_token = cfg["bot_token"]
        self.chat_id = cfg["chat_id"]
        self.base_url = f"https://api.telegram.org/bot{self.bot_token}"
        self.enabled = bool(self.bot_token and self.chat_id)

    async def request_approval(self, skill_name: str, original: str,
                                modified: str, score_before: float,
                                score_after: float) -> bool:
        """
        Send diff to Telegram with Accept/Reject buttons.
        Returns True if accepted, False if rejected or timeout.
        """
        if not self.enabled:
            print("Telegram not configured — auto-accepting", file=sys.stderr)
            return True

        summary = make_diff_summary(original, modified, skill_name)
        score_line = f"\n\nScore: {score_before:.3f} → {score_after:.3f}"

        # Send message with inline keyboard
        callback_id = f"autoimprove_{skill_name}_{int(asyncio.get_event_loop().time())}"

        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"{self.base_url}/sendMessage",
                json={
                    "chat_id": self.chat_id,
                    "text": summary + score_line,
                    "parse_mode": "HTML",
                    "reply_markup": {
                        "inline_keyboard": [[
                            {"text": "Accept", "callback_data": f"{callback_id}:accept"},
                            {"text": "Reject", "callback_data": f"{callback_id}:reject"},
                        ]]
                    },
                },
                timeout=30.0,
            )
            if resp.status_code != 200:
                print(f"Telegram send failed: {resp.text}", file=sys.stderr)
                return False

            msg_data = resp.json()
            message_id = msg_data.get("result", {}).get("message_id")

        # Poll for callback response (timeout after 10 minutes)
        decision = await self._poll_for_callback(callback_id, timeout=600)

        # Update the message to show the decision
        async with httpx.AsyncClient() as client:
            status = "ACCEPTED" if decision else "REJECTED"
            await client.post(
                f"{self.base_url}/editMessageReplyMarkup",
                json={
                    "chat_id": self.chat_id,
                    "message_id": message_id,
                    "reply_markup": {"inline_keyboard": []},
                },
                timeout=10.0,
            )
            await client.post(
                f"{self.base_url}/sendMessage",
                json={
                    "chat_id": self.chat_id,
                    "text": f"AutoImprove: {skill_name} — <b>{status}</b>",
                    "parse_mode": "HTML",
                },
                timeout=10.0,
            )

        return decision

    async def _poll_for_callback(self, callback_id: str,
                                  timeout: int = 600) -> bool:
        """Poll getUpdates for the callback button press."""
        deadline = asyncio.get_event_loop().time() + timeout
        offset = 0

        # Read current offset so we only get new updates
        offset_file = Path.home() / ".openclaw" / "skills" / "autoimprove" / "_tg_offset"
        if offset_file.exists():
            try:
                offset = int(offset_file.read_text().strip())
            except ValueError:
                pass

        async with httpx.AsyncClient() as client:
            while asyncio.get_event_loop().time() < deadline:
                try:
                    resp = await client.post(
                        f"{self.base_url}/getUpdates",
                        json={
                            "offset": offset,
                            "timeout": 30,
                            "allowed_updates": ["callback_query"],
                        },
                        timeout=40.0,
                    )
                    if resp.status_code != 200:
                        await asyncio.sleep(5)
                        continue

                    updates = resp.json().get("result", [])
                    for update in updates:
                        offset = update["update_id"] + 1
                        offset_file.write_text(str(offset))

                        cb = update.get("callback_query", {})
                        data = cb.get("data", "")

                        if data.startswith(callback_id):
                            # Acknowledge the callback
                            await client.post(
                                f"{self.base_url}/answerCallbackQuery",
                                json={"callback_query_id": cb["id"]},
                                timeout=10.0,
                            )
                            return data.endswith(":accept")

                except Exception as e:
                    print(f"Polling error: {e}", file=sys.stderr)
                    await asyncio.sleep(5)

        # Timeout — treat as rejection
        return False

    async def notify(self, message: str):
        """Send a simple notification message."""
        if not self.enabled:
            return
        async with httpx.AsyncClient() as client:
            await client.post(
                f"{self.base_url}/sendMessage",
                json={
                    "chat_id": self.chat_id,
                    "text": message,
                    "parse_mode": "HTML",
                },
                timeout=30.0,
            )


def apply_approved_skill(original_path: str, improved_path: str,
                          skill_name: str) -> bool:
    """
    Copy improved skill over original, delete temp, git commit + push.
    Returns True if successful.
    """
    original = Path(original_path)
    improved = Path(improved_path)

    if not improved.exists():
        return False

    # Copy improved over original
    original.write_text(improved.read_text())

    # Delete temp
    improved.unlink()

    # Git commit + push from the repo containing the original
    repo_path = original.parent
    for _ in range(10):
        if (repo_path / ".git").exists():
            break
        if repo_path == repo_path.parent:
            return True  # No git repo, just file copy is fine
        repo_path = repo_path.parent
    else:
        return True

    repo = str(repo_path)
    rel_path = str(original.relative_to(repo_path))

    try:
        subprocess.run(["git", "add", rel_path],
                       cwd=repo, capture_output=True, text=True, check=True)
        subprocess.run(
            ["git", "commit", "-m", f"autoimprove: update {skill_name} skill"],
            cwd=repo, capture_output=True, text=True, check=True,
        )
        subprocess.run(["git", "push", "origin", "HEAD"],
                       cwd=repo, capture_output=True, text=True, check=True)
        return True
    except subprocess.CalledProcessError as e:
        print(f"Git error: {e.stderr}", file=sys.stderr)
        return False


def discard_proposed_skill(improved_path: str):
    """Delete the proposed skill temp file."""
    p = Path(improved_path)
    if p.exists():
        p.unlink()

---
name: voice-trivia
description: Voice-first trivia game via Telegram Mini App.
user-invocable: true
---

# Trivia Voice

## When the user asks for trivia or voice trivia (Telegram)

Use bash to POST to the Trivia Voice server's `/api/launch` endpoint:

```bash
curl -s -X POST "http://127.0.0.1:3456/api/launch" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${OPENCLAW_GATEWAY_TOKEN}" \
  -d '{}'
```

This sends a "Start Voice Trivia" button to the user's Telegram chat. The server knows which chat to send to.

After calling, reply:
"I just sent you a trivia button — tap 'Start Voice Trivia' to launch the voice game!"

If the curl call fails (non-zero exit or error response), fall back to text trivia below.

## Text-only fallback (non-Telegram or if voice is unavailable)

1. Fetch one multiple-choice question from:
   https://opentdb.com/api.php?amount=1&type=multiple&encode=url3986
   (use web_fetch)
2. Decode URL encoding.
3. Shuffle answers.
4. Label A/B/C/D.
5. Ask the question.

### Grading (text mode)

- Accept A/B/C/D (case-insensitive) or full answer text
- If correct: "Correct!" + one short fun fact
- If incorrect: "Not quite" + reveal correct answer + short explanation
- Then: "Say next for another."

## Tone

- Playful, warm, supportive
- Light meme seasoning
- Voice-first: keep it short and punchy

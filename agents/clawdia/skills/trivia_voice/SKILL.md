---
name: trivia_voice
description: Voice-first trivia game. Asks one multiple-choice question, waits for the answer, grades it, keeps score.
user-invocable: true
---

# Trivia Voice

## Rules

- Always include [[tts]] in both question and grading replies.
- If Telegram supports it, include [[audio_as_voice]].
- Ask one question at a time.
- Wait for next user message as the answer.
- Keep a running streak counter in-session.

## Question Flow

1. Fetch one multiple-choice question from:  
    https://opentdb.com/api.php?amount=1&type=multiple&encode=url3986  
    (use web_fetch if available)
2. Decode URL encoding.
3. Shuffle answers.
4. Label A/B/C/D.
5. Ask the question using [[tts]].

## Grading

- Accept A/B/C/D (case-insensitive)
- Accept full answer text if unambiguous
- If correct:
  - Say "Correct" with [[tts]]
  - Add one short fun fact
- If incorrect:
  - Say "Not quite"
  - Reveal correct answer
  - Add one short explanation

Then ask:  
"Say next for another."

## Tone

- Playful
- Supportive
- Light meme seasoning

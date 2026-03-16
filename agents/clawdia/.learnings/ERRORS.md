## [ERR-20260316-001] nano-banana-pro

**Logged**: 2026-03-16T11:25:00Z
**Priority**: high
**Status**: pending
**Area**: infra

### Summary
Nano Banana / Gemini 3 Pro Image generation for a logo request failed because the upstream model returned 503 UNAVAILABLE under high demand.

### Error
```
google.genai.errors.ServerError: 503 UNAVAILABLE. {'error': {'code': 503, 'message': 'This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.', 'status': 'UNAVAILABLE'}}
```

### Context
- Operation attempted: generate a simple fun logo for "CopyLobsta" using gemini-3-pro-image-preview
- Wrapper script appeared to hang because the SDK retried internally before surfacing the 503
- Direct one-off test reproduced the issue with the same model
- Environment details: GEMINI_API_KEY present; uv and dependency resolution working normally

### Suggested Fix
Surface upstream 503/high-demand failures faster in the Nano Banana wrapper, with explicit timeout and retry/backoff messaging so users get a quick fallback instead of a long apparent hang.

### Metadata
- Reproducible: unknown
- Related Files: skills/nano-banana-pro/scripts/generate_image.py

---

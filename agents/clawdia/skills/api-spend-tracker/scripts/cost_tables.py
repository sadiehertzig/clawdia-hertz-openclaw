"""
Per-model pricing in USD per 1M tokens.
Update this file when providers change pricing.
Last updated: 2026-03-22
"""

ANTHROPIC_PRICING = {
    "claude-haiku-4-5": {"cache_read": 0.0, "cache_write": 0.0, "input": 1.0, "output": 5.0},
    "claude-haiku-4-5-20251001": {"cache_read": 0.08, "cache_write": 1.0, "input": 1.0, "output": 5.0},
    "claude-opus-4": {"cache_read": 0.0, "cache_write": 0.0, "input": 5.0, "output": 25.0},
    "claude-opus-4-20250514": {"input": 15.0, "output": 75.0, "cache_read": 1.5, "cache_write": 18.75},
    "claude-opus-4-6": {"cache_read": 1.5, "cache_write": 18.75, "input": 5.0, "output": 25.0},
    "claude-sonnet-4": {"cache_read": 0.0, "cache_write": 0.0, "input": 3.0, "output": 15.0},
    "claude-sonnet-4-20250514": {"input": 3.0, "output": 15.0, "cache_read": 0.3, "cache_write": 3.75},
    "claude-sonnet-4-6": {"cache_read": 0.3, "cache_write": 3.75, "input": 3.0, "output": 15.0},
}

OPENAI_PRICING = {
    "gpt-4.1": {"input": 2.0, "output": 8.0, "cache_read": 0.5, "cache_write": 0.0},
    "gpt-4.1-mini": {"input": 0.4, "output": 1.6, "cache_read": 0.1, "cache_write": 0.0},
    "gpt-4.1-nano": {"input": 0.1, "output": 0.4, "cache_read": 0.025, "cache_write": 0.0},
    "gpt-4o": {"input": 2.5, "output": 10.0, "cache_read": 1.25, "cache_write": 0.0},
    "gpt-4o-mini": {"input": 0.15, "output": 0.6, "cache_read": 0.075, "cache_write": 0.0},
    "gpt-4o-mini-realtime-preview": {"input": 0.6, "output": 2.4, "cache_read": 0.3, "cache_write": 0.0},
    "gpt-4o-mini-transcribe": {"input": 0.6, "output": 2.4, "cache_read": 0.0, "cache_write": 0.0},
    "gpt-4o-realtime-preview": {"input": 5.0, "output": 20.0, "cache_read": 2.5, "cache_write": 0.0},
    "o3": {"input": 10.0, "output": 40.0, "cache_read": 2.5, "cache_write": 0.0},
    "o3-mini": {"input": 1.1, "output": 4.4, "cache_read": 0.275, "cache_write": 0.0},
    "o4-mini": {"input": 1.1, "output": 4.4, "cache_read": 0.275, "cache_write": 0.0},
}

GOOGLE_PRICING = {
    "gemini-2.0-flash": {"input": 0.1, "output": 0.4, "cache_read": 0.025, "cache_write": 0.0},
    "gemini-2.5-flash": {"cache_read": 0.03, "cache_write": 0.03, "input": 0.3, "output": 2.5},
    "gemini-2.5-flash-lite": {"cache_read": 0.01, "cache_write": 0.01, "input": 0.1, "output": 0.4},
    "gemini-2.5-pro": {"cache_read": 0.125, "cache_write": 0.125, "input": 1.25, "output": 10.0},
}

ALL_PRICING = {
    "anthropic": ANTHROPIC_PRICING,
    "openai": OPENAI_PRICING,
    "google": GOOGLE_PRICING,
}


def calculate_cost(
    provider: str,
    model: str,
    input_tokens: int = 0,
    output_tokens: int = 0,
    cache_read_tokens: int = 0,
    cache_write_tokens: int = 0,
) -> float:
    """Calculate cost in USD for a single API call."""
    input_tokens = max(0, input_tokens)
    output_tokens = max(0, output_tokens)
    cache_read_tokens = max(0, cache_read_tokens)
    cache_write_tokens = max(0, cache_write_tokens)
    pricing = ALL_PRICING.get(provider, {})
    rates = pricing.get(model)
    if not rates:
        for key in pricing:
            if model.startswith(key):
                rates = pricing[key]
                break
    if not rates:
        return 0.0
    cost = (
        (input_tokens * rates["input"] / 1_000_000)
        + (output_tokens * rates["output"] / 1_000_000)
        + (cache_read_tokens * rates.get("cache_read", 0) / 1_000_000)
        + (cache_write_tokens * rates.get("cache_write", 0) / 1_000_000)
    )
    return round(cost, 6)

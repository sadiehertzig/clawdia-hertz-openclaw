"""
Path resolution helpers for AutoImprove runtime.
Prefer Clawdia workspace skills over installed skill copies.
"""

import os
from pathlib import Path


def resolve_skills_dir(self_dir: Path) -> Path:
    """Resolve the canonical skills directory for Clawdia."""
    override = os.environ.get("OPENCLAW_CLAWDIA_SKILLS_DIR", "").strip()
    if override:
        candidate = Path(override).expanduser()
        if candidate.exists():
            return candidate

    # Preferred workspace location for this repository.
    workspace_candidate = Path.home() / "clawdia-hertz-openclaw" / "agents" / "clawdia" / "skills"
    if workspace_candidate.exists():
        return workspace_candidate

    # Fallback to sibling skills directory for portable/manual runs.
    return self_dir.parent


def resolve_autoimprove_dir(self_dir: Path) -> Path:
    """Resolve the autoimprove directory under the canonical skills root."""
    skills_dir = resolve_skills_dir(self_dir)
    candidate = skills_dir / "autoimprove"
    if candidate.exists():
        return candidate
    return self_dir


def resolve_three_body_dir(self_dir: Path) -> Path:
    """Resolve three-body-council directory under the canonical skills root."""
    skills_dir = resolve_skills_dir(self_dir)
    candidate = skills_dir / "three-body-council"
    if candidate.exists():
        return candidate
    raise FileNotFoundError(f"three-body-council skill not found at {candidate}")

Clawdia Repository Doctor

Audit the entire repository.

Focus on these systems:

1. Memory system
Check how memory files in /memory are used.
Verify agents can retrieve and use them.

2. Agent architecture
Inspect folders in /agents.
Confirm configuration files exist and are consistent.

3. Tool definitions
Check TOOLS.md and agent tool configuration.

4. Identity system
Review:
SOUL.md
IDENTITY.md
USER.md

Confirm they are referenced correctly.

5. Scripts
Review scripts in /scripts.
Confirm codex-plan.sh and codex-implement.sh work safely.

6. Repository structure
Look for:
missing documentation
duplicate files
misplaced configuration

Return:

Findings  
Problems discovered  
Suggested fixes  
Implementation plan

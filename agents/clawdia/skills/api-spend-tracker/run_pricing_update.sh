#!/bin/bash
set -a
source /home/openclaw/.openclaw/.env
set +a
cd /home/openclaw/clawdia-hertz-openclaw/agents/clawdia/skills/api-spend-tracker
/usr/bin/python3 scripts/update_pricing.py >> /home/openclaw/clawdia-hertz-openclaw/logs/pricing_update.log 2>&1

#!/bin/bash
set -a
source /home/openclaw/.openclaw/.env
set +a
cd /home/openclaw/clawdia-hertz-openclaw/agents/clawdia/skills/api-spend-tracker
/usr/bin/python3 scripts/reporter.py >> /home/openclaw/clawdia-hertz-openclaw/logs/spend_cron.log 2>&1

#!/bin/bash
set -a
source /home/openclaw/.openclaw/.env
set +a
cd /home/openclaw/clawdia-hertz-openclaw/agents/clawdia/skills/copylobsta/server
/usr/bin/node dist/spotlight.js >> /home/openclaw/clawdia-hertz-openclaw/logs/spotlight_cron.log 2>&1

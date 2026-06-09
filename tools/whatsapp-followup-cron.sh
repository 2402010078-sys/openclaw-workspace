#!/bin/bash
# WhatsApp follow-up cron runner for multiple numbers
# Called by crontab every hour.
# +60105196512 sends at :00, +601153968752 sends at :10

set -euo pipefail

export PATH="/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CHECK_SCRIPT="$SCRIPT_DIR/whatsapp-followup-multi.sh"
STATE_DIR="/Users/macmini/.openclaw/workspace/state/followup"
LOG_FILE="$STATE_DIR/cron-runner.log"
mkdir -p "$STATE_DIR"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG_FILE"
}

send_followup() {
  local CUSTOMER="$1"
  local DELAY="$2"
  
  if [ "$DELAY" -gt 0 ]; then
    log "Waiting ${DELAY}s before checking $CUSTOMER..."
    sleep "$DELAY"
  fi
  
  local RAW RESULT
  RAW=$(bash "$CHECK_SCRIPT" "$CUSTOMER" 2>/dev/null)
  RESULT=$(echo "$RAW" | grep '^{' | tail -1)
  
  eval "$(echo "$RESULT" | python3 -c "
import json,sys
d = json.load(sys.stdin)
sf = str(d.get('shouldFollowUp', False))
rr = str(d.get('reason', 'unknown'))
msg = d.get('followupMessage', '')
lang = str(d.get('language', 'en'))
print(f'SHOULD={sf}')
print(f'REASON={rr}')
print(f'MSG_B64=' + __import__('base64').b64encode(msg.encode()).decode())
print(f'LANG={lang}')
" 2>/dev/null || echo "SHOULD=False REASON=parse_error LANG=en MSG_B64=")"
  
  if [ "$SHOULD" = "True" ]; then
    MSG=$(echo "$MSG_B64" | python3 -c "import sys,base64; print(base64.b64decode(sys.stdin.read()).decode())" 2>/dev/null || echo "")
    
    if [ -n "$MSG" ]; then
      log "Sending follow-up to $CUSTOMER (lang: $LANG)..."
      
      local SEND_RESULT=""
      for TRY in 1 2; do
        SEND_RESULT=$(openclaw message send \
          --channel whatsapp \
          --account codligence \
          --target "$CUSTOMER" \
          --message "$MSG" \
          --json 2>&1) || true
        
        if echo "$SEND_RESULT" | grep -q '"messageId"'; then
          break
        fi
        
        log "Retry $TRY failed for $CUSTOMER, retrying..."
        sleep 5
      done
      
      log "Send result: $SEND_RESULT"
      
      local STATE_FILE="$STATE_DIR/$(echo "$CUSTOMER" | sed 's/+//').json"
      python3 -c "
import json, time
try:
    with open('$STATE_FILE') as f:
        state = json.load(f)
    state['lastActualSentAt'] = int(time.time() * 1000)
    with open('$STATE_FILE', 'w') as f:
        json.dump(state, f, indent=2)
except:
    pass
" 2>/dev/null || true
    fi
  else
    if [ "$REASON" != "too_soon" ]; then
      log "$CUSTOMER: skip ($REASON)"
    fi
  fi
}

log "Starting follow-up check..."

# +60105196512 at :00
# +60105196512 (Peter) — still considering, booking-themed messages
send_followup "+60105196512" 0

# +601153968752 at :10 (10 second delay from cron start)
send_followup "+601153968752" 10

log "Follow-up check complete."

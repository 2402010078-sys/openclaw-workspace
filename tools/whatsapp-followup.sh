#!/bin/bash
# WhatsApp follow-up check script for +60105196512
# Determines whether a follow-up message should be sent, and in what language.
# Called by the cron job. Outputs JSON with the decision and follow-up details.
#
# Output: JSON to stdout with keys:
#   shouldFollowUp: boolean
#   language: "zh" | "ms" | "en"
#   lastUserMessage: string
#   elapsedMinutes: number

set -euo pipefail

CUSTOMER_NUMBER="+60105196512"
SESSION_FILE="/Users/macmini/.openclaw/agents/main/sessions/4df18ad0-c3dc-43fc-9081-56232dd6bb49.jsonl"
SESSIONS_META="/Users/macmini/.openclaw/agents/main/sessions/sessions.json"
STATE_DIR="/Users/macmini/.openclaw/workspace/state"
STATE_FILE="$STATE_DIR/whatsapp-followup-state.json"
mkdir -p "$STATE_DIR"

NOW_MS=$(date +%s000)

# --- Step 1: Get last interaction timestamp from sessions.json ---
LAST_INTERACTION=$(python3 -c "
import json
with open('$SESSIONS_META') as f:
    meta = json.load(f)
key = 'agent:main:whatsapp:direct:$CUSTOMER_NUMBER'
entry = meta.get(key, {})
print(entry.get('lastInteractionAt', 0))
" 2>/dev/null || echo "0")

if [ "$LAST_INTERACTION" = "0" ] || [ "$LAST_INTERACTION" = "None" ]; then
  echo '{"shouldFollowUp":false,"reason":"no_last_interaction"}'
  exit 0
fi

# --- Step 2: Check if 1 hour has passed since last interaction ---
ONE_HOUR_MS=3600000
ELAPSED_MS=$((NOW_MS - LAST_INTERACTION))

if [ "$ELAPSED_MS" -lt "$ONE_HOUR_MS" ]; then
  # Hasn't been 1 hour yet
  ELAPSED_MIN=$((ELAPSED_MS / 60000))
  echo "{\"shouldFollowUp\":false,\"reason\":\"too_soon\",\"elapsedMinutes\":$ELAPSED_MIN}"
  exit 0
fi

# --- Step 3: Check state file — no more than 1 follow-up per 4 hours ---
LAST_FOLLOWUP=$(python3 -c "
import json
try:
    with open('$STATE_FILE') as f:
        state = json.load(f)
    print(state.get('lastFollowupAt', 0))
except:
    print(0)
" 2>/dev/null || echo "0")

FOUR_HOURS_MS=14400000
SINCE_LAST_FOLLOWUP=$((NOW_MS - LAST_FOLLOWUP))

CHECK_SESSION=$(python3 -c "
import json
try:
    with open('$STATE_FILE') as f:
        state = json.load(f)
    print(state.get('lastCheckedSessionAt', 0))
except:
    print(0)
" 2>/dev/null || echo "0")

# If followed up recently AND the session hasn't changed since then (no new customer reply), skip
if [ "$LAST_FOLLOWUP" != "0" ] && [ "$SINCE_LAST_FOLLOWUP" -lt "$FOUR_HOURS_MS" ]; then
  # Only skip if current interaction is same as when we last checked
  if [ "$LAST_INTERACTION" -le "$CHECK_SESSION" ] || [ "$CHECK_SESSION" = "0" ]; then
    echo "{\"shouldFollowUp\":false,\"reason\":\"recent_followup_no_reply\",\"minSinceFollowup\":$((SINCE_LAST_FOLLOWUP / 60000))}"
    exit 0
  fi
fi

# --- Step 4: Get last user message for language detection ---
LAST_USER_TEXT=$(python3 -c "
import json
with open('$SESSION_FILE') as f:
    lines = f.readlines()
for line in reversed(lines):
    try:
        msg = json.loads(line)
        if msg.get('type') == 'message' and msg.get('message', {}).get('role') == 'user':
            content = msg['message']['content']
            if isinstance(content, list):
                for part in content:
                    if part.get('type') == 'text':
                        print(part['text'][:200])
                        exit(0)
            elif isinstance(content, str):
                print(content[:200])
                exit(0)
    except:
        pass
print('')
" 2>/dev/null || echo "")

# --- Step 5: Detect language ---
DETECT_LANG="en"
# Chinese character detection (CJK Unified Ideographs)
python3 -c "
import sys
text = '''$LAST_USER_TEXT'''
if any('\u4e00' <= c <= '\u9fff' for c in text):
    sys.exit(0)  # Chinese
elif any(c in text.lower() for c in ['nak','kau','saya','anda','tolong','terima','takpe','boleh','ya','tidak','saja','je']):
    sys.exit(1)  # Malay
else:
    sys.exit(2)  # English
" 2>/dev/null
DETECT_EXIT=$?

if [ "$DETECT_EXIT" = "0" ]; then
  DETECT_LANG="zh"
elif [ "$DETECT_EXIT" = "1" ]; then
  DETECT_LANG="ms"
else
  DETECT_LANG="en"
fi

# --- Step 6: Build follow-up messages ---
if [ "$DETECT_LANG" = "zh" ]; then
  FOLLOWUP_TEXT="没关系～ 你慢慢想就好 😊 我这边一直都在的，如果你突然想到什么想问的，随时跟我说～ 🤗"
elif [ "$DETECT_LANG" = "ms" ]; then
  FOLLOWUP_TEXT="Takpe, ambil masa awak ya 😊 Saya ada sini je. Kalau tiba-tiba ada apa-apa nak tanya, PM je ya~ 🤗"
else
  FOLLOWUP_TEXT="No worries, take your time! 😊 I'm still right here whenever you think of something. Just drop me a message anytime~ 🤗"
fi

# --- Step 7: Update state file ---
python3 -c "
import json, os
state_file = '$STATE_FILE'
state = {}
try:
    with open(state_file) as f:
        state = json.load(f)
except:
    pass
state['lastFollowupAt'] = $NOW_MS
state['lastCheckedSessionAt'] = $LAST_INTERACTION
state['customerNumber'] = '$CUSTOMER_NUMBER'
state['lastFollowupLanguage'] = '$DETECT_LANG'
state['lastFollowupMessage'] = '''$(echo "$FOLLOWUP_TEXT" | head -c 100)'''
os.makedirs(os.path.dirname(state_file), exist_ok=True)
with open(state_file, 'w') as f:
    json.dump(state, f, indent=2)
print('State updated.')
"

# Output the JSON decision
ESCAPED_TEXT=$(echo "$FOLLOWUP_TEXT" | python3 -c "import json,sys; print(json.dumps(sys.stdin.read().strip()))")
ESCAPED_USER_MSG=$(echo "$LAST_USER_TEXT" | python3 -c "import json,sys; print(json.dumps(sys.stdin.read().strip()[:200]))")
ELAPSED_MIN=$((ELAPSED_MS / 60000))
cat <<JSONEOF
{
  "shouldFollowUp": true,
  "language": "$DETECT_LANG",
  "elapsedMinutes": $ELAPSED_MIN,
  "followupMessage": $ESCAPED_TEXT,
  "lastUserMessage": $ESCAPED_USER_MSG,
  "stateFile": "$STATE_FILE"
}
JSONEOF

#!/bin/bash
# WhatsApp follow-up check script for multiple customers
# Strategy: send follow-up every hour if customer hasn't replied.
# Messages rotate through a list each time. Customer reply resets the counter.
#
# Usage: bash whatsapp-followup-multi.sh <customer_number>
# Example: bash whatsapp-followup-multi.sh +60105196512

set -uo pipefail

CUSTOMER_NUMBER="$1"
if [ -z "$CUSTOMER_NUMBER" ]; then
  echo '{"error":"missing_customer_number","shouldFollowUp":false}'
  exit 1
fi

NORMALIZED=$(echo "$CUSTOMER_NUMBER" | sed 's/+//')
SESSION_KEY="agent:main:whatsapp:direct:${CUSTOMER_NUMBER}"
SESSIONS_META="/Users/macmini/.openclaw/agents/main/sessions/sessions.json"
STATE_DIR="/Users/macmini/.openclaw/workspace/state/followup"
STATE_FILE="$STATE_DIR/${NORMALIZED}.json"
mkdir -p "$STATE_DIR"

NOW_MS=$(date +%s000)

# --- Step 1: Get session info from sessions.json ---
SESSION_INFO=$(python3 -c "
import json
with open('$SESSIONS_META') as f:
    meta = json.load(f)
key = '$SESSION_KEY'
entry = meta.get(key, {})
session_id = entry.get('sessionId', '')
session_file = entry.get('sessionFile', '/Users/macmini/.openclaw/agents/main/sessions/' + session_id + '.jsonl')
print('LAST_INT=' + str(entry.get('lastInteractionAt', '0')))
print('SESS_FILE=' + session_file)
" 2>/dev/null || echo -e 'LAST_INT=0\nSESS_FILE=')

LAST_INTERACTION=$(echo "$SESSION_INFO" | grep '^LAST_INT=' | cut -d= -f2)
SESSION_FILE=$(echo "$SESSION_INFO" | grep '^SESS_FILE=' | cut -d= -f2)

if [ "$LAST_INTERACTION" = "0" ] || [ "$LAST_INTERACTION" = "None" ] || [ -z "$SESSION_FILE" ]; then
  echo '{"shouldFollowUp":false,"reason":"no_last_interaction"}'
  exit 0
fi

# --- Step 2: Check if 1 hour has passed since last interaction ---
ONE_HOUR_MS=3600000
ELAPSED_MS=$(( NOW_MS - LAST_INTERACTION ))

if [ "$ELAPSED_MS" -lt "$ONE_HOUR_MS" ]; then
  ELAPSED_MIN=$(( ELAPSED_MS / 60000 ))
  echo "{\"shouldFollowUp\":false,\"reason\":\"too_soon\",\"elapsedMinutes\":$ELAPSED_MIN}"
  exit 0
fi

# --- Step 3: Read state & check if customer replied since last follow-up ---
FOLLOWUP_COUNT=0
LAST_FOLLOWUP=0
LAST_CHECKED_SESSION=0

if [ -f "$STATE_FILE" ]; then
  STATE_JSON=$(cat "$STATE_FILE")
  LAST_FOLLOWUP=$(echo "$STATE_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin).get('lastFollowupAt',0))")
  FOLLOWUP_COUNT=$(echo "$STATE_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin).get('followupCount',0))")
  LAST_CHECKED_SESSION=$(echo "$STATE_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin).get('lastCheckedSessionAt',0))")
fi

# If customer has replied since last follow-up → reset counter (start fresh)
if [ "$LAST_FOLLOWUP" != "0" ] && [ "$LAST_INTERACTION" -gt "$LAST_CHECKED_SESSION" ]; then
  FOLLOWUP_COUNT=0
  LAST_FOLLOWUP=0
  # Also clear sentMessages so follow-up cycle restarts from index 0
  python3 -c "
import json
state_file = '$STATE_FILE'
try:
    with open(state_file) as f:
        state = json.load(f)
    state['sentMessages'] = []
    state['followupCount'] = 0
    with open(state_file, 'w') as f:
        json.dump(state, f, indent=2)
except:
    pass
" >/dev/null 2>&1 || true
fi

# If customer hasn't replied yet, check if 1 hour passed since last follow-up
if [ "$FOLLOWUP_COUNT" -ge 1 ]; then
  ONE_HOUR_AGO=$(( NOW_MS - ONE_HOUR_MS ))
  if [ "$LAST_FOLLOWUP" -gt "$ONE_HOUR_AGO" ]; then
    MIN_SINCE=$(( (NOW_MS - LAST_FOLLOWUP) / 60000 ))
    echo "{\"shouldFollowUp\":false,\"reason\":\"wait_one_hour\",\"minutesSinceFollowup\":$MIN_SINCE}"
    exit 0
  fi
fi

# --- Step 4: Get last user message for language detection ---
LAST_USER_TEXT=""
if [ -f "$SESSION_FILE" ]; then
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
fi

# --- Step 5: Detect language ---
DETECT_LANG="en"
LANG_EXIT=2
if [ -n "$LAST_USER_TEXT" ]; then
  LANG_EXIT=$(echo "$LAST_USER_TEXT" | python3 -c "
import sys
text = sys.stdin.read()
if any('\u4e00' <= c <= '\u9fff' for c in text):
    sys.exit(0)
elif any(w in text.lower().split() for w in ['nak','kau','saya','anda','tolong','terima','takpe','boleh','ya','tidak','saja','je','kenapa','macam','ni','itu','dekat','pergi','ada','dah','sudah','tapi','kalau','juga']):
    sys.exit(1)
else:
    sys.exit(2)
" 2>/dev/null; echo $?)
fi

if [ "$LANG_EXIT" = "0" ]; then
  DETECT_LANG="zh"
elif [ "$LANG_EXIT" = "1" ]; then
  DETECT_LANG="ms"
else
  DETECT_LANG="en"
fi

# --- Step 6: Determine message index (skip already-sent messages) ---
# Read sentMessages set from state to avoid duplicates
SENT_INDICES=""
if [ -f "$STATE_FILE" ]; then
  SENT_INDICES=$(echo "$STATE_JSON" | python3 -c "
import json,sys
d = json.load(sys.stdin)
sent = d.get('sentMessages', [])
if sent:
    print(','.join(str(i) for i in sent))
else:
    print('')
" 2>/dev/null || echo "")
fi

# Find the next unsent message index, cycling through 0-7
MSG_INDEX=0
if [ -n "$SENT_INDICES" ]; then
  # Try indices based on current count, but skip already-sent ones
  IFS=',' read -ra SENT_ARRAY <<< "$SENT_INDICES"
  CANDIDATE=$(( FOLLOWUP_COUNT % 8 ))
  # Check if this candidate was already sent; if so, find next unsent
  FOUND=false
  for TRIED in 0 1 2 3 4 5 6 7; do
    CANDIDATE=$(( (FOLLOWUP_COUNT + TRIED) % 8 ))
    ALREADY_SENT=false
    for S in "${SENT_ARRAY[@]}"; do
      if [ "$S" = "$CANDIDATE" ]; then
        ALREADY_SENT=true
        break
      fi
    done
    if [ "$ALREADY_SENT" = false ]; then
      MSG_INDEX=$CANDIDATE
      FOUND=true
      break
    fi
  done
  if [ "$FOUND" = false ]; then
    # All 8 sent; wrap around
    MSG_INDEX=$(( FOLLOWUP_COUNT % 8 ))
  fi
else
  MSG_INDEX=$(( FOLLOWUP_COUNT % 8 ))
fi

# Chinese messages
ZH_MSGS=(
  "打扰一下 😊 之前聊到活动预约的事，不知道您考虑得怎么样了？如果有什么问题或者想法，随时告诉我哦～"
  "嘿嘿又是我～ 怕您忙起来把活动的事忘了，所以来提醒一下 🤭 需要帮忙选活动类型或看日期吗？"
  "跟您打个招呼 😊 不管您是想选活动、问价格，还是想换个日期，直接跟我说就行～"
  "还在吗？选活动不用着急，我就是来看看您有没有什么需要帮忙的 🤗"
  "如果您还没有头绪，我可以帮您推荐几个热门活动选项 👍 随时告诉我！"
  "我又来报到啦～ 😄 活动预约的事想好了吗？有什么疑问可以随时问我哦"
  "Hi～ 之前给您的活动推荐还满意吗？如果想换别的类型，或者有其他想法，直接说就行！"
  "这是最后一封提醒啦 😊 如果暂时不需要活动预约，告诉我就好～ 我不再打扰您了"
)

# Malay messages
MS_MSGS=(
  "Maaf ganggu 😊 Pasal tempahan acara yang kita bincang tadi, ada apa-apa yang nak ditanya atau difikirkan lagi? PM je ya～"
  "Hehe saya datang lagi 🤭 Takut awak terlupa pasal tempahan acara, jadi saya ingatkan sikit. Nak bantu pilih jenis acara atau tengok tarikh?"
  "Saya singgah sikit 😊 Nak tanya macam mana, ada apa-apa yang saya boleh bantu? Jenis acara, harga, tarikh – PM je!"
  "Awak masih ada? Jangan risau, saya ada sini je. Kalau ada apa-apa nak tanya, saya sedia membantu 🤗"
  "Kalau belum ada idea, saya boleh bantu recommend acara yang popular 👍 PM je bila-bila!"
  "Saya datang lagi 😄 Dah fikir pasal tempahan acara? Ada apa-apa nak tanya, PM saya ya"
  "Hi～ Pilihan acara yang saya recommend sebelum ni ok? Kalau nak tukar jenis lain atau ada idea lain, cakap je!"
  "Ini pesanan terakhir saya 😊 Kalau tak berminat dengan tempahan acara, bagitahu saya ya. Saya tak akan ganggu lagi 🙏"
)

# English messages
EN_MSGS=(
  "Just checking in 😊 Was wondering if you've had a chance to think about the event booking? Feel free to ask me anything～"
  "Hey it's me again 🤭 Just a friendly reminder about the event booking! Need help picking an event type or checking dates?"
  "Dropping by to say hi 😊 Whether it's choosing an event, asking about pricing, or picking a date – just let me know!"
  "Still there? No rush at all, just checking if you need any help with the booking 🤗"
  "If you're still undecided, I can recommend some popular event options 👍 Just say the word!"
  "Coming back for a check-in 😄 Have you had a chance to think about the event? Questions are welcome anytime"
  "Hi～ How were the event recommendations I shared? If you'd like to explore other types or have other ideas, just holler!"
  "This is my last check-in 😊 If you're not interested in the event booking anymore, just let me know and I'll stop bothering you 🙏"
)

if [ "$DETECT_LANG" = "zh" ]; then
  FOLLOWUP_TEXT="${ZH_MSGS[$MSG_INDEX]}"
elif [ "$DETECT_LANG" = "ms" ]; then
  FOLLOWUP_TEXT="${MS_MSGS[$MSG_INDEX]}"
else
  FOLLOWUP_TEXT="${EN_MSGS[$MSG_INDEX]}"
fi

# --- Step 7: Update state file (silent) ---
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
state['followupCount'] = state.get('followupCount', 0) + 1
state['lastFollowupLanguage'] = '$DETECT_LANG'

# Track sent message indices to prevent duplicates
sent = state.get('sentMessages', [])
msg_index = $MSG_INDEX
if msg_index not in sent:
    sent.append(msg_index)
state['sentMessages'] = sent

state['lastMessageIndex'] = msg_index
os.makedirs(os.path.dirname(state_file), exist_ok=True)
with open(state_file, 'w') as f:
    json.dump(state, f, indent=2)
" >/dev/null 2>&1

# Output the JSON decision (single line for reliable piping)
ESCAPED_TEXT=$(echo "$FOLLOWUP_TEXT" | python3 -c "import json,sys; print(json.dumps(sys.stdin.read().strip()))")
ESCAPED_USER_MSG=$(echo "$LAST_USER_TEXT" | python3 -c "import json,sys; print(json.dumps(sys.stdin.read().strip()[:200]))")
ELAPSED_MIN=$(( ELAPSED_MS / 60000 ))
echo '{"shouldFollowUp":true,"language":"'"$DETECT_LANG"'","elapsedMinutes":'"$ELAPSED_MIN"',"followupCount":'"$(( FOLLOWUP_COUNT + 1 ))"',"followupMessage":'"$ESCAPED_TEXT"',"lastUserMessage":'"$ESCAPED_USER_MSG"',"customerNumber":"'"$CUSTOMER_NUMBER"'","stateFile":"'"$STATE_FILE"'"}'

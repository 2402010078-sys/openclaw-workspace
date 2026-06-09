#!/bin/bash
# Test script: sends different follow-up messages every 5 minutes to +60105196512
set -euo pipefail

STATE_FILE="/Users/macmini/.openclaw/workspace/state/whatsapp-test-state.json"
mkdir -p "$(dirname "$STATE_FILE")"

MESSAGES=(
  "嘿～ 还没决定好选什么活动吗？不急不急，我就是来看看你 👀"
  "跟你打个招呼 😊 如果选活动时遇到什么问题可以随时问我哦～"
  "还在吗？选活动不用着急，我就是怕你忘了有我在 🤗"
  "嗨～ 如果还没有头绪，我可以帮你推荐几个热门选项 👍"
  "我来报到一下 😄 你之前说想要活动推荐，想好了随时告诉我～"
  "只是过来看看你有没有什么需要帮忙的 😊 选活动这事交给我就行！"
  "嘿嘿又是我～ 怕你忙起来把活动的事忘了，提醒一下 🤭"
  "Hi～ 如果对之前的推荐有疑问，或者想换别的活动类型，直接说就行"
)

COUNTER=$(python3 -c "
import json, os
try:
    with open('$STATE_FILE') as f:
        state = json.load(f)
    print(state.get('counter', -1))
except:
    print(-1)
" 2>/dev/null || echo "-1")

COUNTER=$((COUNTER + 1))

if [ "$COUNTER" -ge "${#MESSAGES[@]}" ]; then
  echo "All $COUNTER test messages sent. Stopping."
  python3 -c "
import json, os
state = {'done': True, 'totalSent': $COUNTER}
with open('$STATE_FILE', 'w') as f:
    json.dump(state, f, indent=2)
"
  exit 0
fi

MSG="${MESSAGES[$COUNTER]}"

python3 -c "
import json, os
state = {}
try:
    with open('$STATE_FILE') as f:
        state = json.load(f)
except:
    pass
state['counter'] = $COUNTER
state['message'] = '''$MSG'''
os.makedirs(os.path.dirname('$STATE_FILE'), exist_ok=True)
with open('$STATE_FILE', 'w') as f:
    json.dump(state, f, indent=2)
"

echo "--- Sending message #$((COUNTER + 1))/${#MESSAGES[@]}: $MSG"

openclaw message send \
  --channel whatsapp \
  --account codligence \
  --target "+60105196512" \
  --message "$MSG" \
  --json 2>&1

echo "--- Done."

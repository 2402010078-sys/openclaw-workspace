import fs from 'node:fs';
import path from 'node:path';

const PHONE = '+60105196512';
const SESSION_KEY = `agent:main:whatsapp:direct:${PHONE}`;
const WORKSPACE = '/Users/macmini/.openclaw/workspace';
const SESSIONS_INDEX = path.join(process.env.HOME || '/Users/macmini', '.openclaw/agents/main/sessions/sessions.json');
const STATE_PATH = path.join(WORKSPACE, 'state/whatsapp-followup-60105196512.json');
const ONE_HOUR_MS = 60 * 60 * 1000;

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}

function parseTs(entryTs, fallbackTs) {
  if (typeof entryTs === 'number' && Number.isFinite(entryTs)) return entryTs;
  const parsed = Date.parse(entryTs || fallbackTs || '');
  return Number.isFinite(parsed) ? parsed : 0;
}

function extractText(content = []) {
  return content
    .filter((part) => part && part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text.trim())
    .filter(Boolean)
    .join('\n')
    .trim();
}

function detectLanguage(text) {
  if (/[\p{Script=Han}]/u.test(text)) return 'zh';
  const lower = text.toLowerCase();
  const malayHints = [
    'tak', 'taknak', 'nak', 'boleh', 'saya', 'awak', 'nanti', 'kahwin', 'majlis', 'dekat', 'macam', 'dulu', 'ya', 'ke', 'je', 'bole', 'terima kasih'
  ];
  if (malayHints.some((hint) => lower.includes(hint))) return 'ms';
  return 'en';
}

function pickTemplate(lang, seed, sentCount) {
  const templates = {
    zh: [
      '没关系～ 你慢慢想就好 😊 我这边一直都在的，如果你突然想到什么想问的，随时跟我说～ 🤗',
      '先不用急着决定也没关系呀 👀 你如果想继续了解活动方案，我这边可以继续帮你整理。',
      '我这边先帮你留着～ 有想到什么想问的，随时直接跟我说就好 😄'
    ],
    ms: [
      'Tak apa, awak fikir dulu ya 😊 Saya ada di sini je. Kalau awak nak sambung tengok cadangan event, terus reply saya ya.',
      'Tak perlu rush pun 👀 Bila-bila awak nak sambung discuss pasal event, saya boleh bantu terus.',
      'Saya standby di sini je 😄 Kalau tiba-tiba awak teringat nak tanya apa-apa, terus mesej saya ya.'
    ],
    en: [
      "No worries, take your time 😊 I'm here whenever you want to continue, and I can keep sharing event ideas if you'd like.",
      'No pressure at all 👀 If you want to continue exploring event options later, just drop me a message anytime.',
      "I'm still here 😄 If anything comes to mind or you want more event suggestions, just reply and I'll help you out."
    ]
  };

  const list = templates[lang] || templates.en;
  const raw = `${seed}|${sentCount}`;
  let hash = 0;
  for (const ch of raw) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return list[hash % list.length];
}

const sessions = readJson(SESSIONS_INDEX);
const sessionMeta = sessions[SESSION_KEY];
if (!sessionMeta?.sessionFile || !fs.existsSync(sessionMeta.sessionFile)) {
  console.log('NO_REPLY');
  process.exit(0);
}

const lines = fs
  .readFileSync(sessionMeta.sessionFile, 'utf8')
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean);

const visibleMessages = [];
for (const line of lines) {
  let row;
  try {
    row = JSON.parse(line);
  } catch {
    continue;
  }
  if (row?.type !== 'message') continue;
  const role = row?.message?.role;
  if (role !== 'user' && role !== 'assistant') continue;
  const text = extractText(row?.message?.content || []);
  if (!text) continue;
  const ts = parseTs(row?.message?.timestamp, row?.timestamp);
  if (!ts) continue;
  visibleMessages.push({ role, text, ts });
}

if (visibleMessages.length < 2) {
  console.log('NO_REPLY');
  process.exit(0);
}

const lastVisible = visibleMessages[visibleMessages.length - 1];
const lastUser = [...visibleMessages].reverse().find((msg) => msg.role === 'user');
const lastAssistant = [...visibleMessages].reverse().find((msg) => msg.role === 'assistant');

if (!lastUser || !lastAssistant) {
  console.log('NO_REPLY');
  process.exit(0);
}

const now = Date.now();
let state = {};
if (fs.existsSync(STATE_PATH)) {
  try {
    state = readJson(STATE_PATH);
  } catch {
    state = {};
  }
}

if (lastVisible.role === 'user') {
  writeJson(STATE_PATH, {
    phone: PHONE,
    lastUserTs: lastUser.ts,
    lastAssistantTs: lastAssistant.ts,
    waitingForUser: false,
    followupCount: 0,
    updatedAt: new Date(now).toISOString()
  });
  console.log('NO_REPLY');
  process.exit(0);
}

const assistantAge = now - lastAssistant.ts;
if (assistantAge < ONE_HOUR_MS) {
  console.log('NO_REPLY');
  process.exit(0);
}

const sameAssistantThread = state.lastAssistantTs === lastAssistant.ts;
const lastFollowupTs = sameAssistantThread ? (state.lastFollowupTs || 0) : 0;
if (lastFollowupTs && now - lastFollowupTs < ONE_HOUR_MS) {
  console.log('NO_REPLY');
  process.exit(0);
}

const followupCount = sameAssistantThread ? (state.followupCount || 0) : 0;
const lang = detectLanguage(lastUser.text);
const followup = pickTemplate(lang, lastUser.text, followupCount + 1);

writeJson(STATE_PATH, {
  phone: PHONE,
  language: lang,
  lastUserTs: lastUser.ts,
  lastAssistantTs: lastAssistant.ts,
  lastFollowupTs: now,
  followupCount: followupCount + 1,
  waitingForUser: true,
  updatedAt: new Date(now).toISOString(),
  preview: followup
});

console.log(followup);

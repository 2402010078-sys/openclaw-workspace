import fs from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';

const defaultStore = path.join(os.homedir(), '.openclaw', 'agents', 'main', 'sessions', 'sessions.json');
const sessionStorePath = process.env.OPENCLAW_SESSION_STORE || defaultStore;
const collectionName = process.env.FIREBASE_COLLECTION || 'whatsappChats';
const databaseId = process.env.FIRESTORE_DATABASE_ID || null;
const defaultSyncStatePath = new URL('../state/whatsapp-firestore-sync-state.json', import.meta.url);
const syncStatePath = process.env.WHATSAPP_FIREBASE_SYNC_STATE || defaultSyncStatePath;
const seedStateOnly = process.env.WHATSAPP_FIREBASE_SEED_STATE_ONLY === '1';
const localCredentialsUrl = new URL('../serviceAccountKey.json', import.meta.url);

function loadServiceAccount() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  }
  const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (credentialsPath) {
    return JSON.parse(requireText(credentialsPath));
  }
  if (existsSync(localCredentialsUrl)) {
    return JSON.parse(readFileSync(localCredentialsUrl, 'utf8'));
  }
  throw new Error('Set GOOGLE_APPLICATION_CREDENTIALS, FIREBASE_SERVICE_ACCOUNT_JSON, or place serviceAccountKey.json in the workspace root.');
}

function requireText(filePath) {
  return readFileSync(filePath, 'utf8');
}

function initFirestore() {
  const existingApp = admin.apps.length ? admin.apps[0] : null;
  const app = existingApp || (() => {
    const serviceAccount = loadServiceAccount();
    return admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: process.env.FIREBASE_PROJECT_ID || serviceAccount.project_id,
    });
  })();

  return databaseId ? getFirestore(app, databaseId) : getFirestore(app);
}

function getTextParts(content = []) {
  return content
    .filter((part) => part?.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text.trim())
    .filter(Boolean);
}

function extractUserBody(rawText = '') {
  const senderPattern = /Sender \(untrusted metadata\):\n```json[\s\S]*?```\n\n([\s\S]*?)(?:\n\n\[Bootstrap truncation warning\][\s\S]*)?$/;
  const match = rawText.match(senderPattern);
  const body = (match?.[1] || rawText).trim();
  if (!body) return null;
  if (body.startsWith('[Startup context loaded by runtime]')) return null;
  return body;
}

async function parseSessionFile(entry) {
  const fileText = await fs.readFile(entry.sessionFile, 'utf8');
  const lines = fileText.split('\n').filter(Boolean);
  const sessionId = entry.sessionId || 'unknown-session';
  const items = [];

  for (const line of lines) {
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }

    if (record.type !== 'message' || !record.message) continue;

    const role = record.message.role;
    if (role === 'user') {
      const rawText = getTextParts(record.message.content).join('\n\n');
      const text = extractUserBody(rawText);
      if (!text) continue;
      items.push({
        id: `${sessionId}_${record.id}`,
        chatId: entry.deliveryContext?.to || entry.origin?.from || entry.lastTo || 'unknown',
        sessionKey: entry.sessionKey,
        sessionId,
        direction: 'inbound',
        role: 'user',
        text,
        rawText,
        timestamp: record.timestamp,
        provider: entry.origin?.provider || entry.lastChannel || 'unknown',
      });
      continue;
    }

    if (role === 'assistant' && (record.message.provider === 'openclaw' || record.message.model === 'delivery-mirror')) {
      const parts = getTextParts(record.message.content);
      if (!parts.length) continue;
      items.push({
        id: `${sessionId}_${record.id}`,
        chatId: entry.deliveryContext?.to || entry.origin?.from || entry.lastTo || 'unknown',
        sessionKey: entry.sessionKey,
        sessionId,
        direction: 'outbound',
        role: 'assistant',
        text: parts.join('\n\n').trim(),
        timestamp: record.timestamp,
        provider: record.message.provider || 'openclaw',
      });
    }
  }

  return items;
}

async function loadWhatsappSessions() {
  const store = JSON.parse(await fs.readFile(sessionStorePath, 'utf8'));
  return Object.entries(store)
    .filter(([, entry]) => (entry?.origin?.provider || entry?.lastChannel) === 'whatsapp')
    .map(([sessionKey, entry]) => ({ ...entry, sessionKey }));
}

async function loadSyncState() {
  try {
    const stateText = await fs.readFile(syncStatePath, 'utf8');
    const parsed = JSON.parse(stateText);
    return parsed && typeof parsed === 'object' ? parsed : { sessions: {} };
  } catch (error) {
    if (error?.code === 'ENOENT') return { sessions: {} };
    throw error;
  }
}

async function saveSyncState(state) {
  const targetPath = syncStatePath instanceof URL ? syncStatePath : path.resolve(syncStatePath);
  const dirPath = targetPath instanceof URL ? new URL('.', targetPath) : path.dirname(targetPath);
  await fs.mkdir(dirPath, { recursive: true });
  await fs.writeFile(targetPath, JSON.stringify(state, null, 2) + '\n', 'utf8');
}

function isNewerThanCursor(item, cursor) {
  if (!cursor?.lastTimestamp) return true;
  const itemTime = Date.parse(item.timestamp || '');
  const cursorTime = Date.parse(cursor.lastTimestamp || '');

  if (Number.isNaN(itemTime) || Number.isNaN(cursorTime)) {
    return item.id !== cursor?.lastId;
  }

  if (itemTime > cursorTime) return true;
  if (itemTime < cursorTime) return false;

  if (!cursor?.lastId) return false;
  return item.id > cursor.lastId;
}

function getSessionCursor(sortedItems) {
  const lastItem = sortedItems.at(-1);
  if (!lastItem) return null;

  return {
    lastTimestamp: lastItem.timestamp || null,
    lastId: lastItem.id || null,
    totalMessages: sortedItems.length,
    updatedAt: new Date().toISOString(),
  };
}

async function chunkedWrite(db, chatId, chatMeta, items) {
  const chatRef = db.collection(collectionName).doc(chatId);
  await chatRef.set(chatMeta, { merge: true });

  for (let i = 0; i < items.length; i += 400) {
    const slice = items.slice(i, i + 400);
    const batch = db.batch();
    for (const item of slice) {
      batch.set(chatRef.collection('messages').doc(item.id), item, { merge: true });
    }
    await batch.commit();
  }
}

async function main() {
  const sessions = await loadWhatsappSessions();
  const syncState = await loadSyncState();
  syncState.sessions ||= {};
  let db = null;
  let syncedSessions = 0;
  let syncedMessages = 0;
  let skippedSessions = 0;

  for (const entry of sessions) {
    const chatId = entry.deliveryContext?.to || entry.origin?.from || entry.lastTo;
    if (!chatId) continue;

    const items = await parseSessionFile(entry);
    if (!items.length) continue;

    const sorted = items.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    const cursor = syncState.sessions[entry.sessionKey];
    const newItems = cursor ? sorted.filter((item) => isNewerThanCursor(item, cursor)) : sorted;
    const nextCursor = getSessionCursor(sorted);

    if (seedStateOnly) {
      if (nextCursor) syncState.sessions[entry.sessionKey] = nextCursor;
      skippedSessions += 1;
      continue;
    }

    if (!newItems.length) {
      if (nextCursor) syncState.sessions[entry.sessionKey] = nextCursor;
      skippedSessions += 1;
      continue;
    }

    db ||= initFirestore();
    await chunkedWrite(db, chatId, {
      chatId,
      sessionKey: entry.sessionKey,
      sessionId: entry.sessionId,
      accountId: entry.lastAccountId || entry.origin?.accountId || null,
      label: entry.origin?.label || chatId,
      lastSyncedAt: new Date().toISOString(),
      lastMessageAt: sorted.at(-1)?.timestamp || null,
      totalMessages: sorted.length,
      totalNewMessagesSynced: newItems.length,
    }, newItems);
    if (nextCursor) syncState.sessions[entry.sessionKey] = nextCursor;
    syncedSessions += 1;
    syncedMessages += newItems.length;
  }

  syncState.lastRunAt = new Date().toISOString();
  syncState.sessionStorePath = sessionStorePath;
  syncState.collection = collectionName;
  syncState.databaseId = databaseId || '(default)';
  await saveSyncState(syncState);

  console.log(JSON.stringify({
    ok: true,
    sessionStorePath,
    discoveredSessions: sessions.length,
    syncedSessions,
    syncedMessages,
    skippedSessions,
    collection: collectionName,
    databaseId: databaseId || '(default)',
    seedStateOnly,
    syncStatePath: syncStatePath instanceof URL ? syncStatePath.pathname : path.resolve(syncStatePath),
  }, null, 2));
}

main().catch((error) => {
  console.error(error?.stack || String(error));
  process.exit(1);
});

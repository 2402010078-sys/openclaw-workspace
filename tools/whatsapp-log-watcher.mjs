#!/usr/bin/env node

/**
 * WhatsApp Log Watcher v2
 *
 * Uses `tail -F` to monitor OpenClaw WhatsApp gateway logs in real-time.
 * Automatically writes inbound/outbound messages to Laravel dashboard SQLite.
 *
 * Usage:
 *   node tools/whatsapp-log-watcher.mjs
 *   pm2 start tools/whatsapp-log-watcher.mjs --name wa-log-watcher
 */

import { spawn } from 'child_process';
import { createInterface } from 'readline';
import { existsSync } from 'fs';
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = '/Users/macmini/chatbot-dashboard/dashboard-laravel/database/database.sqlite';
const OPENCLAW_BOT_NUMBER = '+60129615098';

// Map phone numbers to known customer names
const PHONE_TO_NAME = {
  '+601153968752': 'lily',
  '+60105196512': 'Stelle',
  '+601126447382': 'Mandy',
  '+60109685555': 'Justin',
};

function getNameFromPhone(phone) {
  return PHONE_TO_NAME[phone] || phone;
}

function getDb() {
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  return db;
}

const recentLogs = new Map();
const DEDUP_WINDOW_MS = 60_000;

function isDuplicate(key) {
  const now = Date.now();
  if (recentLogs.has(key)) {
    const last = recentLogs.get(key);
    if (now - last < DEDUP_WINDOW_MS) return true;
  }
  recentLogs.set(key, now);
  for (const [k, v] of recentLogs) {
    if (now - v > DEDUP_WINDOW_MS) recentLogs.delete(k);
  }
  return false;
}

function writeToDb({ user, message, reply, platform, intent, phone }) {
  try {
    const db = getDb();
    
    let customer = db.prepare('SELECT id, name, phone FROM chat_customers WHERE name = ?').get(user);
    if (!customer) {
      const now = new Date().toISOString().replace('T', ' ').split('.')[0];
      const info = db.prepare(`
        INSERT INTO chat_customers (name, phone, platform, first_contact_at, last_message_at, created_at, updated_at)
        VALUES (?, ?, 'WhatsApp', ?, ?, ?, ?)
      `).run(user, phone || '', now, now, now, now);
      customer = { id: info.lastInsertRowid, name: user };
    }

    const now = new Date();
    const sentAt = now.toISOString().replace('T', ' ').split('.')[0];

    if (message && message !== '(Dashboard sent message)') {
      db.prepare(`
        INSERT INTO chat_messages (customer_id, sender, message, intent, booking_ref, notes, sent_at)
        VALUES (?, 'customer', ?, ?, '', '', ?)
      `).run(customer.id, message, intent || '', sentAt);
    }

    if (reply) {
      db.prepare(`
        INSERT INTO chat_messages (customer_id, sender, message, intent, booking_ref, notes, sent_at)
        VALUES (?, 'bot', ?, ?, '', '', ?)
      `).run(customer.id, reply, intent || '', sentAt);
    }

    const p = phone || '';
    if (p) {
      db.prepare('UPDATE chat_customers SET last_message_at = ?, phone = ? WHERE id = ?')
        .run(sentAt, p, customer.id);
    } else {
      db.prepare('UPDATE chat_customers SET last_message_at = ? WHERE id = ?')
        .run(sentAt, customer.id);
    }

    db.close();
    return true;
  } catch (e) {
    console.error(`[wa-watcher] DB error: ${e.message} (user=${user}, phone=${JSON.stringify(phone)}, messageLen=${(message||'').length}, replyLen=${(reply||'').length})`);
    return false;
  }
}

// Pending replies keyed by correlationId
const pending = new Map(); // correlationId -> { customer, phone, customerMessage, timestamp }

function handleInbound(rawData) {
  const from = rawData.from;
  const to = rawData.to;
  let body = rawData.body || '';
  const correlationId = rawData.correlationId;

  if (!from || !body) return;
  if (to !== OPENCLAW_BOT_NUMBER) return; // only customer->bot messages

  const customerPhone = from;
  const customerName = getNameFromPhone(customerPhone);
  const dedupKey = `in:${from}:${body}`;
  if (isDuplicate(dedupKey)) return;

  // Extract clean body from auto-reply format: "[WhatsApp +60xxx timestamp] body"
  const match = body.match(/\]\s*(.+)/s);
  const cleanBody = match ? match[1].trim() : body;
  if (!cleanBody || cleanBody === `[WhatsApp`) return;

  // Check if this inbound has a matching pending reply (same correlationId or recent phone match)
  if (correlationId && pending.has(correlationId)) {
    const p = pending.get(correlationId);
    writeToDb({ user: customerName, message: cleanBody, reply: p.botReply, platform: 'WhatsApp', intent: 'other', phone: customerPhone });
    console.log(`[wa-watcher] ✅ ${customerName}: "${cleanBody.slice(0,40)}" ↔ "${p.botReply.slice(0,40)}" (corr:${correlationId.slice(0,8)})`);
    pending.delete(correlationId);
    return;
  }

  // Also try to match by phone within 3 seconds
  for (const [cid, p] of pending) {
    if (p.phone === customerPhone && (Date.now() - p.timestamp) < 3000) {
      writeToDb({ user: customerName, message: cleanBody, reply: p.botReply, platform: 'WhatsApp', intent: 'other', phone: customerPhone });
      console.log(`[wa-watcher] ✅ ${customerName}: "${cleanBody.slice(0,40)}" ↔ "${p.botReply.slice(0,40)}" (matched by phone)`);
      pending.delete(cid);
      return;
    }
  }

  // No match — log just the inbound
  writeToDb({ user: customerName, message: cleanBody, reply: '', platform: 'WhatsApp', intent: 'other', phone: customerPhone });
  console.log(`[wa-watcher] 📥 ${customerName}: "${cleanBody.slice(0,50)}"`);
}

function handleOutbound(data) {
  const { correlationId, from, to, text } = data;
  if (!correlationId || !text) return;
  if (from !== OPENCLAW_BOT_NUMBER) return; // only bot replies

  const customerPhone = to;
  const customerName = getNameFromPhone(customerPhone);
  const dedupKey = `out:${to}:${text}`;
  if (isDuplicate(dedupKey)) return;

  // Check if we already have the inbound for this correlationId
  // If not, store pending
  pending.set(correlationId, {
    botReply: text,
    phone: customerPhone,
    customerName,
    timestamp: Date.now()
  });

  // Clean stale pendings (>30s)
  for (const [cid, p] of pending) {
    if (Date.now() - p.timestamp > 30000) pending.delete(cid);
  }
}

function parseLine(line) {
  try {
    const parsed = JSON.parse(line);
    const modStr = parsed['0'];
    if (!modStr) return null;
    const modInfo = JSON.parse(modStr);
    const data = parsed['1'];
    const tag = parsed['2'];

    if (!modInfo || !data) return null;

    // web-auto-reply events have the full payload
    if (modInfo.module === 'web-auto-reply') {
      // Outbound: has 'text' field
      if (data.text && data.from && data.to) {
        return { type: 'outbound', data: { correlationId: data.correlationId, from: data.from, to: data.to, text: data.text } };
      }
      // Inbound: has 'body' field
      if (data.body && data.from && data.to) {
        return { type: 'inbound', data: { from: data.from, to: data.to, body: data.body, correlationId: data.correlationId } };
      }
    }

    // web-inbound: raw inbound
    if (modInfo.module === 'web-inbound' && data.body && data.from) {
      return { type: 'inbound', data: { ...data, correlationId: null } };
    }

    return null;
  } catch {
    return null;
  }
}

// --- Main ---
const today = new Date();
const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
const logPath = `/tmp/openclaw/openclaw-${dateStr}.log`;

if (!existsSync(logPath)) {
  // Try finding the latest log file
  const { readdirSync } = await import('fs');
  const files = readdirSync('/tmp/openclaw').filter(f => f.startsWith('openclaw-') && f.endsWith('.log')).sort();
  const latest = files[files.length - 1];
  if (latest) {
    logPath = `/tmp/openclaw/${latest}`;
  } else {
    console.error(`[wa-watcher] No log files found in /tmp/openclaw/`);
    process.exit(1);
  }
}

console.log(`[wa-watcher] 🚀 Watching: ${logPath}`);
console.log(`[wa-watcher] 🤖 Bot: ${OPENCLAW_BOT_NUMBER}`);
console.log(`[wa-watcher] 🗄️  DB: ${DB_PATH}`);

// Process a single log line
function processLine(line) {
  if (!line.trim()) return;
  const event = parseLine(line);
  if (!event) return;

  try {
    if (event.type === 'inbound') handleInbound(event.data);
    else if (event.type === 'outbound') handleOutbound(event.data);
  } catch (e) {
    console.error(`[wa-watcher] Error: ${e.message}`);
  }
}

// Backfill: scan existing log file to catch messages before watcher started
console.log(`[wa-watcher] 📖 Scanning existing log for backfill...`);
const cat = spawn('cat', [logPath], { stdio: ['ignore', 'pipe', 'inherit'] });
const catRl = createInterface({ input: cat.stdout });
catRl.on('line', processLine);
cat.on('exit', () => {
  console.log(`[wa-watcher] ✅ Backfill complete. Now watching for new messages...`);
  
  // Now start tail for real-time
  const tail = spawn('tail', ['-F', '-n', '0', logPath], {
    stdio: ['ignore', 'pipe', 'inherit']
  });

  const rl = createInterface({ input: tail.stdout });
  rl.on('line', processLine);

  tail.on('exit', (code) => {
    console.error(`[wa-watcher] tail exited with code ${code}, restarting in 3s...`);
    setTimeout(() => process.exit(1), 3000);
  });
});

// Graceful shutdown
process.on('SIGINT', () => { tail.kill(); process.exit(0); });
process.on('SIGTERM', () => { tail.kill(); process.exit(0); });

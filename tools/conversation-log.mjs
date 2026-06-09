#!/usr/bin/env node

/**
 * Conversation Log — writes chatbot interactions to local SQLite database.
 *
 * Usage:
 *   node tools/conversation-log.mjs log --user "Peter" --message "hi" --reply "Hi 👋..." --platform "WhatsApp" [--intent "opening"] [--booking "B009"] [--note "..."]
 *   node tools/conversation-log.mjs sync-booking --date "25/12/2026" --time "14:00-16:00" --eventType "Birthday" --guests 50 --location "Kuching" [--remark "Blue theme"] [--customerName "Peter"] [--phone "0123456789"] [--bookingId "B009"] [--status "confirmed"]
 */

import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import http from 'http';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = '/Users/macmini/chatbot-dashboard/dashboard-laravel/database/database.sqlite';

function getDb() {
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  return db;
}

function ensureCustomer(db, name, phone = '') {
  const existing = db.prepare('SELECT id, name FROM chat_customers WHERE name = ?').get(name);
  if (existing) return existing;

  const now = new Date().toISOString().replace('T', ' ').split('.')[0];
  const info = db.prepare(`
    INSERT INTO chat_customers (name, phone, platform, first_contact_at, last_message_at, created_at, updated_at)
    VALUES (?, ?, 'WhatsApp', ?, ?, ?, ?)
  `).run(name, phone || '', now, now, now, now);

  return { id: info.lastInsertRowid, name };
}

function logMessage({ user, message, reply, platform, intent, booking, note, phone }) {
  const db = getDb();

  const customer = ensureCustomer(db, user, phone || '');

  const now = new Date();
  const sentAt = now.toISOString().replace('T', ' ').split('.')[0];
  const dateStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;

  // Log customer message
  if (message && message !== '(Dashboard sent message)') {
    db.prepare(`
      INSERT INTO chat_messages (customer_id, sender, message, intent, booking_ref, notes, sent_at)
      VALUES (?, 'customer', ?, ?, ?, ?, ?)
    `).run(customer.id, message, intent || '', booking || '', note || '', sentAt);
  }

  // Log bot reply
  if (reply) {
    db.prepare(`
      INSERT INTO chat_messages (customer_id, sender, message, intent, booking_ref, notes, sent_at)
      VALUES (?, 'bot', ?, ?, ?, ?, ?)
    `).run(customer.id, reply, intent || '', booking || '', note || '', sentAt);
  }

  // Update last_message_at
  db.prepare('UPDATE chat_customers SET last_message_at = ?, phone = CASE WHEN ? != \'\' AND phone IS NULL THEN ? ELSE phone END WHERE id = ?')
    .run(sentAt, phone || '', phone || '', customer.id);

  db.close();

  return { ok: true, customer: customer.name, customerId: customer.id };
}

// --- CLI ---
const [cmd, ...args] = process.argv.slice(2);

if (cmd === 'log') {
  const opts = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i].replace(/^--/, '');
    opts[key] = args[i + 1] || '';
  }

  if (!opts.user) {
    console.error(JSON.stringify({ ok: false, error: 'Missing --user' }));
    process.exit(1);
  }

  try {
    const result = logMessage({
      user: opts.user,
      message: opts.message || '',
      reply: opts.reply || '',
      platform: opts.platform || 'WhatsApp',
      intent: opts.intent || '',
      booking: opts.booking || '',
      note: opts.note || '',
      phone: opts.phone || ''
    });
    console.log(JSON.stringify(result));
  } catch (e) {
    console.error(JSON.stringify({ ok: false, error: e.message }));
    process.exit(1);
  }
}

else if (cmd === 'sync-booking') {
  const opts = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i].replace(/^--/, '');
    opts[key] = args[i + 1] || '';
  }

  if (!opts.date || !opts.time || !opts.eventType || !opts.location) {
    console.error(JSON.stringify({ ok: false, error: 'Missing required: --date, --time, --eventType, --location' }));
    process.exit(1);
  }

  // Parse time range
  const [timeFrom, timeTo] = (opts.time || '').split('-');

  const payload = JSON.stringify({
    date: opts.date,
    time_from: timeFrom || '',
    time_to: timeTo || '',
    event_type: opts.eventType,
    guests: parseInt(opts.guests || '0', 10),
    location: opts.location,
    remark: opts.remark || '',
    customer_name: opts.customerName || '',
    phone: opts.phone || '',
    booking_id: opts.bookingId || '',
    status: opts.status || 'confirmed',
  });

  const req = http.request({
    hostname: 'localhost',
    port: 4567,
    path: '/api/webhook/sync-booking',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
    },
  }, (res) => {
    let body = '';
    res.on('data', (chunk) => body += chunk);
    res.on('end', () => {
      try {
        console.log(JSON.stringify(JSON.parse(body)));
      } catch {
        console.log(JSON.stringify({ ok: false, error: body }));
      }
    });
  });

  req.on('error', (e) => {
    console.error(JSON.stringify({ ok: false, error: e.message }));
    process.exit(1);
  });

  req.write(payload);
  req.end();
}

else if (cmd === 'delete-booking') {
  const opts = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i].replace(/^--/, '');
    opts[key] = args[i + 1] || '';
  }

  if (!opts.bookingId) {
    console.error(JSON.stringify({ ok: false, error: 'Missing --bookingId' }));
    process.exit(1);
  }

  const req = http.request({
    hostname: 'localhost',
    port: 4567,
    path: '/api/webhook/sync-booking/' + encodeURIComponent(opts.bookingId),
    method: 'DELETE',
  }, (res) => {
    let body = '';
    res.on('data', (chunk) => body += chunk);
    res.on('end', () => {
      try {
        console.log(JSON.stringify(JSON.parse(body)));
      } catch {
        console.log(JSON.stringify({ ok: false, error: body }));
      }
    });
  });

  req.on('error', (e) => {
    console.error(JSON.stringify({ ok: false, error: e.message }));
    process.exit(1);
  });

  req.end();
}

else {
  console.log(JSON.stringify({
    commands: {
      log: 'node tools/conversation-log.mjs log --user "Name" --message "user said" --reply "bot said" --platform "WhatsApp" [--intent "opening"] [--booking "B009"] [--note "..."]'
    }
  }));
}

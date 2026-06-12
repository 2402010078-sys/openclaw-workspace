#!/usr/bin/env node

/**
 * Conversation Log — writes chatbot interactions via Laravel webhook.
 *
 * NO LONGER writes directly to SQLite (to avoid database lock conflicts).
 * ALL writes go through localhost:4567 Laravel API.
 *
 * Usage:
 *   node tools/conversation-log.mjs log --user "Peter" --message "hi" --reply "Hi 👋..." --platform "WhatsApp" [--intent "opening"] [--booking "B009"] [--note "..."]
 *   node tools/conversation-log.mjs sync-booking --date "25/12/2026" --time "14:00-16:00" --eventType "Birthday" --guests 50 --location "Kuching" [--remark "Blue theme"] [--customerName "Peter"] [--phone "0123456789"] [--bookingId "B009"] [--status "confirmed"]
 *   node tools/conversation-log.mjs delete-booking --bookingId "B009"
 */

import http from 'http';

const WEBHOOK_BASE = 'http://localhost:4567/api/webhook';

function parseArgs(args) {
  const opts = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i].replace(/^--/, '');
    opts[key] = args[i + 1] || '';
  }
  return opts;
}

function httpPost(path, data) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(data);
    const req = http.request({
      hostname: 'localhost',
      port: 4567,
      path,
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
          resolve(JSON.parse(body));
        } catch {
          resolve({ ok: false, error: 'invalid JSON response: ' + body.substring(0, 200) });
        }
      });
    });

    req.on('error', (e) => reject(e));
    req.write(payload);
    req.end();
  });
}

function httpDelete(path) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: 'localhost',
      port: 4567,
      path,
      method: 'DELETE',
    }, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch {
          resolve({ ok: false, error: 'invalid JSON response: ' + body.substring(0, 200) });
        }
      });
    });

    req.on('error', (e) => reject(e));
    req.end();
  });
}

// --- CLI ---
const [cmd, ...args] = process.argv.slice(2);

if (cmd === 'log') {
  const opts = parseArgs(args);

  if (!opts.user) {
    console.error(JSON.stringify({ ok: false, error: 'Missing --user' }));
    process.exit(1);
  }

  httpPost('/api/webhook/log-message', {
    customerName: opts.user,
    customerMessage: opts.message || '',
    botReply: opts.reply || '',
    platform: opts.platform || 'WhatsApp',
    phone: opts.phone || '',
    intent: opts.intent || '',
    bookingRef: opts.booking || '',
    notes: opts.note || '',
  })
    .then((result) => {
      console.log(JSON.stringify(result));
      if (!result.ok) process.exit(1);
    })
    .catch((e) => {
      console.error(JSON.stringify({ ok: false, error: e.message }));
      process.exit(1);
    });
} else if (cmd === 'sync-booking') {
  const opts = parseArgs(args);

  if (!opts.date || !opts.time || !opts.eventType || !opts.location) {
    console.error(JSON.stringify({ ok: false, error: 'Missing required: --date, --time, --eventType, --location' }));
    process.exit(1);
  }

  const [timeFrom, timeTo] = (opts.time || '').split('-');

  httpPost('/api/webhook/sync-booking', {
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
  })
    .then((result) => {
      console.log(JSON.stringify(result));
      if (!result.ok) process.exit(1);
    })
    .catch((e) => {
      console.error(JSON.stringify({ ok: false, error: e.message }));
      process.exit(1);
    });
} else if (cmd === 'delete-booking') {
  const opts = parseArgs(args);

  if (!opts.bookingId) {
    console.error(JSON.stringify({ ok: false, error: 'Missing --bookingId' }));
    process.exit(1);
  }

  httpDelete('/api/webhook/sync-booking/' + encodeURIComponent(opts.bookingId))
    .then((result) => {
      console.log(JSON.stringify(result));
      if (!result.ok) process.exit(1);
    })
    .catch((e) => {
      console.error(JSON.stringify({ ok: false, error: e.message }));
      process.exit(1);
    });
} else {
  console.log(JSON.stringify({
    commands: {
      log: 'node tools/conversation-log.mjs log --user "Name" --message "user said" --reply "bot said" --platform "WhatsApp" [--intent "opening"] [--booking "B009"] [--note "..."]',
      'sync-booking': 'node tools/conversation-log.mjs sync-booking --date "DD/MM/YYYY" --time "HH:00-HH:00" --eventType "..." --guests N --location "..." [--bookingId "B00X"]',
      'delete-booking': 'node tools/conversation-log.mjs delete-booking --bookingId "B00X"',
    }
  }));
}

#!/usr/bin/env node

/**
 * EventFlow Dashboard — HTTP Server
 * Serves static dashboard UI and provides REST API for bookings, chat, tags.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';

// ============================================================
// Configuration
// ============================================================
const PORT = parseInt(process.env.PORT || '4567', 10);
const CHAT_SPREADSHEET_ID = '1QoPoK8AKVMDJyEpcOxAXi4AtCXJIq5Ue9WB_xYVqW7k';
const BOOKING_SPREADSHEET_ID = '1tD561HQOx3zDL4PtK_EhCXEkQFc4EhY_rqrIlBckbko';
const MATON_BASE = 'https://gateway.maton.ai/google-sheets/v4/spreadsheets';
const CONNECTION_ID = 'ed42aabd-396c-4a07-b801-88811529fbf8';
const TOOL_PATH = path.join(import.meta.dirname, '..', 'tools', 'google-sheets-booking.mjs');

const CACHE_TTL = 30_000; // 30 seconds
const SAVE_COMMAND_TIMEOUT = 60_000; // 60s for save subprocess
const SEND_MESSAGE_TIMEOUT = 90_000; // 90s for message send

// ============================================================
// API Key loading
// ============================================================
function loadApiKey() {
  if (process.env.MATON_API_KEY) return process.env.MATON_API_KEY;

  try {
    const home = os.homedir();
    const zshrc = readFileSync(path.join(home, '.zshrc'), 'utf-8');
    const match = zshrc.match(/export\s+MATON_API_KEY\s*=\s*['"]?([^'"\n]+)['"]?/);
    if (match) return match[1].trim();
  } catch {
    // ignore
  }

  console.error('WARNING: MATON_API_KEY not found in env or ~/.zshrc');
  return '';
}

const MATON_API_KEY = loadApiKey();

// ============================================================
// MIME types
// ============================================================
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

// ============================================================
// Helpers
// ============================================================

/** Get local network IP for mobile access */
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

/** Send JSON response */
function json(res, statusCode, data) {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

/** Error response helper */
function jsonError(res, statusCode, message) {
  json(res, statusCode, { ok: false, error: message });
}

/** Parse JSON body from request */
function parseBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8')));
      } catch (e) {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

/** Exec a child process and return { stdout, stderr, code } */
function execCommand(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      ...opts,
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (d) => stdout.push(d));
    child.stderr.on('data', (d) => stderr.push(d));
    const timer = opts.timeout
      ? setTimeout(() => {
          child.kill('SIGTERM');
          reject(new Error(`Command timed out after ${opts.timeout}ms`));
        }, opts.timeout)
      : null;

    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      resolve({
        code,
        stdout: Buffer.concat(stdout).toString('utf-8'),
        stderr: Buffer.concat(stderr).toString('utf-8'),
      });
    });
    child.on('error', reject);
  });
}

// ============================================================
// Booking Cache
// ============================================================
let bookingCache = null;
let bookingCacheTime = 0;

function isBookingCacheValid() {
  return bookingCache && (Date.now() - bookingCacheTime) < CACHE_TTL;
}

function setBookingCache(data) {
  bookingCache = data;
  bookingCacheTime = Date.now();
}

function invalidateBookingCache() {
  bookingCache = null;
  bookingCacheTime = 0;
}

// ============================================================
// Maton API helpers
// ============================================================

/**
 * Read a Google Sheets range via Maton.
 * @param {string} spreadsheetId
 * @param {string} range e.g. "'All Bookings'!A:K"
 * @returns {Promise<Array<Array>>} rows array
 */
async function matonRead(spreadsheetId, range) {
  const url = `${MATON_BASE}/${spreadsheetId}/values/${encodeURIComponent(range)}`;

  const res = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${MATON_API_KEY}`,
      'X-Connection-Id': CONNECTION_ID,
      'Accept': 'application/json',
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Maton read failed (${res.status}): ${body}`);
  }

  const data = await res.json();
  return data.values || [];
}

/**
 * Write values to a Google Sheets range via Maton.
 * @param {string} spreadsheetId
 * @param {string} range
 * @param {Array<Array>} values
 * @param {string} [valueInputOption] defaults to RAW
 */
async function matonWrite(spreadsheetId, range, values, valueInputOption = 'RAW') {
  const url = `${MATON_BASE}/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=${valueInputOption}`;

  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${MATON_API_KEY}`,
      'X-Connection-Id': CONNECTION_ID,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({
      range,
      values,
      majorDimension: 'ROWS',
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Maton write failed (${res.status}): ${body}`);
  }

  return res.json();
}

// ============================================================
// API Handlers
// ============================================================

/** GET /api/bookings */
async function handleGetBookings(req, res) {
  try {
    if (!isBookingCacheValid()) {
      const range = "'All Bookings'!A:K";
      const rows = await matonRead(BOOKING_SPREADSHEET_ID, range);
      setBookingCache(rows);
    }

    // Parse raw arrays into objects, skip header row
    const headers = ['bookingId', 'date', 'timeFrom', 'timeTo', 'eventType', 'guests', 'location', 'remark', 'name', 'phone', 'status'];
    const bookings = bookingCache.filter(function(r) { return r[1] && r[1] !== 'Date'; }).map(function(r) {
      var obj = {};
      headers.forEach(function(h, i) { obj[h] = (r[i] || '').toString().trim(); });
      return obj;
    });

    json(res, 200, {
      ok: true,
      bookings: bookings,
      count: bookings.length,
    });
  } catch (err) {
    console.error('GET /api/bookings error:', err);
    jsonError(res, 500, err.message);
  }
}

/** POST /api/bookings/save */
async function handleSaveBooking(req, res) {
  try {
    const body = await parseBody(req);
    const { date, time, eventType, guests, location, remark, name, phone } = body;

    if (!date || !time || !eventType || guests === undefined || !location) {
      return jsonError(res, 400, 'Missing required fields: date, time, eventType, guests, location');
    }

    const args = [
      TOOL_PATH, 'book',
      '--date', String(date),
      '--time', String(time),
      '--eventType', String(eventType),
      '--guests', String(guests),
      '--location', String(location),
    ];
    if (remark) args.push('--remark', String(remark));
    if (name) args.push('--name', String(name));
    if (phone) args.push('--phone', String(phone));

    const result = await execCommand('node', args, { timeout: SAVE_COMMAND_TIMEOUT });

    if (result.code !== 0) {
      console.error('Save booking stderr:', result.stderr);
      return jsonError(res, 500, result.stderr.trim() || 'Booking save failed');
    }

    // Parse the output — the tool should print JSON on stdout
    let parsed;
    try {
      parsed = JSON.parse(result.stdout.trim());
    } catch {
      parsed = { ok: true, output: result.stdout.trim() };
    }

    // Invalidate cache after successful save
    invalidateBookingCache();

    json(res, 200, parsed);
  } catch (err) {
    console.error('POST /api/bookings/save error:', err);
    jsonError(res, 500, err.message);
  }
}

/** GET /api/chat/customers */
async function handleGetChatCustomers(req, res) {
  try {
    const rows = await matonRead(CHAT_SPREADSHEET_ID, "'_index'!A:Z");
    // Skip header row; parse into objects
    const customers = rows.filter(r => r[0] && r[0].trim() && r[0] !== 'User ID/Name' && r[1]).map(row => ({
      name: (row[0] || '').trim(),
      tab: (row[1] || '').trim(),
      platform: row[2] || 'WhatsApp',
      firstContact: row[3] || '',
      lastMessage: row[4] || '',
      phone: row[5] || '',
    }));
    json(res, 200, { ok: true, customers, count: customers.length });
  } catch (err) {
    console.error('GET /api/chat/customers error:', err);
    jsonError(res, 500, err.message);
  }
}

/** GET /api/chat/history */
async function handleGetChatHistory(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const tab = url.searchParams.get('tab');
    const limit = parseInt(url.searchParams.get('limit') || '50', 10);

    if (!tab) {
      return jsonError(res, 400, 'Missing query parameter: tab');
    }

    const range = `'${tab}'!A:J`;
    const rows = await matonRead(CHAT_SPREADSHEET_ID, range);

    // Parse into objects (skip header)
    const history = rows.filter(r => r[0] && r[0].trim() && r[0] !== 'Timestamp').slice(-limit).map(row => ({
      timestamp: row[0] || '',
      date: row[1] || '',
      user: row[2] || '',
      message: row[3] || '',
      reply: row[4] || '',
      platform: row[5] || '',
      sessionId: row[6] || '',
      intent: row[7] || '',
      booking: row[8] || '',
      notes: row[9] || '',
    }));

    json(res, 200, { ok: true, history, count: history.length });
  } catch (err) {
    console.error('GET /api/chat/history error:', err);
    jsonError(res, 500, err.message);
  }
}

/** POST /api/chat/send — Send WhatsApp message and log to conversation log */
async function handleSendMessage(req, res) {
  try {
    const body = await parseBody(req);
    const { phone, message, customerName, intent } = body;

    if (!phone || !message) {
      return jsonError(res, 400, 'Missing required fields: phone, message');
    }

    // 1. Send the WhatsApp message via openclaw
    const escapedMsg = message.replace(/"/g, '\\"');
    const sendResult = await execCommand('openclaw', [
      'message', 'send',
      '--channel', 'whatsapp',
      '--account', 'codligence',
      '--target', String(phone),
      '--message', escapedMsg,
      '--json',
    ], { timeout: SEND_MESSAGE_TIMEOUT });

    if (sendResult.code !== 0) {
      console.error('Send message stderr:', sendResult.stderr);
      return jsonError(res, 500, sendResult.stderr.trim() || 'Failed to send message');
    }

    // 2. Log to conversation log spreadsheet
    if (customerName) {
      const convLogArgs = [
        path.join(import.meta.dirname, '..', 'tools', 'conversation-log.mjs'),
        'log',
        '--user', String(customerName),
        '--message', message,
        '--reply', '(Sent via dashboard)',
        '--platform', 'WhatsApp',
        '--intent', intent || 'other',
      ];

      // Fire and forget — don't block response on logging
      execCommand('node', convLogArgs, { timeout: 15000 }).catch((err) => {
        console.error('Conversation log error:', err.message);
      });
    }

    // Parse the result
    let parsed;
    try {
      parsed = JSON.parse(sendResult.stdout.trim());
    } catch {
      // Some versions of openclaw message send may not output JSON directly
      parsed = { ok: true, output: sendResult.stdout.trim() };
    }

    json(res, 200, parsed);
  } catch (err) {
    console.error('POST /api/chat/send error:', err);
    jsonError(res, 500, err.message);
  }
}

/** GET /api/tags */
async function handleGetTags(req, res) {
  try {
    const rows = await matonRead(CHAT_SPREADSHEET_ID, "'_tags'!A:C");
    // Skip header row; parse into objects
    const tags = rows.filter(r => r[0] && r[0].trim() && r[0] !== 'CustomerId').map(row => ({
      customerId: row[0] || '',
      customerName: row[1] || '',
      tags: row[2] ? row[2].split(',').map(t => t.trim()).filter(Boolean) : [],
    }));
    json(res, 200, { ok: true, tags, count: tags.length });
  } catch (err) {
    console.error('GET /api/tags error:', err);
    jsonError(res, 500, err.message);
  }
}

/** POST /api/tags — Save tags */
async function handleSaveTags(req, res) {
  try {
    const body = await parseBody(req);
    const { tagEntries } = body;

    if (!Array.isArray(tagEntries)) {
      return jsonError(res, 400, 'Missing array field: tagEntries');
    }

    // Build rows: header + data + padding to 100 total rows
    const header = ['CustomerId', 'CustomerName', 'Tags'];
    const dataRows = tagEntries.map((entry) => [
      String(entry.customerId || entry.CustomerId || ''),
      String(entry.customerName || entry.CustomerName || ''),
      String(entry.tags || entry.Tags || ''),
    ]);

    // Pad with empty rows up to 100 total rows
    const totalRows = Math.max(100, dataRows.length + 1);
    const emptyRows = totalRows - dataRows.length - 1;
    const paddedEmpty = Array.from({ length: emptyRows }, () => ['', '', '']);
    const values = [header, ...dataRows, ...paddedEmpty];

    const range = `'_tags'!A1:C${totalRows}`;

    // Write header + data + padding to overwrite all old data
    const result = await matonWrite(CHAT_SPREADSHEET_ID, range, values);

    json(res, 200, { ok: true, rowsWritten: dataRows.length, totalRows, matonResult: result });
  } catch (err) {
    console.error('POST /api/tags error:', err);
    jsonError(res, 500, err.message);
  }
}

// ============================================================
// Static file server
// ============================================================
function serveStatic(req, res) {
  // Default to index.html for root
  let reqPath = req.url === '/' ? '/index.html' : req.url;

  // Strip query string
  const qIndex = reqPath.indexOf('?');
  if (qIndex !== -1) reqPath = reqPath.slice(0, qIndex);

  const filePath = path.join(import.meta.dirname, reqPath);

  // Security: prevent directory traversal
  if (!filePath.startsWith(import.meta.dirname)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404);
        res.end('Not Found');
      } else {
        res.writeHead(500);
        res.end('Internal Server Error');
      }
      return;
    }

    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': data.length,
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
}

// ============================================================
// CORS middleware
// ============================================================
function addCORS(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');
}

// ============================================================
// Router
// ============================================================
async function handleRequest(req, res) {
  addCORS(res);

  // Handle preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  try {
    // API routes
    if (req.method === 'GET' && pathname === '/api/bookings') {
      return await handleGetBookings(req, res);
    }

    if (req.method === 'POST' && pathname === '/api/bookings/save') {
      return await handleSaveBooking(req, res);
    }

    if (req.method === 'GET' && pathname === '/api/chat/customers') {
      return await handleGetChatCustomers(req, res);
    }

    if (req.method === 'GET' && pathname === '/api/chat/history') {
      return await handleGetChatHistory(req, res);
    }

    if (req.method === 'POST' && pathname === '/api/chat/send') {
      return await handleSendMessage(req, res);
    }

    if (req.method === 'GET' && pathname === '/api/tags') {
      return await handleGetTags(req, res);
    }

    if (req.method === 'POST' && pathname === '/api/tags') {
      return await handleSaveTags(req, res);
    }

    // Fallback: serve static file
    serveStatic(req, res);
  } catch (err) {
    console.error('Unhandled request error:', err);
    if (!res.headersSent) {
      jsonError(res, 500, 'Internal server error');
    }
  }
}

// ============================================================
// Start server
// ============================================================
const server = http.createServer(handleRequest);

server.listen(PORT, '0.0.0.0', () => {
  const localIP = getLocalIP();
  console.log(`\n🚀 EventFlow Dashboard Server`);
  console.log(`   Local:    http://localhost:${PORT}`);
  console.log(`   Network:  http://${localIP}:${PORT}`);
  console.log(`   Binding:  0.0.0.0:${PORT}\n`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down server...');
  server.close(() => process.exit(0));
});

process.on('SIGTERM', () => {
  console.log('\nShutting down server...');
  server.close(() => process.exit(0));
});

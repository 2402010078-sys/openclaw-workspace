#!/usr/bin/env node
/**
 * Google Sheets Booking Manager v2
 *
 * New sheet structure (booking log — one row = one booking):
 *   Tab: All Bookings
 *   | Booking ID | Date | Time From | Time To | Event Type | Guests | Location | Theme/Remark | Customer Name | Phone | Status | Created At |
 *
 * Usage:
 *   check --date DD/MM/YYYY            → Show available time slots
 *   book --date DD/MM/YYYY --time H:00-H:00 --eventType "" --guests N --location ""
 *        [--remark ""] [--name ""] [--phone ""] [--status "confirmed|cancelled"]
 *   list [--date DD/MM/YYYY]           → List all bookings
 *   migrate-status                     → Preview migration from old month tabs
 *   migrate                            → Run migration (preserves old tabs as backup)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SPREADSHEET_ID = '1tD561HQOx3zDL4PtK_EhCXEkQFc4EhY_rqrIlBckbko';
const DEFAULT_CONNECTION_ID = 'ed42aabd-396c-4a07-b801-88811529fbf8';
const API_BASE = 'https://gateway.maton.ai/google-sheets/v4/spreadsheets';

const BOOKINGS_TAB = 'All Bookings';
const HEADER = ['Booking ID', 'Date', 'Time From', 'Time To', 'Event Type', 'Guests', 'Location', 'Theme/Remark', 'Customer Name', 'Phone', 'Status', 'Created At'];

const DEFAULT_OPEN = 8;
const DEFAULT_CLOSE = 21;

// ══════════════════════════════════════════════════════════════════════════════
// Helpers
// ══════════════════════════════════════════════════════════════════════════════

function loadMatonApiKey() {
  if (process.env.MATON_API_KEY) return process.env.MATON_API_KEY;
  const zshrc = path.join(os.homedir(), '.zshrc');
  if (fs.existsSync(zshrc)) {
    const text = fs.readFileSync(zshrc, 'utf8');
    const m = text.match(/export\s+MATON_API_KEY=["']([^"']+)["']/);
    if (m) return m[1];
  }
  throw new Error('MATON_API_KEY not found in environment or ~/.zshrc');
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const args = {};
  for (let i = 0; i < rest.length; i++) {
    const part = rest[i];
    if (part.startsWith('--')) {
      const key = part.slice(2);
      const next = rest[i + 1];
      if (!next || next.startsWith('--')) {
        args[key] = true;
      } else {
        args[key] = next;
        i++;
      }
    }
  }
  return { command, args };
}

function normalizeDate(input) {
  const s = String(input || '').trim();
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) throw new Error('Date must be DD/MM/YYYY');
  return `${Number(m[1])}/${Number(m[2])}/${m[3]}`;
}

function timeToHour(t) {
  const m = String(t).trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) throw new Error(`Invalid time: ${t}`);
  return Number(m[1]) + Number(m[2]) / 60;
}

function formatHour(h) {
  const whole = Math.floor(h);
  const min = Math.round((h - whole) * 60);
  return `${whole}:${String(min).padStart(2, '0')}`;
}
function nowISO() { return new Date().toISOString().replace('T', ' ').slice(0, 19); }

function nextBookingId(rows) {
  let max = 0;
  for (const r of rows) {
    const m = String(r[0] || '').match(/^B(\d+)$/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `B${String(max + 1).padStart(3, '0')}`;
}

// ══════════════════════════════════════════════════════════════════════════════
// API
// ══════════════════════════════════════════════════════════════════════════════

async function apiFetch(url, { method = 'GET', body } = {}) {
  const headers = {
    Authorization: `Bearer ${loadMatonApiKey()}`,
    'Maton-Connection': process.env.MATON_CONNECTION_ID || DEFAULT_CONNECTION_ID,
  };
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : {};
}

async function getRange(range) {
  return apiFetch(`${API_BASE}/${SPREADSHEET_ID}/values/${encodeURIComponent(range)}`);
}

async function updateRange(range, values) {
  return apiFetch(`${API_BASE}/${SPREADSHEET_ID}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`, {
    method: 'PUT',
    body: { values },
  });
}

async function appendRows(tab, values) {
  return apiFetch(`${API_BASE}/${SPREADSHEET_ID}/values/${encodeURIComponent(tab)}!A:A:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, {
    method: 'POST',
    body: { values },
  });
}

async function batchUpdate(data) {
  return apiFetch(`${API_BASE}/${SPREADSHEET_ID}/values:batchUpdate`, {
    method: 'POST',
    body: { valueInputOption: 'USER_ENTERED', data },
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// Core booking logic
// ══════════════════════════════════════════════════════════════════════════════

async function getAllBookings() {
  const result = await getRange(`${BOOKINGS_TAB}!A:L`);
  const values = result.values || [];
  if (values.length < 2) return [];
  return values.slice(1).filter(r => r[1] && r[1].trim()).map(row => ({
    bookingId: row[0] || '',
    date: row[1] || '',
    timeFrom: row[2] || '',
    timeTo: row[3] || '',
    eventType: row[4] || '',
    guests: row[5] || '',
    location: row[6] || '',
    remark: row[7] || '',
    name: row[8] || '',
    phone: row[9] || '',
    status: row[10] || '',
    createdAt: row[11] || '',
  }));
}

function generateTimeSlots(open = DEFAULT_OPEN, close = DEFAULT_CLOSE, intervalMin = 30) {
  const slots = [];
  const start = typeof open === 'number' ? open : timeToHour(open);
  const end = typeof close === 'number' ? close : timeToHour(close);
  for (let t = start; t <= end; t += intervalMin / 60) {
    slots.push(formatHour(t));
  }
  return slots;
}

async function checkAvailability(date) {
  const bookings = await getAllBookings();
  const dayBookings = bookings.filter(b => b.date === date && b.status !== 'cancelled');
  const allSlots = generateTimeSlots();

  return allSlots.filter(slot => {
    const h = timeToHour(slot);
    return !dayBookings.some(b => {
      const f = timeToHour(b.timeFrom);
      const t = timeToHour(b.timeTo);
      return h >= f && h <= t;
    });
  });
}

async function isRangeAvailable(date, from, to) {
  const available = await checkAvailability(date);
  const fh = timeToHour(from);
  const th = timeToHour(to);
  for (let h = fh; h <= th; h++) {
    if (!available.includes(formatHour(h))) return false;
  }
  return true;
}

// ══════════════════════════════════════════════════════════════════════════════
// Old-format parser (month-tab rows → bookings)
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Old format rows have structure:
 *   Row 1: header [Date, Time, Slot Available, Event Type, Guests, Location, Remark]
 *   Then blocks: date row (Date filled), then time rows (Date empty) group has 14:00-21:00
 *
 * not-available rows either have booking detail (cols 3-6) or are just blocked-out
 * continuation rows of the same booking.
 *
 * Strategy: walk rows, for each date block find consecutive not-available sections.
 * Each section that has at least one detail row = one booking.
 * Time range = first not-available time in section → last not-available time in section.
 */
function parseOldRows(values) {
  const bookings = [];
  let currentDate = null;

  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    if (!row || row.length < 3) continue;

    const date = (row[0] || '').trim();
    if (date && date !== 'Date') currentDate = date;
    if (!currentDate) continue;

    const status = (row[2] || '').trim().toLowerCase();
    if (status !== 'not available') continue;

    const time = row[1] || '';
    const hasDetail = row.length > 3 && (row[3] || '').trim().length > 0;
    const detail = hasDetail ? {
      eventType: row[3] || '',
      guests: row[4] || '',
      location: row[5] || '',
      remark: row[6] || '',
    } : null;

    const last = bookings[bookings.length - 1];
    const sameBooking = last && last.date === currentDate && !last._closed;

    if (detail && sameBooking) {
      // A new detail row appeared — check if it matches the ongoing booking
      // (old format may repeat the same info across rows, OR may be a new booking)
      // If eventType changed, it's a new booking; otherwise extend
      if (detail.eventType && detail.eventType !== last.eventType) {
        // Different event type = new booking. Close the old one.
        last._closed = true;
        bookings.push({
          date: currentDate,
          timeFrom: time,
          timeTo: time,
          eventType: detail.eventType,
          guests: detail.guests,
          location: detail.location,
          remark: detail.remark,
          _closed: false,
        });
      } else {
        // Same event type — extend
        last.timeTo = time;
        if (detail.guests) last.guests = detail.guests;
        if (detail.location) last.location = detail.location;
        if (detail.remark) last.remark = detail.remark;
      }
    } else if (sameBooking && !detail) {
      // No-detail extension row
      last.timeTo = time;
    } else {
      // Start new booking
      bookings.push({
        date: currentDate,
        timeFrom: time,
        timeTo: time,
        eventType: detail ? detail.eventType : '',
        guests: detail ? detail.guests : '',
        location: detail ? detail.location : '',
        remark: detail ? detail.remark : '',
        _closed: false,
      });
    }
  }

  return bookings.map(b => {
    const { _closed, ...rest } = b;
    return rest;
  });
}

/** Show what the migration would produce */
async function runMigrateStatus() {
  const oldTabs = ['April', 'May', 'June', 'July'];
  const all = [];

  for (const tab of oldTabs) {
    try {
      const result = await getRange(`${tab}!A:G`);
      const values = result.values || [];
      if (values.length < 2) continue;
      const parsed = parseOldRows(values);
      for (const b of parsed) all.push({ ...b, tab });
    } catch { /* tab may not exist */ }
  }

  console.log(JSON.stringify({ ok: true, total: all.length, bookings: all }, null, 2));
}

/** Run the actual migration */
async function runMigrate() {
  const oldTabs = ['April', 'May', 'June', 'July'];
  const all = [];

  for (const tab of oldTabs) {
    try {
      const result = await getRange(`${tab}!A:G`);
      const values = result.values || [];
      if (values.length < 2) continue;
      const parsed = parseOldRows(values);
      for (const b of parsed) all.push(b);
    } catch { /* skip */ }
  }

  // Ensure header exists
  const existing = await getRange(`${BOOKINGS_TAB}!A:L`);
  const existingRows = existing.values || [];
  if (existingRows.length === 0 || existingRows[0][0] !== 'Booking ID') {
    await updateRange(`${BOOKINGS_TAB}!A1:L1`, [HEADER]);
  }

  // Write bookings
  const rows = all.map((b, i) => [
    `B${String(i + 1).padStart(3, '0')}`,
    b.date,
    b.timeFrom,
    b.timeTo,
    b.eventType,
    b.guests,
    b.location,
    b.remark,
    '',
    '',
    'confirmed',
    nowISO(),
  ]);

  if (rows.length > 0) await appendRows(BOOKINGS_TAB, rows);

  console.log(JSON.stringify({
    ok: true,
    migrated: rows.length,
    bookings: rows,
    message: `Migrated ${rows.length} bookings to ${BOOKINGS_TAB} tab. Old month tabs preserved as backup.`,
  }, null, 2));
}

// ══════════════════════════════════════════════════════════════════════════════
// Commands
// ══════════════════════════════════════════════════════════════════════════════

async function runCheck(args) {
  const date = normalizeDate(args.date);
  const available = await checkAvailability(date);
  console.log(JSON.stringify({ ok: true, date, availableSlots: available }, null, 2));
}

async function runBook(args) {
  const date = normalizeDate(args.date);
  const timeRange = String(args.time || '').trim();
  const eventType = String(args.eventType || '').trim();
  const guests = String(args.guests || '').trim();
  const location = String(args.location || '').trim();
  const remark = String(args.remark || '').trim();
  const name = String(args.name || '').trim();
  const phone = String(args.phone || '').trim();
  const status = String(args.status || 'confirmed').trim();
  const editId = String(args.id || '').trim();  // B00X for editing existing

  if (!timeRange || !eventType || !guests || !location) {
    throw new Error('Missing required: --time --eventType --guests --location');
  }
  if (!timeRange.includes('-')) {
    throw new Error('--time must be a range like 18:00-20:00');
  }

  const [timeFrom, timeTo] = timeRange.split('-').map(s => s.trim());

  const existing = await getRange(`${BOOKINGS_TAB}!A:L`);
  const rows = existing.values || [];

  // 編輯模式：找到 bookingId 對應的行並更新
  if (editId) {
    const rowIndex = rows.findIndex(r => String(r[0] || '').trim() === editId);
    if (rowIndex === -1) {
      throw new Error(`Booking ${editId} not found.`);
    }
    // rowIndex 是 0-based，Google Sheets 是 1-based，加標題行偏移
    const sheetRow = rowIndex + 1; // 已包含 header row
    if (sheetRow < 2) {
      throw new Error(`Cannot update header row for ${editId}.`);
    }
    const range = `${BOOKINGS_TAB}!A${sheetRow}:L${sheetRow}`;
    const updatedRow = [editId, date, timeFrom, timeTo, eventType, guests, location, remark, name, phone, status, rows[rowIndex][11] || nowISO()];
    const result = await updateRange(range, [updatedRow]);
    console.log(JSON.stringify({
      ok: true, bookingId: editId, date, timeFrom, timeTo, eventType, guests, location, remark, name, phone, status, updated: true, result,
    }, null, 2));
    return;
  }

  // 新增模式（僅新增時檢查 slot availability）
  if (!(await isRangeAvailable(date, timeFrom, timeTo))) {
    throw new Error('One or more time slots are not available.');
  }

  const bid = nextBookingId(rows);

  const newRow = [bid, date, timeFrom, timeTo, eventType, guests, location, remark, name, phone, status, nowISO()];
  const result = await appendRows(BOOKINGS_TAB, [newRow]);

  console.log(JSON.stringify({
    ok: true, bookingId: bid, date, timeFrom, timeTo, eventType, guests, location, remark, name, phone, status, result,
  }, null, 2));
}

async function runList(args) {
  const bookings = await getAllBookings();
  const filtered = args.date ? bookings.filter(b => b.date === normalizeDate(args.date)) : bookings;
  console.log(JSON.stringify({ ok: true, count: filtered.length, bookings: filtered }, null, 2));
}

// ══════════════════════════════════════════════════════════════════════════════
// Main
// ══════════════════════════════════════════════════════════════════════════════

async function main() {
  const { command, args } = parseArgs(process.argv.slice(2));

  switch (command) {
    case 'check': return runCheck(args);
    case 'book': return runBook(args);
    case 'list': return runList(args);
    case 'migrate-status': return runMigrateStatus();
    case 'migrate': return runMigrate();
    default:
      console.error(`Usage:
  node tools/google-sheets-booking.mjs check --date DD/MM/YYYY
  node tools/google-sheets-booking.mjs book --date DD/MM/YYYY --time H:00-H:00 --eventType "..." --guests N --location "..." [--remark "..."] [--name "..."] [--phone "..."]
  node tools/google-sheets-booking.mjs list [--date DD/MM/YYYY]
  node tools/google-sheets-booking.mjs migrate-status
  node tools/google-sheets-booking.mjs migrate`);
      process.exit(1);
  }
}

main().catch(err => {
  console.error(JSON.stringify({ ok: false, error: err.message }, null, 2));
  process.exit(1);
});

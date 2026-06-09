# TOOLS.md - Local Notes

Skills define _how_ tools work. This file is for _your_ specifics — the stuff that's unique to your setup.

## What Goes Here

Things like:

- Camera names and locations
- SSH hosts and aliases
- Preferred voices for TTS
- Speaker/room names
- Device nicknames
- Anything environment-specific

## Examples

```markdown
### Cameras

- living-room → Main area, 180° wide angle
- front-door → Entrance, motion-triggered

### SSH

- home-server → 192.168.1.100, user: admin

### TTS

- Preferred voice: "Nova" (warm, slightly British)
- Default speaker: Kitchen HomePod
```

## Why Separate?

Skills are shared. Your setup is yours. Keeping them apart means you can update skills without losing your notes, and share skills without leaking your infrastructure.

---

### Google Sheets Booking (v2 — Booking Log Format)

- Booking spreadsheet ID: `1tD561HQOx3zDL4PtK_EhCXEkQFc4EhY_rqrIlBckbko`
- **Main tab: `All Bookings`** — booking log format (one row = one booking)
- Core columns: `Booking ID | Date | Time From | Time To | Event Type | Guests | Location | Theme/Remark | Customer Name | Phone | Status | Created At`
- Old month tabs (April ~ July) preserved as backup, **no longer used for live operations**
- Live read and write access via Maton is working.

### Booking operation notes

- Slot availability must come from Google Sheets only (All Bookings tab).
- Read/check helper: `node /Users/macmini/.openclaw/workspace/tools/google-sheets-booking.mjs check --date DD/MM/YYYY`
- Write helper: `node /Users/macmini/.openclaw/workspace/tools/google-sheets-booking.mjs book --date DD/MM/YYYY --time H:00-H:00 --eventType "..." --guests N --location "..." [--remark "..."] [--name "..."] [--phone "..."]`
- List helper: `node /Users/macmini/.openclaw/workspace/tools/google-sheets-booking.mjs list [--date DD/MM/YYYY]`
- The helper uses the `All Bookings` tab and Maton Google Sheets connection.
- If a customer selects a time range, the range is inclusive.
- Example: `8:00-10:00` means `8:00`, `9:00`, and `10:00` are all booked.
- Accept a range only when every slot in that range is available.
- Before saving any booking, re-check the selected slot or full range again.
- `--time` must be a range (e.g. `18:00-20:00`), not a single slot.
- Optional args: `--name "Customer Name" --phone "0123456789"`

### Bot memory split

- Put behavior, reply rules, and conversation flow in `AGENTS.md`.
- Put spreadsheet IDs, tabs, columns, and other environment-specific details here in `TOOLS.md`.
- Put temporary incidents or one-off booking notes in `memory/YYYY-MM-DD.md` if needed.

Add whatever helps you do your job. This is your cheat sheet.

---

### ChatBot Conversation Logs

- Spreadsheet ID: `1QoPoK8AKVMDJyEpcOxAXi4AtCXJIq5Ue9WB_xYVqW7k`
- **Each customer gets their own tab** (auto-created by the script)
- `_index` tab: master list of all customers
- Columns: `Timestamp | Date | User | User Message | Bot Reply | Platform | Session ID | Intent/Flow | Booking Info | Notes`
- Logging helper: `node /Users/macmini/.openclaw/workspace/tools/conversation-log.mjs log --user "Name" --message "..." --reply "..." --platform "WhatsApp" [--intent "..."] [--booking "B00X"] [--note "..."]`
- AGENTS.md has the full logging rule and intent list.

### SQLite Bookings sync

- New `bookings` table in dashboard-laravel/database/database.sqlite
- Sync helper: `node /Users/macmini/.openclaw/workspace/tools/conversation-log.mjs sync-booking --date "DD/MM/YYYY" --time "HH:00-HH:00" --eventType "..." --guests N --location "..." [--remark "..."] [--customerName "..."] [--phone "..."] [--bookingId "B00X"] [--status "..."]`
- Delete helper: `node /Users/macmini/.openclaw/workspace/tools/conversation-log.mjs delete-booking --bookingId "B00X"`
- API endpoint (localhost:4567): `GET /api/bookings-sqlite` — list bookings from SQLite
- Requires Laravel dev server running on port 4567

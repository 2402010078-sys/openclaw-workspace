# Firebase chat history sync

This sync pushes OpenClaw WhatsApp session history into Firebase Firestore.

## What it saves

- one Firestore document per WhatsApp chat in `whatsappChats/{chatId}`
- one `messages` subcollection under each chat
- inbound user messages and outbound delivered assistant replies

## Setup

1. Install dependencies:
   `npm install`
2. Set Firebase credentials with either:
   - `GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json`, or
   - `FIREBASE_SERVICE_ACCOUNT_JSON='{"type":"service_account",...}'`
3. Optional env vars:
   - `FIREBASE_PROJECT_ID=your-project-id`
   - `FIREBASE_COLLECTION=whatsappChats`
   - `OPENCLAW_SESSION_STORE=/Users/macmini/.openclaw/agents/main/sessions/sessions.json`

## Run

```bash
npm run sync:firebase
```

## Notes

- The sync is idempotent. Re-running updates the same Firestore docs.
- It reads existing OpenClaw session files, so it can backfill old chats too.
- If you want, I can also wire this to run automatically on a cron schedule.

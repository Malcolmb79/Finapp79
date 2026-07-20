# Personal Finance

A local expense tracker. Bank transactions sync automatically via Enable
Banking (open banking, pan-EU/UK); you can also add transactions manually or
import a CSV for banks that aren't supported.

## Stack

- `server/` — Express 5 + TypeScript API, SQLite storage (via Node's
  built-in `node:sqlite`)
- `client/` — React + TypeScript, built with Vite

## Getting started

1. Copy `.env.example` to `.env` and follow the comments in it to register
   an Enable Banking application (self-serve signup at
   https://enablebanking.com/sign-in/, free sandbox with a mock bank for
   testing — no real bank account needed).
2. `npm install`
3. `npm run dev` — runs the API on port 3001 and the client on port 5173.

Without Enable Banking credentials configured, manual entry and CSV import
still work; only the "Link a bank" flow needs them.

See [CLAUDE.md](./CLAUDE.md) for architecture notes and common commands.

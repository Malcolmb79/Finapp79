# Personal Finance

A local expense tracker. Bank transactions sync automatically via GoCardless
Bank Account Data (open banking); you can also add transactions manually or
import a CSV for banks that aren't supported.

## Stack

- `server/` — Express + TypeScript API, SQLite storage (via `better-sqlite3`)
- `client/` — React + TypeScript, built with Vite

## Getting started

1. Copy `.env.example` to `.env` and fill in your GoCardless credentials
   (free sandbox account at https://bankaccountdata.gocardless.com/).
2. `npm install`
3. `npm run dev` — runs the API on port 3001 and the client on port 5173.

See [CLAUDE.md](./CLAUDE.md) for architecture notes and common commands.

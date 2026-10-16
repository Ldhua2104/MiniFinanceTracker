# Mini Finance Tracker

A personal finance tracker monorepo with a React/Vite frontend and an Express/Mongoose API. The first implementation milestone establishes the runnable application shell and the persistent data model described in `doc/Personal_Finance_MongoDB_Design.docx`.

## Requirements

- Node.js 22 or another supported Node.js LTS release
- MongoDB replica set for transaction support (Atlas or a local replica set)

## Quick start

1. Copy `.env.example` to `.env` and set `MONGODB_URI`.
2. Install workspace dependencies with `npm install`.
3. Initialize MongoDB collection validators and indexes with `npm run db:indexes`.
4. Start the frontend and API with `npm run dev`.
5. Open the Vite URL printed in the terminal. The API listens on port 3000 by default.

To seed the administrator and starter categories, set `ADMIN_EMAIL` and `ADMIN_PASSWORD` in `.env`, then run `npm run db:seed`.

The frontend dev server proxies `/api` to Express. `GET /api/v1/health` reports process health; `GET /api/v1/ready` returns `503` until MongoDB is connected.

## Workspace layout

- `frontend/`: React application, Vite configuration, API client and UI styles.
- `backend/src/models/`: Mongoose schemas for users, categories, transactions, budgets, notifications, email jobs, AI analyses and email verification records.
- `backend/src/domain/`: currency and status enums, request schemas and precise decimal helpers.
- `backend/src/db/`: connection, collection validator/index initialization and seed scripts.
- `doc/`: source architecture and API design.

## Configuration

All secrets belong in the backend `.env`; do not add secrets to frontend `VITE_` variables. The example environment file contains placeholders only. Production disables automatic index creation; run the versioned database initialization command during deployment.

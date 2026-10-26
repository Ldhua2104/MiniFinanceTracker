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

## Anonymous and signed-in workspaces

The app opens directly into an anonymous workspace. Anonymous transactions and categories are kept in browser local storage; anonymous sessions cannot access private API resources. From Profile, a visitor can register with an email and password or sign in. Registration always creates a `user`; the client cannot assign the `admin` role. Sessions use an HttpOnly JWT cookie with CSRF protection.

After sign-in, local transactions can be merged into the account workspace or the account workspace can be used as-is. Signed-in workspace changes are sent to the authenticated `/api/v1/auth/workspace` endpoint and stored per user in MongoDB. The workspace API is an initial local-first persistence bridge; the normalized transaction, budget and category collections remain the target for full domain CRUD.

The UI supports English and Chinese, initially selected from the browser language, and includes light and dark appearance modes.

## Workspace layout

- `frontend/`: React application, Vite configuration, API client and UI styles.
- `backend/src/models/`: Mongoose schemas for users, categories, transactions, budgets, notifications, email jobs, AI analyses and email verification records.
- `backend/src/domain/`: currency and status enums, request schemas and precise decimal helpers.
- `backend/src/db/`: connection, collection validator/index initialization and seed scripts.
- `doc/`: source architecture and API design.

## Configuration

All secrets belong in the backend `.env`; do not add secrets to frontend `VITE_` variables. The example environment file contains placeholders only. Production disables automatic index creation; run the versioned database initialization command during deployment.

To store user-supplied AI API keys, configure `AI_CREDENTIALS_ENCRYPTION_KEY` as a base64-encoded 32-byte random key. For example, generate one with `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"` and keep it in the backend secret manager or `.env`. Do not commit it. Keep a protected backup and retain the same key across deployments: existing AI credentials cannot be decrypted if this key is lost or replaced. The backend encrypts each saved settings payload with AES-256-GCM and a fresh random nonce. Anonymous browser settings use Web Crypto AES-GCM; the non-extractable key is stored by IndexedDB while the encrypted payload is stored in `localStorage`. Successful sign-in migrates the configuration to the account and then removes the local encrypted payload and key.

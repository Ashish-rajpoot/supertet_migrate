# SuperTET Prep

A bilingual (Hindi + English) practice app for SuperTET / TET style exams, built with **Next.js 16 (App Router) + MongoDB**. Works offline via `localStorage` and a service worker, with an optional backend for syncing results and a shared question bank.

## Features

- **Flashcards** - tap to flip, rate "Knew it" / "Review again" (Leitner boxes)
- **Test mode** - pick subjects/topics, question count and timer; flag questions, auto-submit
- **Practice mode** - instant answer and explanation
- **Result page** - score, percentage, subject breakdown, weak topics, full review, shareable
- **Improve page** - pick a subject and revise the questions you got wrong most (lifetime wrong count per question); practise them as a drill or as flashcards
- **Progress dashboard** - score trend, subject/topic accuracy, day streak, most-wrong questions; scopes: this device, my cloud results, all students (admin)
- **Add questions in bulk** - upload `.xlsx`, `.csv` or `.json` (synced to MongoDB when signed in)
- **Subjects and topics** - admin-only syllabus editor
- **Accounts** - register/login with User ID, email, phone + OTP, password, or Google
- **Works offline** - PWA installable; results are saved locally and flushed to MongoDB on reconnect

## Quick start

```bash
npm install
cp .env.example .env.local   # then set MONGODB_URI and JWT_SECRET
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

On first start the app creates a default admin account (`ADMIN_EMAIL` / `ADMIN_PASSWORD`, default `admin@gmail.com` / `admin@123`) - **change this before deploying**.

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the dev server |
| `npm run build` | Production build |
| `npm start` | Run the production build |
| `npm run lint` | ESLint |

## Project layout

```
app/                 Routes (pages) and API route handlers under app/api
  api/               /status /auth /questions /attempts /subjects /analytics
components/          App shell, dialogs, charts + components/ui (shadcn)
lib/
  client/            Browser-only: localStorage store, sync layer, auth client
  data/              Question normalisation, import/parse, analytics
  server/            Mongoose models, db connection, auth helpers
public/              Static assets: seed data (/data), icons, Excel template
```

## Environment variables

See `.env.example`. `MONGODB_URI` and `JWT_SECRET` are required in production; the app degrades to local-only mode when the database is unreachable.

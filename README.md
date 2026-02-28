# Study Focus

A web app that helps you study by keeping you focused. Set a time or chapter goal, read in-app, and get AI-powered notes and quizzes when you finish.

## Setup

```bash
npm install
cp .env.example .env.local
# Edit .env.local: set NEXTAUTH_SECRET (e.g. openssl rand -base64 32)
npm run db:push
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Sign in (Phase 1)

Use the Credentials provider: any email + password `dev` (e.g. `you@example.com` / `dev`).

## Features (Phases 1 + 2)

- **Goal setup**: choose "time" (minutes) or "chapter" (number) goal
- **Timer**: countdown for time goals, count-up for chapter goals
- **Visibility guard**: detects tab switches, pauses timer, shows overlay
- **Fullscreen mode**: toggle fullscreen for distraction-free reading
- **Override flow**: "I need to stop" button with confirmation bar
- **Session persistence**: progress saved to SQLite via API
- **History**: view past study sessions

## Tech stack

- Next.js 14 (App Router)
- TypeScript, Tailwind CSS 3
- NextAuth v4 (Credentials + JWT)
- Drizzle ORM + @libsql/client (SQLite)

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server |
| `npm run build` | Production build |
| `npm run start` | Run production server |
| `npm run db:push` | Push schema to database |
| `npm run db:generate` | Generate migrations |

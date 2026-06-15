# CodeWithMe

A real-time collaborative coding platform (a mini LeetCode + VS Code).

- **Phase 1 — single-player foundation:** auth, a Monaco editor, problem
  browsing, and saving code to Postgres.
- **Phase 2 — collaboration engine:** multiplayer rooms with Yjs + y-webrtc
  text sync (peer-to-peer) and a Socket.IO server for presence + live cursors.

## Tech stack

- **Next.js 16** (App Router, TypeScript) — note: Next 16 renames `middleware`
  to **`proxy`** and makes `cookies()` async.
- **Supabase** — Auth + Postgres (`@supabase/ssr` for cookie-based sessions).
- **Monaco Editor** (`@monaco-editor/react`) — Python, C++, JavaScript.
- **Tailwind CSS v4**.

## Phase 1 features

- Email/password sign-up & sign-in via Supabase Auth (Server Actions).
- Session refresh + route protection in `src/proxy.ts`.
- Problem list and problem detail pages (description + sample test cases).
- Monaco editor with per-language buffers and starter code.
- Save code to Postgres (`Ctrl/Cmd+S` or the Save button); one snapshot per
  `(user, problem, language)`.

## Getting started

### 1. Create a Supabase project

Go to [supabase.com](https://supabase.com), create a project, then copy the
**Project URL** and **anon public key** from *Project Settings → API*.

### 2. Configure environment variables

```bash
cp .env.local.example .env.local
# then edit .env.local with your Supabase URL and anon key
```

### 3. Set up the database

Open the Supabase **SQL Editor** and run the contents of
[`supabase/schema.sql`](supabase/schema.sql). This creates the `problems`,
`test_cases`, and `submissions` tables, enables Row Level Security, and seeds a
few starter problems.

> By default Supabase requires email confirmation. For fast local testing you
> can disable it under *Authentication → Sign In / Providers → Email →
> "Confirm email"*, or use the confirmation link (handled by
> `/auth/callback`).

### 4. Run the dev servers

Phase 2 adds a realtime Node process (Socket.IO + y-webrtc signaling) alongside
Next.js. Run both at once:

```bash
npm install
npm run dev:all      # Next.js (:3000) + realtime server (:3001 / :4444)
```

Or run them in separate terminals: `npm run dev` and `npm run server`.

Open [http://localhost:3000](http://localhost:3000). You'll be redirected to
`/login`; sign up, then you'll land on `/problems`.

### Try multiplayer

1. From `/problems`, click **New collaborative session** — you'll land on
   `/room/<id>`.
2. Click **Copy invite link** and open it in a second browser window (or a
   different signed-in account / incognito tab).
3. Type in either window: text syncs instantly (peer-to-peer over WebRTC), and
   you'll see the other person's caret, name tag, and selection.

## Project structure

```
server/
  index.ts                      # Socket.IO presence/cursors (:3001) entry
  signaling.ts                  # self-hosted y-webrtc signaling relay (:4444)
src/
  proxy.ts                      # Next 16 "middleware": session refresh + guards
  lib/
    supabase/{client,server,proxy}.ts   # Supabase clients per context
    auth.ts                     # requireUser() / getUser() DAL helpers
    types.ts                    # shared types, language list, starter code
    collab.ts                   # room user/cursor types + color helper
  components/
    CodeEditor.tsx              # Monaco wrapper (single-player)
    Workspace.tsx               # editor + language switch + save (client)
    CollaborativeEditor.tsx     # Yjs+y-webrtc text sync + Socket.IO cursors
    CreateRoomButton.tsx        # spins up a new /room/<id>
    Header.tsx                  # nav + sign out
  app/
    login/                      # auth page, form, server actions
    auth/callback/route.ts      # email-confirmation code exchange
    problems/                   # list + [slug] detail with editor
    room/[id]/                  # collaborative session page
supabase/schema.sql             # DB schema + seed data
```

## How the realtime layer fits together

- **Text** syncs peer-to-peer: `y-monaco` binds the Monaco model to a Yjs doc,
  which `y-webrtc` replicates between browsers. Conflict-free by construction
  (CRDT) — that's the "zero text-conflict" guarantee.
- **WebRTC signaling** (peer discovery only, no text) runs on our own server in
  `server/signaling.ts`, so we don't depend on flaky public signaling servers.
- **Presence & cursors** ride a separate Socket.IO channel (`server/index.ts`):
  each client broadcasts its caret/selection, and remote carets are rendered as
  Monaco content widgets + decorations.

## Milestone status

✅ **Phase 1** — log in, pick a problem, edit in Monaco, save to Postgres.
✅ **Phase 2** — multiplayer rooms: Google-Docs-style text sync with visible
remote cursors and no text conflicts.

## Next (Phase 3+)

Docker-sandboxed code execution, contests, code replay, and the AI features
(reviewer, hints, plagiarism detection) from the roadmap.

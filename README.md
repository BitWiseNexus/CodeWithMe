# CodeWithMe

A real-time collaborative coding platform (a mini LeetCode + VS Code).

- **Phase 1 — single-player foundation:** auth, a Monaco editor, problem
  browsing, and saving code to Postgres.
- **Phase 2 — collaboration engine:** multiplayer rooms with Yjs + y-webrtc
  text sync (peer-to-peer) and a Socket.IO server for presence + live cursors.
- **Phase 3 — execution sandbox:** click "Run" → job is queued in Redis → a
  worker executes the code in a locked-down Docker container → stdout/stderr
  stream back to the browser over Socket.IO. (Python & JS; C++ coming.)

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

### 2b. Add the service-role key (Phase 3)

The execution worker writes results back to the DB past Row Level Security, so
it needs the **service_role** key (Project Settings → API). Put it in
`.env.local` as `SUPABASE_SERVICE_ROLE_KEY` — this is a **server-only secret**,
never prefix it with `NEXT_PUBLIC`.

### 3. Set up the database

Open the Supabase **SQL Editor** and run the contents of
[`supabase/schema.sql`](supabase/schema.sql). This creates the `problems`,
`test_cases`, and `submissions` tables, enables Row Level Security, and seeds a
few starter problems.

> By default Supabase requires email confirmation. For fast local testing you
> can disable it under *Authentication → Sign In / Providers → Email →
> "Confirm email"*, or use the confirmation link (handled by
> `/auth/callback`).

### 4. Start Redis + sandbox images (Phase 3)

The execution worker needs a Redis broker and the language images. Docker
Desktop must be running.

```bash
# Redis broker
docker run -d --name codewithme-redis -p 6379:6379 redis:7-alpine

# Sandbox runtime images
docker pull python:3.12-alpine
docker pull node:20-alpine
```

### 5. Run the dev servers

Three processes: Next.js, the realtime server (Socket.IO + y-webrtc signaling),
and the execution worker. Run them all at once:

```bash
npm install
npm run dev:all      # next (:3000) + server (:3001/:4444) + worker
```

Or in separate terminals: `npm run dev`, `npm run server`, `npm run worker`.

Open [http://localhost:3000](http://localhost:3000). You'll be redirected to
`/login`; sign up, then you'll land on `/problems`.

### Try multiplayer

1. From `/problems`, click **New collaborative session** — you'll land on
   `/room/<id>`.
2. Click **Copy invite link** and open it in a second browser window (or a
   different signed-in account / incognito tab).
3. Type in either window: text syncs instantly (peer-to-peer over WebRTC), and
   you'll see the other person's caret, name tag, and selection.

### Try code execution

1. Open a problem, pick Python or JavaScript, write some code.
2. (Optional) put input in the **stdin** box.
3. Click **▶ Run** (or Ctrl/Cmd+Enter). The job is queued in Redis, the worker
   runs it in a throwaway container, and stdout/stderr appear in the console.
4. Untrusted code is safe: no network, capped memory/CPU/PIDs, read-only FS, and
   an 8s wall-clock kill (an infinite loop returns `exit 137`, not a hung server).

## Project structure

```
server/
  index.ts                      # Socket.IO presence/cursors + /worker relay (:3001)
  signaling.ts                  # self-hosted y-webrtc signaling relay (:4444)
  worker.ts                     # drains Redis queue, runs code in Docker sandbox
src/
  proxy.ts                      # Next 16 "middleware": session refresh + guards
  lib/
    supabase/{client,server,proxy}.ts   # Supabase clients per context
    auth.ts                     # requireUser() / getUser() DAL helpers
    redis.ts                    # shared ioredis connection (route handlers)
    types.ts                    # shared types, language list, starter code
    collab.ts                   # room user/cursor types + color helper
    exec.ts                     # execution job/result types + queue name
  components/
    CodeEditor.tsx              # Monaco wrapper (single-player)
    Workspace.tsx               # editor + save + Run console (client)
    CollaborativeEditor.tsx     # Yjs+y-webrtc text sync + Socket.IO cursors
    CreateRoomButton.tsx        # spins up a new /room/<id>
    Header.tsx                  # nav + sign out
  app/
    api/run/route.ts            # POST: insert execution + enqueue job
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

## How code execution stays safe

Each "Run" goes through an async queue so a slow/malicious program never blocks
the web server:

```
Browser ──POST /api/run──▶ Next route ──LPUSH──▶ Redis queue
                                                     │ BRPOP
                                                     ▼
                              Worker ──docker run (sandbox)──▶ result
                                 │ write to DB (service role)
                                 │ emit "result" to /worker namespace
                                 ▼
        Browser ◀──"execution:result"── Socket.IO server (exec:<id> room)
```

Container lockdown (`server/worker.ts`): `--network none`, `--memory 256m`
(no swap), `--cpus 0.5`, `--pids-limit 64`, `--read-only` root + small
`noexec` tmpfs, `--cap-drop ALL`, `--security-opt no-new-privileges`, `--rm`,
and an 8s wall-clock kill. Code is passed via an env var (base64) — the host
filesystem is never mounted.

## Milestone status

✅ **Phase 1** — log in, pick a problem, edit in Monaco, save to Postgres.
✅ **Phase 2** — multiplayer rooms: Google-Docs-style text sync with visible
remote cursors and no text conflicts.
✅ **Phase 3** — run untrusted code safely in a Docker sandbox via a Redis
queue + worker, with output streamed back over Socket.IO.

## Next (Phase 4+)

Contests, code replay, and the AI features (reviewer, hints, plagiarism
detection) from the roadmap.

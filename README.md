# CodeWithMe

A real-time collaborative coding platform (a mini LeetCode + VS Code).

- **Phase 1 — single-player foundation:** auth, a Monaco editor, problem
  browsing, and saving code to Firestore.
- **Phase 2 — collaboration engine:** multiplayer rooms with Yjs + y-webrtc
  text sync (peer-to-peer) and a Socket.IO server for presence + live cursors.
- **Phase 3 — execution sandbox:** click "Run" → job is queued in Redis → a
  worker executes the code in a locked-down Docker container → stdout/stderr
  stream back to the browser over Socket.IO. (Python & JS; C++ coming.)

## Tech stack

- **Next.js 16** (App Router, TypeScript) — note: Next 16 renames `middleware`
  to **`proxy`** and makes `cookies()` async.
- **Firebase** — Auth (email/password) + Cloud Firestore. The browser signs in
  with the Firebase client SDK, then the server exchanges the ID token for an
  httpOnly **session cookie** (`firebase-admin`); all data access runs on the
  server through the Admin SDK.
- **Monaco Editor** (`@monaco-editor/react`) — Python, C++, JavaScript.
- **Tailwind CSS v4**.

## Phase 1 features

- Email/password sign-up & sign-in via Firebase Auth + a server-set session
  cookie.
- Session verification + route protection in `src/proxy.ts`.
- Problem list and problem detail pages (description + sample test cases).
- Monaco editor with per-language buffers and starter code.
- Save code to Firestore (`Ctrl/Cmd+S` or the Save button); one snapshot per
  `(user, problem, language)`.

## Getting started

### 1. Create a Firebase project

In the [Firebase console](https://console.firebase.google.com):

1. Create a project.
2. **Build → Authentication → Get started**, and enable the
   **Email/Password** sign-in provider.
3. **Build → Firestore Database → Create database** (any location, production
   mode).
4. **Project settings → General → Your apps → Add app → Web** to get the web
   config (`apiKey`, `authDomain`, `projectId`).
5. **Project settings → Service accounts → Generate new private key** to
   download the Admin SDK JSON.

### 2. Configure environment variables

```bash
cp .env.local.example .env.local
```

Fill in the `NEXT_PUBLIC_FIREBASE_*` web config, and copy `project_id`,
`client_email` and `private_key` from the service-account JSON into
`FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL` and `FIREBASE_PRIVATE_KEY`
(keep the value in double quotes with its `\n` escapes). The service-account
values are **server-only secrets** — never prefix them with `NEXT_PUBLIC`.
(Alternatively, point `GOOGLE_APPLICATION_CREDENTIALS` at the JSON file.)

### 3. Set up the database

```bash
npm run seed                                   # starter problems + sample cases
npx firebase-tools deploy --only firestore:rules --project <your-project-id>
```

The seed is idempotent. The rules in [`firestore.rules`](firestore.rules) deny
all direct client access — the app only touches Firestore from the server via
the Admin SDK, after verifying the session cookie. Data layout:

```
problems/{slug}                        title, description, difficulty, created_at
problems/{slug}/test_cases/{id}        input, expected_output, is_sample, ordinal
drafts/{uid}_{problemId}_{language}    saved code (one per triple)
executions/{autoId}                    one per "Run", completed by the worker
```

Optional but recommended: let Firestore delete old runs automatically. Each
execution has an `expire_at` field (7 days out). In the Google Cloud console
open **Firestore → Time-to-live (TTL) → Create policy**, collection group
`executions`, timestamp field `expire_at`.

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

Checks (also run by CI on every push, see `.github/workflows/ci.yml`):

```bash
npm run lint && npm run typecheck && npm test
```

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
5. Each user can run 10 times per minute. If the result doesn't arrive over the
   socket, the page falls back to polling and gives up with an error after 60s.

## Project structure

```
server/
  index.ts                      # Socket.IO presence/cursors + /worker relay (:3001)
  signaling.ts                  # self-hosted y-webrtc signaling relay (:4444)
  worker.ts                     # drains Redis queue → sandbox → Firestore + result
  sandbox.ts                    # docker run flags, output caps, orphan cleanup
  config.ts                     # WORKER_SECRET (required in production)
  firebaseAdmin.ts              # Admin SDK init for worker + seed script
scripts/seed.ts                 # seeds Firestore with starter problems
src/
  proxy.ts                      # Next 16 "middleware": session check + guards
  lib/
    db/                         # ALL Firestore access: problems, drafts, executions
    firebase/admin.ts           # Admin SDK (auth + Firestore), server-only
    firebase/client.ts          # client SDK, used only to sign in
    firebase/proxy.ts           # session-cookie verification for proxy.ts
    auth.ts                     # requireUser() / getUser() DAL helpers
    redis.ts                    # shared ioredis connection + rateLimit()
    redirect.ts                 # safeRedirect() for post-login redirects
    types.ts                    # shared types, language list, starter code
    collab.ts                   # room types, room-id check, color helper
    exec.ts                     # job/result types, runnable languages, limits
                                #   (collab.ts + exec.ts are also imported by server/)
  components/
    CodeEditor.tsx              # Monaco wrapper (single-player)
    Workspace.tsx               # editor + save + Run console (client)
    CollaborativeEditor.tsx     # Yjs+y-webrtc text sync + Socket.IO cursors
    CreateRoomButton.tsx        # spins up a new /room/<id>
    Header.tsx                  # nav + sign out
  app/
    api/run/route.ts            # POST: rate-limit, insert execution, enqueue job
    api/executions/[id]/        # GET: run status/result (polling fallback)
    login/                      # auth page, form, session-cookie actions
    problems/                   # list + [slug] detail with editor
    room/[id]/                  # collaborative session page
firestore.rules                 # deny-all client rules (server-only access)
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
                                 │ write to Firestore (Admin SDK)
                                 │ emit "result" to /worker namespace
                                 ▼
        Browser ◀──"execution:result"── Socket.IO server (exec:<id> room)
```

Container lockdown (`server/sandbox.ts`): `--network none`, `--memory 256m`
(no swap), `--cpus 0.5`, `--pids-limit 64`, `--read-only` root + small
`noexec` tmpfs, runs as `nobody` (`--user 65534:65534`), `nofile`/`fsize`
ulimits, `--cap-drop ALL`, `--security-opt no-new-privileges`, `--rm`, and an
8s wall-clock kill. The code is sent as the first line of stdin (base64), so
there's no command-line length limit, and the host filesystem is never
mounted. stdout/stderr are capped at 64 KB each.

The worker sends the result before writing it to Firestore, and database
writes time out after 10s, so a Firestore problem never blocks results.

## Milestone status

✅ **Phase 1** — log in, pick a problem, edit in Monaco, save to Firestore.
✅ **Phase 2** — multiplayer rooms: Google-Docs-style text sync with visible
remote cursors and no text conflicts.
✅ **Phase 3** — run untrusted code safely in a Docker sandbox via a Redis
queue + worker, with output streamed back over Socket.IO.

## Next (Phase 4+)

Contests, code replay, and the AI features (reviewer, hints, plagiarism
detection) from the roadmap.

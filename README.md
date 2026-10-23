# CodeWithMe

A real-time collaborative coding platform (a mini LeetCode + VS Code).

- **Phase 1 — single-player foundation:** auth, a Monaco editor, problem
  browsing, and saving code to Firestore.
- **Phase 2 — collaboration engine:** multiplayer rooms with Yjs + y-webrtc
  text sync (peer-to-peer) and a Socket.IO server for presence + live cursors.
- **Phase 3 — execution sandbox:** click "Run" → job is queued in Redis → a
  worker executes the code in a locked-down Docker container → stdout/stderr
  stream back to the browser over Socket.IO. (Python, JavaScript and C++.)
- **Phase 5 — judge:** click "Submit" → the worker runs your code against the
  problem's sample and hidden tests → a verdict (Accepted, Wrong Answer, Time /
  Memory Limit, Runtime Error, Compilation Error), submission history and ✓
  solved marks.

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
npm run seed                 # problems, starter code, sample + hidden tests
npx firebase-tools deploy --only firestore --project <your-project-id>   # rules + indexes
```

The seed **syncs**: re-running it updates the problems (statement, format,
starter code) and replaces their tests. Problems live in
[`scripts/problems.ts`](scripts/problems.ts); expected outputs come from the
reference solutions there, not hand-typed values.

The rules in [`firestore.rules`](firestore.rules) deny all direct client access
— the app only touches Firestore from the server via the Admin SDK, after
verifying the session cookie. [`firestore.indexes.json`](firestore.indexes.json)
holds the index for the submission history (until it's deployed, the history
query falls back to sorting in memory). Data layout:

```
problems/{slug}                        statement, input/output format, constraints,
                                       time_limit_ms, comparator, starter_code
problems/{slug}/test_cases/{id}        input, expected_output, is_sample, ordinal
drafts/{uid}_{problemId}_{language}    saved code (one per triple)
executions/{autoId}                    one per "Run", completed by the worker
submissions/{autoId}                   one per "Submit": verdict, passed/total, failed test
users/{uid}/progress/{problemId}       attempted | solved
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

# Sandbox runtime images: pulls Python + Node, builds the C++ image
# (Alpine + g++ with a precompiled <bits/stdc++.h>, ~470 MB, ~1 min)
npm run sandbox:images
```

The worker never downloads images on its own (`--pull never`), so a missing
image fails fast with a hint to run this command.

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

### Try the judge

1. Open a problem. The starter code already reads the input — fill in the
   function.
2. Click **Submit** (or Ctrl/Cmd+Shift+Enter). The verdict appears in the
   console's **verdict** tab: e.g. *Accepted — 10 / 10 tests passed*.
3. A failed **sample** test shows its input, the expected output and yours; a
   failed **hidden** test only shows its number.
4. The **Submissions** tab lists your attempts; *Open in editor* loads old code.
   Solved problems get a ✓ on the problem list. Limit: 6 submissions/minute.
5. Drafts **autosave** 5 s after you stop typing (and Ctrl/Cmd+S still saves
   right away).

### Add and edit problems (admin)

```bash
npm run set-admin -- you@example.com      # add --remove to take it away
```

Sign out and back in (the session picks up the admin claim at sign-in). An
**Admin** link appears in the header → `/admin/problems`, where you can create,
edit and delete problems: statement (Markdown, with preview), input/output
format, constraints, time limit, comparator, starter code per language, and
sample + hidden tests (or paste them as JSON). Non-admins get a 404 on these
pages, and every admin Server Action re-checks the claim. After saving, open the
problem and Submit a reference solution to confirm the tests. The judge picks
up edits within a minute. Note that `npm run seed` overwrites the three problems
defined in `scripts/problems.ts`.

## Project structure

```
server/
  index.ts                      # Socket.IO presence/cursors + /worker relay (:3001)
  signaling.ts                  # self-hosted y-webrtc signaling relay (:4444)
  worker.ts                     # job loop: N at a time, runs first, crash recovery
  queue.ts                      # Redis Streams consumer (pending, retry, claim)
  sandbox.ts                    # docker run flags, run + judge runner scripts, caps
  judge.ts                      # samples then hidden tests → verdict (pure, tested)
  config.ts                     # WORKER_SECRET (required in production)
  firebaseAdmin.ts              # Admin SDK init for worker + seed script
sandbox/cpp/Dockerfile          # C++ image (g++ + precompiled <bits/stdc++.h>)
scripts/problems.ts             # problem definitions + tests (reference solutions)
scripts/seed.ts                 # syncs problems.ts into Firestore
scripts/set-admin.ts            # grants/removes the admin custom claim
src/
  proxy.ts                      # Next 16 "middleware": session check + guards
  lib/
    db/                         # ALL Firestore access: problems, drafts,
                                #   executions, submissions, progress
    judge.ts                    # verdicts, output comparators, result types
    firebase/admin.ts           # Admin SDK (auth + Firestore), server-only
    firebase/client.ts          # client SDK, used only to sign in
    firebase/proxy.ts           # session-cookie verification for proxy.ts
    auth.ts                     # getUser() / requireUser() / requireAdmin()
    redis.ts                    # ioredis connection, enqueueJob(), rateLimit()
    problem-input.ts            # validation for admin problem edits (tested)
    redirect.ts                 # safeRedirect() for post-login redirects
    types.ts                    # shared types, language list, starter code
    collab.ts                   # room types, room-id check, color helper
    exec.ts                     # job/result types, runnable languages, limits
                                #   (collab.ts + exec.ts are also imported by server/)
  components/
    CodeEditor.tsx              # Monaco wrapper (single-player) + shortcuts
    Workspace.tsx               # editor, Save / Run / Submit, output + verdict
    ProblemShell.tsx            # problem page: Description/Submissions + editor
    VerdictView.tsx             # renders a submission's verdict
    Markdown.tsx                # problem statements (no raw HTML)
    CollaborativeEditor.tsx     # Yjs+y-webrtc text sync + Socket.IO cursors
    CreateRoomButton.tsx        # spins up a new /room/<id>
    Header.tsx                  # nav + Admin link + sign out
    admin/ProblemEditor.tsx     # create/edit problems and tests
  app/
    api/run/route.ts            # POST: rate-limit, insert execution, enqueue job
    api/executions/[id]/        # GET: run status/result (polling fallback)
    api/submit/route.ts         # POST: rate-limit, insert submission, enqueue job
    api/submissions/[id]/       # GET: verdict + code (owner only)
    login/                      # auth page, form, session-cookie actions
    problems/                   # list + [slug] detail with editor
    admin/problems/             # admin: list, new, [slug]/edit (+ actions.ts)
    room/[id]/                  # collaborative session page
firestore.rules                 # deny-all client rules (server-only access)
firestore.indexes.json          # index for the submission history query
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
Browser ──POST /api/run──▶ Next route ──XADD──▶ Redis Stream (runs | submissions)
                                                     │ XREADGROUP (consumer group)
                                                     ▼
                              Worker ──docker run (sandbox)──▶ result
                                 │ emit "result" to /worker namespace
                                 │ write to Firestore (Admin SDK), then XACK
                                 ▼
        Browser ◀──"execution:result"── Socket.IO server (exec:<id> room)
```

The queue is **reliable**: a job stays *pending* in the Redis consumer group
until the worker acknowledges it after finishing.
- **Crash recovery:** if the worker dies mid-job, it picks the job up again on
  restart (same `WORKER_ID`).
- **Dead workers:** jobs held more than 5 minutes by a worker that never comes
  back are claimed by another worker.
- **Retry limit:** a job that keeps failing is dropped after 3 attempts, with an
  error sent to the browser.
- **Parallelism:** the worker runs `WORKER_CONCURRENCY` jobs at once (default 2).
- **Priority:** runs and submissions use separate streams, so a quick Run never
  waits behind a queue of submissions.

Container lockdown (`server/sandbox.ts`): `--network none`, `--memory 256m`
(no swap), `--cpus 0.5`, `--pids-limit 64`, `--read-only` root + small
`noexec` tmpfs, runs as `nobody` (`--user 65534:65534`), `nofile`/`fsize`
ulimits, `--cap-drop ALL`, `--security-opt no-new-privileges`, `--rm`, and an
8s wall-clock kill. The code is sent as the first line of stdin (base64), so
there's no command-line length limit, and the host filesystem is never
mounted. stdout/stderr are capped at 64 KB each.

C++ (`codewithme-cpp` image) compiles with `g++ -std=c++17 -O2` under its own
15 s limit, then runs under the same 8 s limit. Its container gets 512 MB so the
compiler has headroom, but the program itself is capped at 256 MB (`ulimit -v`).
Its scratch dir allows executing the compiled binary; the Python and JS ones
don't.

The worker sends the result before writing it to Firestore, and database
writes time out after 10s, so a Firestore problem never blocks results.

## How the judge works

A submission runs in the same locked-down containers, through a small shell
runner (`judgeScript` in `server/sandbox.ts`):

- The container receives the code and the test **inputs** only. It runs the
  program once per test under the problem's time limit and reports each run's
  output, exit code and time. **Expected outputs never enter the container** —
  the worker compares them (`tokens`, `exact` or `float:<eps>` comparators).
- **Sample tests run first, in their own container**, then hidden tests in a
  second one. A failed sample shows the program's output to the user, so that
  container never holds hidden inputs a hostile program could print.
- The first failing test decides the verdict: 137 + time used → TLE, 137 early
  or `bad_alloc`/`MemoryError` → MLE, other non-zero exits → RE, output over
  1 MB → RE, wrong output → WA. C++ compile errors → CE with the compiler output.
- The worker also times each test on its own clock, so a program that kills
  the runner to dodge `timeout` still gets TLE.

## Milestone status

✅ **Phase 1** — log in, pick a problem, edit in Monaco, save to Firestore.
✅ **Phase 2** — multiplayer rooms: Google-Docs-style text sync with visible
remote cursors and no text conflicts.
✅ **Phase 3** — run untrusted code safely in a Docker sandbox via a Redis
queue + worker, with output streamed back over Socket.IO.
✅ **Phase 4** — stabilised: no stuck runs, rate limits, hardened sandbox,
data-access layer, tests + CI, C++.
✅ **Phase 5** — judge with verdicts, hidden tests, history and solved marks;
reliable job queue with parallel workers; admin problem editor; draft autosave.

## Next

Deployment, collaboration v2, contests, AI hints/review and plagiarism
detection — see the roadmap.

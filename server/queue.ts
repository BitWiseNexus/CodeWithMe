import Redis from "ioredis";
import { JOB_GROUP, LEGACY_QUEUE, RUN_STREAM, SUBMIT_STREAM } from "@/lib/exec";

/**
 * Reliable job queue on Redis Streams (consumer group JOB_GROUP).
 *
 * - A job read with XREADGROUP stays *pending* for this consumer until it's
 *   acknowledged, so a worker that dies mid-job doesn't lose it: on restart
 *   the same consumer (stable WORKER_ID) re-reads its own pending jobs.
 * - Jobs left pending by a consumer that never comes back are claimed by
 *   others with XAUTOCLAIM after STALE_MS.
 * - Runs and submissions live in separate streams; runs go first.
 */

/** A job taken from a stream, not yet acknowledged. */
export interface Delivery {
  stream: string;
  id: string;
  /** The JSON job payload. */
  raw: string;
  /** How many times this entry has been delivered (1 = first try). */
  deliveries: number;
}

type StreamReply = [stream: string, entries: [id: string, fields: string[]][]][] | null;

/** Turns an XREADGROUP reply into deliveries. */
export function parseReadReply(reply: StreamReply, deliveries = 1): Delivery[] {
  const out: Delivery[] = [];
  for (const [stream, entries] of reply ?? []) {
    for (const [id, fields] of entries) {
      // Fields come as a flat [name, value, name, value…] list.
      const i = fields ? fields.indexOf("job") : -1;
      out.push({ stream, id, raw: i >= 0 ? fields[i + 1] : "", deliveries });
    }
  }
  return out;
}

/** Runs before submissions; otherwise oldest (stream id order) first. */
export function byPriority(a: Delivery, b: Delivery): number {
  const rank = (d: Delivery) => (d.stream === RUN_STREAM ? 0 : 1);
  return rank(a) - rank(b) || a.id.localeCompare(b.id, undefined, { numeric: true });
}

export class JobQueue {
  /** Blocking reads get their own connection (they'd stall other commands). */
  private readonly reader: Redis;
  private readonly cmd: Redis;

  constructor(
    url: string,
    private readonly consumer: string
  ) {
    this.reader = new Redis(url);
    this.cmd = new Redis(url);
    for (const c of [this.reader, this.cmd]) {
      c.on("error", (e) => console.error("[queue] redis:", e.message));
    }
  }

  /** Creates the consumer group on both streams and migrates the old list queue. */
  async init(): Promise<void> {
    for (const stream of [RUN_STREAM, SUBMIT_STREAM]) {
      try {
        // "0" so jobs added before the group existed are still processed.
        await this.cmd.xgroup("CREATE", stream, JOB_GROUP, "0", "MKSTREAM");
      } catch (e) {
        if (!(e instanceof Error) || !e.message.includes("BUSYGROUP")) throw e;
      }
    }

    // Jobs queued by an older version (Redis list) → move them to the streams.
    let moved = 0;
    for (;;) {
      const raw = await this.cmd.rpop(LEGACY_QUEUE);
      if (raw === null) break;
      let type: string | undefined;
      try {
        type = (JSON.parse(raw) as { type?: string }).type;
      } catch {
        continue; // unparseable leftovers are dropped
      }
      await this.cmd.xadd(type === "submit" ? SUBMIT_STREAM : RUN_STREAM, "*", "job", raw);
      moved++;
    }
    if (moved) console.log(`[queue] moved ${moved} job(s) from the old list queue`);
  }

  /** Jobs this consumer took but never acknowledged (e.g. it crashed mid-job). */
  async ownPending(): Promise<Delivery[]> {
    const out: Delivery[] = [];
    for (const stream of [RUN_STREAM, SUBMIT_STREAM]) {
      // XPENDING gives delivery counts; XREADGROUP with id 0 re-reads the entries.
      const summary = (await this.cmd.xpending(stream, JOB_GROUP, "-", "+", 100, this.consumer)) as [
        string,
        string,
        number,
        number,
      ][];
      if (summary.length === 0) continue;
      const counts = new Map(summary.map(([id, , , n]) => [id, Number(n)]));
      const reply = (await this.cmd.xreadgroup(
        "GROUP", JOB_GROUP, this.consumer, "COUNT", 100, "STREAMS", stream, "0"
      )) as StreamReply;
      for (const d of parseReadReply(reply)) {
        out.push({ ...d, deliveries: (counts.get(d.id) ?? 1) + 1 });
      }
    }
    return out.sort(byPriority);
  }

  /**
   * Waits up to `blockMs` for new jobs. Returns runs first. May return one job
   * from each stream; all of them now belong to this consumer.
   */
  async next(blockMs: number): Promise<Delivery[]> {
    const reply = (await this.reader.xreadgroup(
      "GROUP", JOB_GROUP, this.consumer,
      "COUNT", 1,
      "BLOCK", blockMs,
      "STREAMS", RUN_STREAM, SUBMIT_STREAM, ">", ">"
    )) as StreamReply;
    return parseReadReply(reply).sort(byPriority);
  }

  /** A waiting run, without blocking (lets runs overtake buffered submissions). */
  async nextRunNow(): Promise<Delivery | null> {
    const reply = (await this.cmd.xreadgroup(
      "GROUP", JOB_GROUP, this.consumer, "COUNT", 1, "STREAMS", RUN_STREAM, ">"
    )) as StreamReply;
    return parseReadReply(reply)[0] ?? null;
  }

  /** Takes over jobs another consumer has held for longer than `minIdleMs`. */
  async claimStale(minIdleMs: number): Promise<Delivery[]> {
    const out: Delivery[] = [];
    for (const stream of [RUN_STREAM, SUBMIT_STREAM]) {
      const [, entries] = (await this.cmd.xautoclaim(
        stream, JOB_GROUP, this.consumer, minIdleMs, "0", "COUNT", 20
      )) as [string, [string, string[]][]];
      // A claimed entry has been delivered at least twice now.
      out.push(...parseReadReply([[stream, entries.filter(([, f]) => f)]], 2));
    }
    return out.sort(byPriority);
  }

  /** Done with a job: acknowledge it and delete it from the stream. */
  async ack(d: Delivery): Promise<void> {
    await this.cmd.multi().xack(d.stream, JOB_GROUP, d.id).xdel(d.stream, d.id).exec();
  }

  disconnect() {
    this.reader.disconnect();
    this.cmd.disconnect();
  }
}

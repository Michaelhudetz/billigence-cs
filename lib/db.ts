import postgres from "postgres";

let reader: postgres.Sql | null = null;
let logger: postgres.Sql | null = null;

function connect(envName: "DATABASE_URL_READER" | "DATABASE_URL_LOGGER") {
  const url = process.env[envName];
  if (!url) throw new Error(`${envName} is not set`);
  return postgres(url, { prepare: false, max: 3, idle_timeout: 20, connect_timeout: 10, onnotice: () => {} });
}

export type QueryResult = { ok: true; rows: Record<string, unknown>[]; ms: number } | { ok: false; error: string; ms: number };

export async function runQuery(sql: string): Promise<QueryResult> {
  reader ??= connect("DATABASE_URL_READER");
  const started = Date.now();
  try {
    const rows = await reader.unsafe(sql);
    const numeric = new Set(rows.columns.filter((c) => c.type === 1700 || c.type === 20).map((c) => c.name));
    const clean = rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, numeric.has(k) && v !== null ? Number(v) : v])));
    return { ok: true, rows: clean, ms: Date.now() - started };
  } catch (e: any) {
    return { ok: false, error: String(e.message ?? e), ms: Date.now() - started };
  }
}

export type LogEntry = {
  question: string; resolved_entities: unknown; provider: string | null; model: string | null; sql: string | null;
  guard_result: unknown; row_count: number | null; latency_ms: number; tokens_in: number | null; tokens_out: number | null;
  cost_usd: number | null; outcome: string;
};

export function logQuery(entry: LogEntry): Promise<void> {
  try {
    logger ??= connect("DATABASE_URL_LOGGER");
    return logger`insert into ops.query_log ${logger({ ...entry, resolved_entities: logger.json(entry.resolved_entities as any), guard_result: logger.json(entry.guard_result as any) } as any)}`
      .then(() => undefined)
      .catch((e) => console.warn("query_log insert failed:", e.message));
  } catch (e: any) {
    console.warn("query_log unavailable:", e.message);
    return Promise.resolve();
  }
}

export async function closeDb() {
  await Promise.all([reader?.end(), logger?.end()]);
  reader = logger = null;
}

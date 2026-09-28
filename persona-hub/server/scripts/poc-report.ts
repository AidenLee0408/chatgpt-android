/**
 * Summarises /app/access-logs for the PoC results sheet: calls per client/tool and server-side p95 latency.
 * Usage: BASE_URL=https://... APP_TOKEN=... npm run poc:report
 */
const base = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const token = process.env.APP_TOKEN ?? "dev-app-token";

interface Log { client_name: string; tool: string; latency_ms: number; persona_ids: string[] }

const res = await fetch(`${base}/app/access-logs`, { headers: { authorization: `Bearer ${token}` } });
if (!res.ok) throw new Error(`access-logs ${res.status}`);
const { items } = (await res.json()) as { items: Log[] };

const p95 = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.ceil(s.length * 0.95) - 1)] : 0;
};
const byClient = new Map<string, Log[]>();
for (const l of items) byClient.set(l.client_name, [...(byClient.get(l.client_name) ?? []), l]);

console.log(`총 호출 ${items.length}건, 전체 p95 ${p95(items.map((l) => l.latency_ms))}ms (기준 500ms)`);
for (const [client, logs] of byClient) {
  const tools = Object.entries(Object.groupBy(logs, (l) => l.tool)).map(([t, v]) => `${t}=${v!.length}`);
  console.log(`- ${client}: ${logs.length}건, p95 ${p95(logs.map((l) => l.latency_ms))}ms, ${tools.join(", ")}`);
}

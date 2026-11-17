import { DEMOS } from "../lib/demos";

const base = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");
const expected: Record<string, string> = { "What does value added mean?": "definition", "Which uni has the best nightlife?": "declined_llm" };
let failures = 0;

for (const d of DEMOS) {
  const started = Date.now();
  const res = await fetch(`${base}/api/ask`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: d.question, ...d.context }) });
  const json: any = await res.json().catch(() => ({}));
  const want = expected[d.question] ?? "answered";
  const ok = res.ok && json.outcome === want;
  if (!ok) failures++;
  const first = String(json.answer ?? json.error ?? "").split("\n")[0].slice(0, 100);
  console.log(`${ok ? "PASS" : "FAIL"} ${String(json.outcome ?? res.status).padEnd(13)} ${((Date.now() - started) / 1000).toFixed(1)}s  ${d.label.padEnd(38)} | ${first}`);
}
console.log(failures ? `\n${failures} FAILED` : "\nALL DEMOS PASS");
process.exit(failures ? 1 : 0);

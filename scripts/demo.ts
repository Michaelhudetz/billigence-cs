import { ask, logAsk } from "../lib/ask";
import { closeDb } from "../lib/db";
import { DEMOS as ALL_DEMOS } from "../lib/demos";

const DEMOS = ALL_DEMOS.map((d) => ({ q: d.question, context: d.context }));

const line = (ch: string) => ch.repeat(100);
const items = process.argv[2] ? [{ q: process.argv.slice(2).join(" "), context: undefined }] : DEMOS;

for (const { q, context } of items) {
  const res = await ask(q, context ?? {});
  const t = res.trace.totals;
  console.log(`\n${line("=")}\nQ: ${q}${context ? `   [selector: ${JSON.stringify(context)}]` : ""}\n${line("-")}`);
  console.log(res.answer);
  console.log(`${line("-")}\noutcome=${res.outcome}  llm_calls=${t.llmCalls}  ${t.ms}ms  tokens=${t.tokensIn}/${t.tokensOut}  cost=$${t.costUsd.toFixed(5)}`);
  if (res.trace.resolved?.kgRules.length) console.log("KG:", res.trace.resolved.kgRules.join(" | ").slice(0, 200));
  if (res.trace.sql) console.log("SQL:", res.trace.sql.replace(/\s+/g, " "));
  for (const st of res.trace.steps) {
    const d: any = st.detail;
    if (st.step.startsWith("llm") && d?.error) console.log(`  ${st.step}: ERROR ${d.error}`);
    if (st.step.startsWith("guard") && d && !d.ok) console.log(`  ${st.step}: REJECTED ${d.reasons}`);
    if (st.step.startsWith("checks") && d !== "ok") console.log(`  ${st.step}: ${d}`);
    if (st.step.startsWith("database") && d?.error) console.log(`  ${st.step}: ${d.error}`);
  }
  await logAsk(res);
}
await closeDb();

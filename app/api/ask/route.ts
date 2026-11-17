import { after } from "next/server";
import { ask, logAsk } from "@/lib/ask";
import { YEARS } from "@/lib/resolve";
import { loadSemantic } from "@/lib/semantic";
import { modelByKey } from "@/lib/models";

export const maxDuration = 30;

export async function POST(req: Request) {
  let body: any;
  try { body = await req.json(); } catch { return Response.json({ error: "Body must be JSON." }, { status: 400 }); }

  const question = typeof body?.question === "string" ? body.question : "";
  const year = YEARS.includes(Number(body?.year)) ? Number(body.year) : undefined;
  const metricId = typeof body?.metricId === "string" && loadSemantic().metricById.has(body.metricId) ? body.metricId : undefined;
  const choice = modelByKey(body?.modelKey);

  try {
    const result = await ask(question, { year, metricId }, { llm: choice && { provider: choice.provider, model: choice.model } });
    after(() => logAsk(result));
    return Response.json(result);
  } catch (e: any) {
    console.error("ask failed:", e);
    return Response.json({ error: "Something went wrong on the server. Nothing was guessed; please try again." }, { status: 500 });
  }
}

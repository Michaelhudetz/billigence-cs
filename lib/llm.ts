import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { OUTPUT_SCHEMA } from "./prompt";

const PRICES: Record<string, [number, number]> = {
  "gpt-5.4-nano": [0.2, 1.25],
  "gpt-5.4-mini": [0.75, 4.5],
  "gpt-5-mini": [0.25, 2.0],
  "claude-haiku-5-5": [0.1, 0.5],
  "claude-sonnet-5-5": [2.0, 10.0],
  "claude-opus-5-5": [4.0, 20.0],
};

export type LlmCall = { json: unknown; raw: string; tokensIn: number; tokensOut: number; latencyMs: number; costUsd: number | null; provider: string; model: string };

export type LlmChoice = { provider: string; model: string };

export function llmConfig(override?: LlmChoice) {
  const provider = override?.provider ?? process.env.LLM_PROVIDER ?? "anthropic";
  const model = override?.model ?? process.env.LLM_MODEL ?? "claude-haiku-5-5";
  if (provider !== "openai" && provider !== "anthropic") throw new Error(`LLM_PROVIDER must be openai or anthropic, got "${provider}"`);
  return { provider, model };
}

let openai: OpenAI | null = null;
let anthropic: Anthropic | null = null;

export async function generateSql(system: string, user: string, override?: LlmChoice): Promise<LlmCall> {
  const { provider, model } = llmConfig(override);
  const started = Date.now();
  let raw = "", tokensIn = 0, tokensOut = 0;

  if (provider === "openai") {
    openai ??= new OpenAI();
    const res = await openai.chat.completions.create({
      model,
      temperature: 0,
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      response_format: { type: "json_schema", json_schema: { name: "sql_plan", strict: true, schema: OUTPUT_SCHEMA as any } },
    });
    raw = res.choices[0]?.message?.content ?? "";
    tokensIn = res.usage?.prompt_tokens ?? 0;
    tokensOut = res.usage?.completion_tokens ?? 0;
  } else {
    anthropic ??= new Anthropic();
    const res = await anthropic.messages.create({
      model,
      max_tokens: 4000,
      system,
      messages: [{ role: "user", content: user }],
      output_config: { effort: "low", format: { type: "json_schema", schema: OUTPUT_SCHEMA as any } },
    } as any);
    if (res.stop_reason === "refusal") throw new Error("model refused the request");
    raw = res.content.map((b: any) => (b.type === "text" ? b.text : "")).join("");
    tokensIn = res.usage.input_tokens + (res.usage.cache_read_input_tokens ?? 0) + (res.usage.cache_creation_input_tokens ?? 0);
    tokensOut = res.usage.output_tokens;
  }

  let json: unknown = null;
  try { json = JSON.parse(raw); } catch {}
  const price = PRICES[model];
  const costUsd = price ? (tokensIn * price[0] + tokensOut * price[1]) / 1_000_000 : null;
  return { json, raw, tokensIn, tokensOut, latencyMs: Date.now() - started, costUsd, provider, model };
}

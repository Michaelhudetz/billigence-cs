export type ModelChoice = {
  key: string;
  label: string;
  provider: "anthropic" | "openai";
  model: string;
  recommended: boolean;
  eval: { answers: string; declines: string; costPerQuestion: string; latency: string; note: string };
};

export const MODEL_CHOICES: ModelChoice[] = [
  {
    key: "haiku", label: "Claude Haiku 5.5", provider: "anthropic", model: "claude-haiku-5-5", recommended: true,
    eval: { answers: "23/23 (100%) in both runs", declines: "5/5", costPerQuestion: "$0.00058", latency: "~1.9 s", note: "Every answer matched the independent gold answers." },
  },
  {
    key: "nano", label: "GPT-5.4 nano", provider: "openai", model: "gpt-5.4-nano", recommended: false,
    eval: { answers: "17/23 (74%) in both runs", declines: "5/5", costPerQuestion: "$0.00069", latency: "~1.5 s", note: "Slightly faster, but often refuses questions it could answer (never a wrong number, still a miss)." },
  },
];

export const DEFAULT_MODEL_KEY = "haiku";

export function modelByKey(key: unknown): ModelChoice | undefined {
  return MODEL_CHOICES.find((m) => m.key === key);
}

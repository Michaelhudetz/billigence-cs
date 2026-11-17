"use client";
import { Info } from "lucide-react";
import { MODEL_CHOICES } from "@/lib/models";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ClaudeIcon, OpenAIIcon } from "./brand-icons";

const BRAND: Record<string, { icon: typeof ClaudeIcon; on: string; off: string }> = {
  anthropic: { icon: ClaudeIcon, on: "bg-[#D97757] text-white", off: "text-[#D97757] hover:bg-[#D97757]/10" },
  openai: { icon: OpenAIIcon, on: "bg-black text-white", off: "text-foreground hover:bg-muted" },
};

export function ModelPicker({ value, onChange }: { value: string; onChange: (key: string) => void }) {
  return (
    <div className="flex items-center gap-1">
      <div role="radiogroup" aria-label="AI model" className="flex rounded-full border p-0.5">
        {MODEL_CHOICES.map((m) => {
          const brand = BRAND[m.provider];
          const Icon = brand.icon;
          const active = m.key === value;
          return (
            <button key={m.key} type="button" role="radio" aria-checked={active} aria-label={m.label} title={m.recommended ? `${m.label} (recommended)` : m.label}
              onClick={() => onChange(m.key)}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium transition-colors ${active ? brand.on : brand.off}`}>
              <Icon className="size-4" />
              <span className="hidden sm:inline">{m.label}</span>
            </button>
          );
        })}
      </div>
      <Popover>
        <PopoverTrigger className="rounded-full p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="How the models compare">
          <Info className="size-4" />
        </PopoverTrigger>
        <PopoverContent align="end" className="w-[min(24rem,calc(100vw-2rem))] space-y-3 text-sm">
          <p className="font-medium">Which AI writes the SQL?</p>
          <p className="text-muted-foreground">
            The AI only turns your question into one SQL query; the answer itself is always built by code from the data.
            Both models were tested on the same 28 questions (incl. 5 that must be declined), graded against
            independently written correct answers, two runs each.
          </p>
          <table className="w-full text-xs">
            <thead className="text-muted-foreground">
              <tr><th className="pb-1 text-left font-normal">Model</th><th className="pb-1 text-left font-normal">Correct answers</th><th className="pb-1 text-left font-normal">Declines</th><th className="pb-1 text-left font-normal">Cost / question</th><th className="pb-1 text-left font-normal">Speed</th></tr>
            </thead>
            <tbody>
              {MODEL_CHOICES.map((m) => (
                <tr key={m.key} className="align-top">
                  <td className="py-1 pr-2 font-medium">{m.label}</td>
                  <td className="py-1 pr-2">{m.eval.answers}</td>
                  <td className="py-1 pr-2">{m.eval.declines}</td>
                  <td className="py-1 pr-2">{m.eval.costPerQuestion}</td>
                  <td className="py-1">{m.eval.latency}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <ul className="space-y-1 text-xs text-muted-foreground">
            {MODEL_CHOICES.map((m) => <li key={m.key}><span className="font-medium text-foreground">{m.label}:</span> {m.eval.note}</li>)}
          </ul>
          <p className="text-xs"><span className="font-medium">Recommended: Claude Haiku 5.5</span>: more accurate <em>and</em> cheaper. GPT-5.4 nano stays available for comparison.</p>
        </PopoverContent>
      </Popover>
    </div>
  );
}

import { Chat, type GlossaryItem } from "@/components/chat";
import { DEMOS } from "@/lib/demos";
import { YEARS } from "@/lib/resolve";
import { loadSemantic } from "@/lib/semantic";

export default function Page() {
  const s = loadSemantic();
  const glossary: GlossaryItem[] = s.layer.metrics.map((m) => ({
    id: m.id, label: m.label, description: m.description.trim(), unit: m.unit, direction: m.direction,
  }));
  return <Chat demos={DEMOS} glossary={glossary} years={YEARS} />;
}

import { Fragment, type ReactNode } from "react";

function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? <strong key={i} className="font-semibold">{part.slice(2, -2)}</strong> : <Fragment key={i}>{part}</Fragment>,
  );
}

export function RichText({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: ReactNode[] } | null = null;
  const flush = () => {
    if (!list) return;
    const Tag = list.ordered ? "ol" : "ul";
    blocks.push(<Tag key={blocks.length} className="my-1 space-y-0.5 pl-1">{list.items}</Tag>);
    list = null;
  };

  text.split("\n").forEach((line, i) => {
    const bullet = line.match(/^- (.*)$/);
    const numbered = line.match(/^(\d+=?)\. (.*)$/);
    if (bullet || numbered) {
      const ordered = !!numbered;
      if (!list || list.ordered !== ordered) { flush(); list = { ordered, items: [] }; }
      list.items.push(
        <li key={i} className="flex gap-2">
          <span className="w-7 shrink-0 text-right tabular-nums text-muted-foreground">{numbered ? `${numbered[1]}.` : "•"}</span>
          <span>{inline(numbered ? numbered[2] : bullet![1])}</span>
        </li>,
      );
      return;
    }
    flush();
    if (!line.trim()) { blocks.push(<div key={i} className="h-2" />); return; }
    const italic = line.match(/^_(.*)_$/);
    blocks.push(italic
      ? <p key={i} className="text-sm text-muted-foreground">{inline(italic[1])}</p>
      : <p key={i}>{inline(line)}</p>);
  });
  flush();
  return <div className="space-y-1 leading-relaxed">{blocks}</div>;
}

export function formatSql(sql: string): string {
  return sql
    .replace(/\s+/g, " ")
    .replace(/\s*\b(SELECT|FROM|WHERE|GROUP BY|ORDER BY|HAVING|LIMIT|UNION|WITH)\b/gi, (m) => `\n${m.trim().toUpperCase()}`)
    .replace(/\s+\b(AND|OR)\b\s+/gi, (m) => `\n  ${m.trim().toUpperCase()} `)
    .replace(/,\s*/g, ", ")
    .trim();
}

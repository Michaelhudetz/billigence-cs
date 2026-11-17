"use client";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { ChartSpec } from "@/lib/answer";

const COLORS = ["#2563eb", "#db2777", "#16a34a", "#ea580c", "#7c3aed", "#0891b2"];

export function AnswerChart({ spec }: { spec: ChartSpec }) {
  const note = spec.lowerIsBetter ? " (lower is better)" : "";
  if (spec.type === "bar") {
    const height = Math.max(120, spec.data.length * 26 + 30);
    return (
      <figure className="mt-3">
        <figcaption className="mb-1 text-xs text-muted-foreground">{spec.title}, {spec.unit}{note}</figcaption>
        <ResponsiveContainer width="100%" height={height}>
          <BarChart data={spec.data} layout="vertical" margin={{ left: 8, right: 16 }}>
            <CartesianGrid horizontal={false} strokeOpacity={0.3} />
            <XAxis type="number" tick={{ fontSize: 11 }} />
            <YAxis type="category" dataKey="label" width={170} tick={{ fontSize: 11 }} interval={0} />
            <Tooltip formatter={(v) => [String(v), spec.unit]} />
            <Bar dataKey="value" fill={COLORS[0]} radius={[0, 3, 3, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </figure>
    );
  }
  const years = [...new Set(spec.series.flatMap((s) => s.points.map((p) => p.year)))].sort();
  const data = years.map((year) => Object.fromEntries([["year", year], ...spec.series.map((s) => [s.label, s.points.find((p) => p.year === year)?.value ?? null])]));
  return (
    <figure className="mt-3">
      <figcaption className="mb-1 text-xs text-muted-foreground">{spec.title}, {spec.unit}{note}</figcaption>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={data} margin={{ left: 0, right: 16, top: 8 }}>
          <CartesianGrid strokeOpacity={0.3} />
          <XAxis dataKey="year" tick={{ fontSize: 11 }} />
          <YAxis reversed={spec.lowerIsBetter} tick={{ fontSize: 11 }} width={40} />
          <Tooltip />
          {spec.series.map((s, i) => <Line key={s.label} dataKey={s.label} stroke={COLORS[i % COLORS.length]} strokeWidth={2} dot connectNulls />)}
        </LineChart>
      </ResponsiveContainer>
    </figure>
  );
}

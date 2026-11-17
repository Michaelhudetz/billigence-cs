import { describe, expect, test } from "bun:test";
import { loadSemantic, validate } from "./semantic";

const fresh = () => {
  const { layer, kg, universities, subjects } = loadSemantic();
  return structuredClone({ layer, kg, universities, subjects });
};
const errorsAfter = (breakIt: (s: ReturnType<typeof fresh>) => void) => { const s = fresh(); breakIt(s); return validate(s).join("\n"); };

describe("semantic layer + KG validation", () => {
  test("the real files are valid", () => expect(validate(fresh())).toEqual([]));
  test("metric missing a field", () =>
    expect(errorsAfter((s) => { (s.layer.metrics[0] as any).unit = ""; })).toContain('metric "rank": missing unit'));
  test("metric with no columns", () =>
    expect(errorsAfter((s) => { s.layer.metrics[0].columns = {}; })).toContain('metric "rank": no columns'));
  test("bad direction", () =>
    expect(errorsAfter((s) => { (s.layer.metrics[0] as any).direction = "up"; })).toContain("bad direction"));
  test("same id as dimension and metric", () =>
    expect(errorsAfter((s) => { s.layer.dimensions[0].id = "rank"; })).toContain('id "rank" defined twice'));
  test("synonym pointing at nothing", () =>
    expect(errorsAfter((s) => { s.layer.synonyms["vibes"] = "nightlife"; })).toContain('unknown id "nightlife"'));
  test("synonym that already names something else", () =>
    expect(errorsAfter((s) => { s.layer.synonyms["guardian score"] = "rank"; })).toContain("already names guardian_score"));
  test("view outside schema clean", () =>
    expect(errorsAfter((s) => { s.layer.metrics[0].columns["raw.overall"] = "ranking"; })).toContain('"raw.overall" is not in schema clean'));
  test("example query on raw schema", () =>
    expect(errorsAfter((s) => { s.layer.example_queries[0].sql = "SELECT * FROM raw.overall"; })).toContain("uses raw.overall"));
  test("join on a column the view doesn't have", () =>
    expect(errorsAfter((s) => { s.layer.joins[0].on = ["ghost"]; })).toContain('"ghost" is not a column'));
  test("entity key missing from one of its views", () =>
    expect(errorsAfter((s) => { s.layer.entities[2].views.push("clean.dim_subject"); })).toContain('key "year" is not a column of clean.dim_subject'));
  test("group member that doesn't exist", () =>
    expect(errorsAfter((s) => { s.kg.groups[0].members.push("hogwarts"); })).toContain('unknown university "hogwarts"'));
  test("group without a source", () =>
    expect(errorsAfter((s) => { s.kg.groups[0].source = ""; })).toContain("missing source"));
  test("KG alias that is also a university name", () =>
    expect(errorsAfter((s) => { s.kg.groups[0].aliases.push("Oxford"); })).toContain('also a university name'));
  test("university alias claimed by two universities", () =>
    expect(errorsAfter((s) => { s.universities[1].aliases.push("Aberdeen"); })).toContain('"aberdeen" used by both'));
  test("subject lineage across lineage groups", () =>
    expect(errorsAfter((s) => { s.kg.subject_lineage.push({ from: "law", to: "history", type: "renamed", year: 2015, source: "x" }); }))
      .toContain("different lineage_group"));
  test("merger in seed without a KG edge", () =>
    expect(errorsAfter((s) => { s.kg.university_lineage = s.kg.university_lineage.filter((e) => e.from !== "newport"); }))
      .toContain("successor_of newport has no KG lineage edge"));
});

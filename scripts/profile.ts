import * as XLSX from "xlsx";
import { readFileSync } from "fs";

type Row = Record<string, any>;

const wb = XLSX.read(readFileSync("data/TheGuardianRanking2.xlsx"));
const overall: Row[] = XLSX.utils.sheet_to_json(wb.Sheets["The Guardian Ranking"], { defval: null });
const subject: Row[] = XLSX.utils.sheet_to_json(wb.Sheets["The Guardian - Subject Areas"], { defval: null });

function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? "OK  " : "DIFF"} ${label}: ${JSON.stringify(actual)}${ok ? "" : `  (expected ${JSON.stringify(expected)})`}`);
}
function countBy<T>(rows: T[], key: (r: T) => string | number) {
  const m: Record<string, number> = {};
  for (const r of rows) m[key(r)] = (m[key(r)] ?? 0) + 1;
  return m;
}
const uniq = <T>(xs: T[]) => [...new Set(xs)];

console.log("\n== Row counts ==");
check("overall rows", overall.length, 355);
check("overall rows per year", countBy(overall, (r) => r["Ranking Year"]), { 2013: 120, 2014: 119, 2015: 116 });
check("subject rows", subject.length, 8102);
const subjectsByYear = (y: number) => uniq(subject.filter((r) => r["Subject Area Year"] === y).map((r) => r["Subject Area"])).sort();
check("subjects per year", [2013, 2014, 2015].map((y) => subjectsByYear(y).length), [46, 46, 54]);

console.log("\n== DQ1: change = rank - prev ==");
const ovChk = overall.filter((r) => r["Ranking (Prev)"] != null && r["Ranking Change"] != null);
check("overall rows where change == rank - prev", `${ovChk.filter((r) => r["Ranking Change"] === r["Ranking"] - r["Ranking (Prev)"]).length}/${ovChk.length}`, `${ovChk.length}/${ovChk.length}`);
const sbChk = subject.filter((r) => r["Subject Area Rank (Prev)"] != null && r["Subject Area Rank Change"] != null);
check("subject rows where change == rank - prev", `${sbChk.filter((r) => r["Subject Area Rank Change"] === r["Subject Area Rank"] - r["Subject Area Rank (Prev)"]).length}/${sbChk.length}`, `${sbChk.length}/${sbChk.length}`);

console.log("\n== DQ2: prev rank vs previous year's actual rank (overall, same spelling) ==");
const rankOf = new Map(overall.map((r) => [`${r["Ranking Year"]}|${r["Institution"]}`, r["Ranking"]]));
const checkable = overall.filter((r) => r["Ranking (Prev)"] != null && rankOf.has(`${r["Ranking Year"] - 1}|${r["Institution"]}`));
const wrong = checkable.filter((r) => rankOf.get(`${r["Ranking Year"] - 1}|${r["Institution"]}`) !== r["Ranking (Prev)"]);
check("checkable rows", checkable.length, 232);
check("mismatches", wrong.map((r) => `${r["Institution"]} ${r["Ranking Year"]} prev=${r["Ranking (Prev)"]} actual=${rankOf.get(`${r["Ranking Year"] - 1}|${r["Institution"]}`)}`).sort(),
  ["UC Suffolk 2015 prev=31 actual=98", "Leeds Trinity 2014 prev=111 actual=113"].sort());

console.log("\n== DQ3: subject restructure 2014 -> 2015 ==");
const s14 = subjectsByYear(2014), s15 = subjectsByYear(2015), s13 = subjectsByYear(2013);
const ended = s14.filter((s) => !s15.includes(s));
const started = s15.filter((s) => !s14.includes(s));
check("subjects ending after 2014 (count)", ended.length, 7);
console.log("     ", ended);
check("subjects new in 2015 (count)", started.length, 15);
console.log("     ", started);
console.log("     2013 vs 2014 differences:", { only2013: s13.filter((s) => !s14.includes(s)), only2014: s14.filter((s) => !s13.includes(s)) });

console.log("\n== DQ4: 'Computer sciences and IT' in 2015 ==");
const old15 = subject.filter((r) => r["Subject Area Year"] === 2015 && r["Subject Area"] === "Computer sciences and IT");
const new15 = subject.filter((r) => r["Subject Area Year"] === 2015 && r["Subject Area"] === "Computer Science & Information Systems");
check("old-label rows in 2015", old15.map((r) => r["Institution"]), ["Aberdeen", "Abertay Dundee", "Aberystwyth", "Anglia Ruskin", "Aston"]);
check("old-label ranks", old15.map((r) => r["Subject Area Rank"]), old15.map((r) => r["Subject Area Rank"]));
check("new-label rows in 2015", new15.length, 97);
check("institution overlap old/new", old15.filter((o) => new15.some((n) => n["Institution"] === o["Institution"])).length, 0);
const newRanks = new Set(new15.map((r) => r["Subject Area Rank"]));
const maxNew = Math.max(...newRanks);
const gaps = Array.from({ length: maxNew }, (_, i) => i + 1).filter((k) => !newRanks.has(k));
console.log("      gaps in new-label rank list (1..max):", gaps);
console.log("      old-label ranks that fill a gap:", old15.map((r) => r["Subject Area Rank"]).filter((k) => gaps.includes(k)));
console.log("      old-label ranks that collide with an existing rank:", old15.map((r) => r["Subject Area Rank"]).filter((k) => newRanks.has(k)));

console.log("\n== DQ5: institution names ==");
const ovNames = uniq(overall.map((r) => r["Institution"]));
const sbNames = uniq(subject.map((r) => r["Institution"]));
check("distinct institutions overall", ovNames.length, 123);
check("distinct institutions subject", sbNames.length, 173);
console.log("      in overall but not subject:", ovNames.filter((n) => !sbNames.includes(n)));
console.log("      per year overall:", [2013, 2014, 2015].map((y) => uniq(overall.filter((r) => r["Ranking Year"] === y).map((r) => r["Institution"])).length));

console.log("\n== DQ6: ties in subject sheet ==");
const groups = countBy(subject, (r) => `${r["Subject Area Year"]}|${r["Subject Area"]}|${r["Subject Area Rank"]}`);
const tiedGroups = Object.values(groups).filter((n) => n > 1);
console.log(`      rank values shared by 2+ rows: ${tiedGroups.length}; rows involved: ${tiedGroups.reduce((a, b) => a + b, 0)}; extra rows beyond first: ${tiedGroups.reduce((a, b) => a + b - 1, 0)}`);
const ovTies = Object.values(countBy(overall, (r) => `${r["Ranking Year"]}|${r["Ranking"]}`)).filter((n) => n > 1);
console.log(`      overall sheet tied rank values: ${ovTies.length}`);

console.log("\n== DQ9: nulls and zeros ==");
const nulls = (rows: Row[]) => Object.fromEntries(Object.keys(rows[0]).map((k) => [k, rows.filter((r) => r[k] == null).length]).filter(([, n]) => (n as number) > 0));
const zeros = (rows: Row[]) => Object.fromEntries(Object.keys(rows[0]).map((k) => [k, rows.filter((r) => r[k] === 0).length]).filter(([, n]) => (n as number) > 0));
console.log("      overall nulls:", nulls(overall));
console.log("      overall null rows:", overall.filter((r) => Object.entries(r).some(([k, v]) => v == null && !k.includes("Prev") && !k.includes("Change"))).map((r) => `${r["Institution"]} ${r["Ranking Year"]}`));
console.log("      overall zeros (excl. rank change):", Object.fromEntries(Object.entries(zeros(overall)).filter(([k]) => !k.includes("Change"))));
const sn = nulls(subject);
check("subject career prospects nulls", sn["Career prospects"], 1872);
check("subject value added nulls", sn["Value added score/10"], 681);
check("subject expenditure nulls", sn["Expenditure per student (FTE)"], 192);
console.log("      all subject nulls:", sn);
const metricCols = ["Guardian score/100", "% Satisfied with Teaching", "% Satisfied overall with course", "Expenditure per student (FTE)", "Student:staff ratio", "Career prospects", "Value added score/10", "Average Entry Tariff", "% Satisfied with Assessment"];
console.log("      subject zero metric values:", subject.flatMap((r) => metricCols.filter((c) => r[c] === 0).map((c) => `${r["Institution"]} | ${r["Subject Area"]} ${r["Subject Area Year"]} | ${c}`)));

console.log("\n== DQ8: scales ==");
const range = (rows: Row[], c: string) => { const v = rows.map((r) => r[c]).filter((x) => typeof x === "number"); return [Math.min(...v), Math.max(...v), v.every(Number.isInteger) ? "integers" : "decimals"]; };
for (const c of Object.keys(overall[0]).slice(5)) console.log(`      overall ${c}:`, range(overall, c));
for (const c of metricCols) console.log(`      subject ${c}:`, range(subject, c));

console.log("\n== DQ11: Accounting & Finance ==");
const af = subject.filter((r) => r["Subject Area"] === "Accounting & Finance");
check("A&F years", uniq(af.map((r) => r["Subject Area Year"])), [2015]);
const biz15 = new Set(subject.filter((r) => r["Subject Area Year"] === 2015 && r["Subject Area"] === "Business, Management & Marketing").map((r) => r["Institution"]));
check("A&F institutions also in Business 2015", af.filter((r) => biz15.has(r["Institution"])).length, 95);
console.log("      A&F rows:", af.length);

console.log("\n== Subjects by year (for lineage review) ==");
console.log(JSON.stringify({ 2013: s13, 2014: s14, 2015: s15 }, null, 1));

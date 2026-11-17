import { expect, test } from "bun:test";
import { resolve } from "./resolve";

const unis = (q: string) => resolve(q).universities.map((u) => u.id);

test('"ranked last" does not fuzzy-match Newcastle', () => expect(unis("Which university was ranked last in 2014?")).toEqual([]));
test("a short word inside a long name is not a typo match", () => expect(unis("Who came first in 2015?")).toEqual([]));
test("real typos still match", () => expect(unis("Where did Edinbrugh rank in 2015?")).toEqual(["edinburgh"]));
test("Newcastle by name still works", () => expect(unis("How did Newcastle do in 2015?")).toEqual(["newcastle"]));
test("a merged university asked before it existed adds its predecessors and says why", () => {
  const r = resolve("How did South Wales rank in 2013?");
  expect(r.universities.map((u) => u.id)).toEqual(["south_wales", "glamorgan", "newport"]);
  expect(r.universities[0].how).toContain("has no rows in 2013");
});
test("a merged university asked in a year it exists stays itself", () => expect(unis("How did South Wales rank in 2015?")).toEqual(["south_wales"]));

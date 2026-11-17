# GULLY

A chatbot for the Guardian university league tables, 2013–2015.

Live: https://billigence-cs.vercel.app

## How it works

When you ask a question:

1. Code looks for the names in it: universities, subjects, years and metrics. The lists come from `seeds/` and `semantic/`. This is where "Oxbridge" turns into Oxford and Cambridge.
2. If you ask what a metric means, the answer comes straight from `semantic/semantic_layer.yml`. No AI involved.
3. Otherwise the AI (Claude Haiku by default) gets the question, the names it found and a description of the tables. It writes one SQL query, and that's all it does.
4. Code checks the query: one SELECT, only the allowed views and columns, at most 50 rows. Anything else is thrown out. If the check fails, the AI gets one more try.
5. The query runs as a database user that can only read the cleaned views.
6. Code turns the rows into the answer and the chart. The AI never sees the rows.

Open "How I got this" under any answer to see each step.

## Data quality

I checked the data before building anything, because a chatbot on bad data gives confident wrong answers. The main problems I found and fixed:

- The "Ranking Change" column has the opposite sign to what you'd expect. A positive number means the university dropped. The bot uses its own "places climbed" instead.
- Some previous ranks are wrong. UC Suffolk 2015 says 31, but it was 98th in 2014. The bot recalculates them from the previous year.
- Five 2015 Computer Science rows still carry the old subject name. Their scores fit exactly into the new list, so I relabelled them.
- The same university has different names across sheets and years, and Glamorgan and Newport merged into South Wales. All spellings point to one university.
- The subject list changed in 2015 and some subjects were split. The bot warns when a comparison across years isn't like for like.

The original Excel is never changed. Every fix lives in the SQL views in `supabase/migrations/`, and every changed row carries a note saying what changed. 12 issues in total.

## Results

28 test questions with answers written separately, including 5 the bot must refuse.

| Model | Correct answers | Correct refusals | Average time | Cost per question |
|---|---|---|---|---|
| Claude Haiku (default) | 23/23 | 5/5 | ~1.9 s | ~$0.0006 |
| GPT nano | 17/23 | 5/5 | ~1.5 s | ~$0.0007 |

GPT nano never gave a wrong number. When it failed, it refused questions it could have answered. Haiku was more accurate and also cheaper, so it's the default. 28 questions is a small set. It shows the approach works, not that it's perfect.

## Where things are

- `lib/`: the steps above. `ask.ts` runs them in order.
- `semantic/`: the semantic layer and the knowledge graph.
- `supabase/migrations/`: the tables, the cleaned views and the database users.
- `scripts/`: import, checks and the demo.
- `eval/`: the test questions and the grader.
- `app/`, `components/`: the web page.


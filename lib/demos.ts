export type Demo = { label: string; question: string; context?: { year?: number; metricId?: string }; shows: string };

export const DEMOS: Demo[] = [
  { label: "Who ranks 2nd in 2015?", question: "Which university ranks 2nd in 2015?", shows: "rank lookup" },
  { label: "2nd for value added (selected metric)", question: "Which university ranks 2nd in 2015?", context: { metricId: "value_added" }, shows: "selected metric" },
  { label: "What does value added mean?", question: "What does value added mean?", shows: "definition from the YAML, no AI" },
  { label: "How did Oxbridge do in 2015?", question: "How did Oxbridge do in 2015?", shows: "knowledge-graph group" },
  { label: "Best student to staff ratio in 2015", question: "Best student to staff ratio in 2015", shows: "lower is better" },
  { label: "Who improved the most, 2014 → 2015?", question: "Who improved the most between 2014 and 2015?", shows: "places climbed (DQ1)" },
  { label: "How did South Wales rank in 2013?", question: "How did South Wales rank in 2013?", shows: "merger lineage" },
  { label: "Top 5 in Computer Science 2015", question: "Top 5 in Computer Science 2015", shows: "subject + DQ4 relabel" },
  { label: "Which uni has the best nightlife?", question: "Which uni has the best nightlife?", shows: "decline" },
];

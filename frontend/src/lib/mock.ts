"use client";
// In-browser mock backend. Enable with NEXT_PUBLIC_MOCK=1 — patches the exported `api` object and
// replaces window.EventSource so every page (including Mission Control) works with no backend.
// Event JSON shape and ordering mirror backend/app/swarm/orchestrator.py (docs/SPEC.md §5) and are
// applied through the same reducer semantics as src/lib/store.ts.
import { api } from "./api";
import type {
  AgentStep, Approach, Branch, BranchStatus, BurstResult, ChartSpec, ColumnProfile, Dataset, DatasetColumn, DatasetPreview, DB,
  Finding, Health, Hypothesis, LineageNode, MemoryHit, Metrics, QueryResult, Report, Run, RunEvent, RunStatus, RunSummary,
} from "./types";

const FLAG = "__parallaxMockInstalled" as const;
type Cell = string | number | null;

/* ── utilities ─────────────────────────────────────────────────────── */
function rng(seed: number) {
  let s = (seed >>> 0) || 1;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
const pick = <T,>(r: () => number, arr: readonly T[]): T => arr[Math.floor(r() * arr.length)];
const between = (r: () => number, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
const round = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;
const iso = (ms: number) => new Date(ms).toISOString();
const wait = (ms: number) => new Promise<void>((res) => setTimeout(res, ms));
const HOUR = 3_600_000;
function dateStr(r: () => number, year: number) {
  const m = between(r, 1, 12); const d = between(r, 1, 28);
  return `${year}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
function latency(r: () => number) { return round(18 + r() * r() * 160, 1); }

/* ── datasets ──────────────────────────────────────────────────────── */
const col = (name: string, type: string): DatasetColumn => ({ name, type });

const DATASETS: Dataset[] = [
  {
    id: "saas_customers", name: "saas_customers", source: "bundled", rows: 6000,
    description: "6,000 B2B SaaS accounts with plan, seats, MRR, activity, support load, NPS, churn flag and free-text feedback.",
    columns: [col("customer_id", "VARCHAR"), col("company", "VARCHAR"), col("industry", "VARCHAR"), col("region", "VARCHAR"), col("plan", "VARCHAR"), col("seats", "BIGINT"), col("mrr", "DOUBLE"), col("signup_date", "DATE"), col("last_active_date", "DATE"), col("support_tickets_90d", "BIGINT"), col("nps_score", "BIGINT"), col("churned", "BIGINT"), col("churn_reason", "VARCHAR"), col("feedback", "VARCHAR")],
    text_columns: ["feedback", "churn_reason"],
    suggested_questions: ["Why are customers churning and where is revenue at risk?", "Which segments have the best expansion potential?"],
  },
  {
    id: "ecommerce_orders", name: "ecommerce_orders", source: "bundled", rows: 8000,
    description: "8,000 e-commerce orders across US cities with category, pricing, discounts, shipping time, returns, ratings and review text.",
    columns: [col("order_id", "VARCHAR"), col("customer_id", "VARCHAR"), col("order_date", "DATE"), col("city", "VARCHAR"), col("state", "VARCHAR"), col("category", "VARCHAR"), col("product", "VARCHAR"), col("quantity", "BIGINT"), col("unit_price", "DOUBLE"), col("discount_pct", "DOUBLE"), col("shipping_days", "BIGINT"), col("returned", "BIGINT"), col("rating", "BIGINT"), col("review_text", "VARCHAR")],
    text_columns: ["review_text"],
    suggested_questions: ["What drives returns and low ratings?", "Where should we invest marketing next quarter?"],
  },
  {
    id: "sf_airbnb_listings", name: "sf_airbnb_listings", source: "bundled", rows: 7151,
    description: "San Francisco Airbnb listings: neighbourhood, room type, price, minimum nights, reviews, availability and the host's description.",
    columns: [col("id", "BIGINT"), col("name", "VARCHAR"), col("neighbourhood", "VARCHAR"), col("room_type", "VARCHAR"), col("price", "DOUBLE"), col("minimum_nights", "BIGINT"), col("number_of_reviews", "BIGINT"), col("availability_365", "BIGINT"), col("description", "VARCHAR")],
    text_columns: ["description"],
    suggested_questions: ["What makes a listing command a premium price?", "Which neighborhoods are under-supplied for families?"],
  },
];

const COMPANIES = ["Northwind Labs", "Acme Analytics", "Bluefin Systems", "Copperline", "Driftwood Co", "Everfield", "Fathom AI", "Glasswing", "Harbor & Sons", "Ionic Retail", "Juniper Health", "Kestrel Logistics", "Lumen Media", "Meridian Bank", "Nimbus Cloud", "Orchard Foods", "Pinecrest", "Quill Publishing", "Redwood Legal", "Summit Fitness"];
const INDUSTRIES = ["SaaS", "Retail", "Healthcare", "Finance", "Logistics", "Media", "Education", "Hospitality"];
const REGIONS = ["NA", "EMEA", "APAC", "LATAM"];
const PLANS = ["Starter", "Growth", "Business", "Enterprise"];
const CHURN_REASONS = ["Too expensive", "Missing integrations", "Switched to competitor", "Low usage", "Poor support", "Budget cuts"];
const FEEDBACK_POS = [
  "Dashboards are fast and the team adopted it within a week.",
  "Great support — our onboarding call answered everything.",
  "The API is well documented; integrating with our warehouse was painless.",
  "Reliable and predictable pricing. We expanded to two more teams.",
  "Alerts caught a revenue dip before finance noticed. Very happy.",
];
const FEEDBACK_NEG = [
  "The price increase this year was hard to justify to leadership.",
  "Setup was confusing and nobody reached out during onboarding.",
  "We kept hitting bugs in exports and support took days to reply.",
  "Missing the Salesforce integration we needed, so we switched.",
  "Billing surprised us with overage charges we didn't understand.",
];
const CITIES: [string, string][] = [["San Francisco", "CA"], ["Austin", "TX"], ["Seattle", "WA"], ["Denver", "CO"], ["Chicago", "IL"], ["New York", "NY"], ["Miami", "FL"], ["Portland", "OR"]];
const CATEGORIES: Record<string, string[]> = { Electronics: ["Wireless Earbuds", "4K Monitor", "Mechanical Keyboard"], Apparel: ["Merino Hoodie", "Trail Runners", "Rain Shell"], Home: ["Cast Iron Pan", "Standing Desk", "Air Purifier"], Beauty: ["Vitamin C Serum", "Clay Mask"], Sports: ["Yoga Mat", "Kettlebell 16kg"] };
const REVIEWS_GOOD = ["Exactly as described, arrived early.", "Great quality for the price.", "Second purchase — still love it.", "Fits perfectly, fast shipping."];
const REVIEWS_BAD = ["Arrived damaged and the box was crushed.", "Sizing runs small, had to return.", "Took two weeks to ship. Not worth it.", "Stopped working after three days."];
const HOODS = ["Mission", "SoMa", "Noe Valley", "Haight Ashbury", "Marina", "Castro", "Richmond", "Sunset", "Nob Hill", "Bernal Heights"];
const ROOM_TYPES = ["Entire home/apt", "Private room", "Shared room"];
const DESCS = ["Sunny two-bedroom flat with a private deck, steps from cafes and the J line.", "Cozy private room in a Victorian, shared kitchen, great for solo travelers.", "Family-friendly home with crib, high chair and a fenced backyard near Golden Gate Park.", "Designer loft with skyline views, fast wifi and a dedicated workspace.", "Quiet studio, walk to BART, perfect for a work trip."];

function rowFor(ds: Dataset, i: number): Cell[] {
  const r = rng(i * 7919 + ds.id.length * 31);
  switch (ds.id) {
    case "saas_customers": {
      const plan = pick(r, PLANS);
      const seats = plan === "Enterprise" ? between(r, 50, 500) : plan === "Business" ? between(r, 15, 75) : plan === "Growth" ? between(r, 5, 25) : between(r, 1, 6);
      const perSeat = plan === "Enterprise" ? 38 : plan === "Business" ? 29 : plan === "Growth" ? 19 : 12;
      const tickets = between(r, 0, 8);
      const nps = between(r, 0, 10);
      const churnP = 0.08 + (plan === "Starter" ? 0.15 : 0) + tickets * 0.04 + (nps <= 6 ? 0.18 : 0);
      const churned = r() < churnP ? 1 : 0;
      return [`C${10000 + i}`, pick(r, COMPANIES), pick(r, INDUSTRIES), pick(r, REGIONS), plan, seats, round(seats * perSeat, 2), dateStr(r, 2024), dateStr(r, 2026), tickets, nps, churned, churned ? pick(r, CHURN_REASONS) : null, churned ? pick(r, FEEDBACK_NEG) : pick(r, FEEDBACK_POS)];
    }
    case "ecommerce_orders": {
      const [city, state] = pick(r, CITIES);
      const category = pick(r, Object.keys(CATEGORIES));
      const product = pick(r, CATEGORIES[category]);
      const shipping = between(r, 1, 12);
      const returned = r() < 0.09 + shipping * 0.015 ? 1 : 0;
      const rating = returned ? between(r, 1, 3) : between(r, 3, 5);
      return [`O${500000 + i}`, `C${between(r, 1000, 4000)}`, dateStr(r, 2026), city, state, category, product, between(r, 1, 4), round(15 + r() * 400, 2), pick(r, [0, 0, 0, 5, 10, 15, 25]), shipping, returned, rating, rating <= 2 ? pick(r, REVIEWS_BAD) : pick(r, REVIEWS_GOOD)];
    }
    case "sf_airbnb_listings": {
      const room = pick(r, ROOM_TYPES);
      const base = room === "Entire home/apt" ? 220 : room === "Private room" ? 110 : 60;
      return [100000 + i, `${pick(r, ["Sunny", "Cozy", "Modern", "Charming", "Spacious"])} ${room === "Entire home/apt" ? "flat" : "room"} in ${pick(r, HOODS)}`, pick(r, HOODS), room, round(base * (0.6 + r() * 1.4), 0), pick(r, [1, 2, 2, 3, 30]), between(r, 0, 400), between(r, 0, 365), pick(r, DESCS)];
    }
    default:
      return ds.columns.map((c, ci) => {
        const t = c.type.toLowerCase();
        if (/int|double|float|decimal|numeric/.test(t)) return round(r() * 1000, /int/.test(t) ? 0 : 2);
        if (/date/.test(t)) return dateStr(r, 2026);
        return `${c.name}_${(i * 3 + ci) % 17}`;
      });
  }
}

const uploadedRows = new Map<string, Cell[][]>();

function buildPreview(ds: Dataset, limit = 20): DatasetPreview {
  const uploaded = uploadedRows.get(ds.id);
  const sample: Cell[][] = uploaded ?? Array.from({ length: 240 }, (_, i) => rowFor(ds, i));
  const columns = ds.columns.map((c) => c.name);
  const profile: Record<string, ColumnProfile> = {};
  const scale = sample.length ? ds.rows / sample.length : 1;
  columns.forEach((name, ci) => {
    const values = sample.map((r) => r[ci]);
    const nonNull = values.filter((v): v is string | number => v != null);
    const numeric = nonNull.length > 0 && nonNull.every((v) => typeof v === "number");
    const counts = new Map<string, number>();
    for (const v of nonNull) counts.set(String(v), (counts.get(String(v)) ?? 0) + 1);
    const distinct = counts.size;
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([value, count]) => ({ value, count: Math.round(count * scale) }));
    let min: string | number | null = null; let max: string | number | null = null;
    if (numeric) { const nums = nonNull as number[]; min = Math.min(...nums); max = Math.max(...nums); }
    else if (nonNull.length) { const sorted = [...nonNull].map(String).sort(); min = sorted[0]; max = sorted[sorted.length - 1]; }
    profile[name] = {
      type: ds.columns[ci].type,
      nulls: Math.round((values.length - nonNull.length) * scale),
      distinct: distinct >= sample.length * 0.9 ? ds.rows : distinct > 24 ? Math.min(ds.rows, Math.round(distinct * scale)) : distinct,
      min, max,
      top: numeric && distinct > 12 ? [] : top,
    };
  });
  return { columns, rows: sample.slice(0, limit), profile };
}

function parseCsvLine(line: string): string[] {
  const out: string[] = []; let cur = ""; let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) { if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

async function datasetFromFile(file: File): Promise<Dataset> {
  const text = await file.text();
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const header = lines.length ? parseCsvLine(lines[0]).map((h) => h.trim() || "column") : ["column_1"];
  const body = lines.slice(1, 241).map(parseCsvLine);
  const typed: Cell[][] = body.map((r) => r.map((v) => (v === "" ? null : Number.isFinite(Number(v)) && v.trim() !== "" ? Number(v) : v)));
  const columns = header.map((name, ci) => {
    const vals = typed.map((r) => r[ci]).filter((v) => v != null);
    const numeric = vals.length > 0 && vals.every((v) => typeof v === "number");
    const isInt = numeric && vals.every((v) => Number.isInteger(v as number));
    const isDate = !numeric && vals.length > 0 && vals.every((v) => /^\d{4}-\d{2}-\d{2}/.test(String(v)));
    return col(name, numeric ? (isInt ? "BIGINT" : "DOUBLE") : isDate ? "DATE" : "VARCHAR");
  });
  const text_columns = header.filter((_, ci) => columns[ci].type === "VARCHAR" && typed.some((r) => String(r[ci] ?? "").length > 40));
  const id = file.name.replace(/\.csv$/i, "").replace(/[^a-z0-9_]+/gi, "_").toLowerCase() || `upload_${Date.now().toString(36)}`;
  const ds: Dataset = {
    id, name: id, source: "upload", rows: Math.max(0, lines.length - 1), columns, text_columns,
    description: `Uploaded ${file.name} (${(file.size / 1024).toFixed(0)} KB) — ${header.length} columns${text_columns.length ? `, free text in ${text_columns[0]}` : ""}.`,
    suggested_questions: ["What are the strongest patterns in this data?", `What explains the variation in ${columns.find((c) => c.type !== "VARCHAR")?.name ?? header[0]}?`],
  };
  uploadedRows.set(id, typed);
  return ds;
}

/* ── memory ────────────────────────────────────────────────────────── */
const now0 = Date.now();
const MEMORY: MemoryHit[] = [
  { text: "Dataset saas_customers: Q: Why are customers churning? Findings: Starter-plan churn 27% vs 4% Enterprise; 6+ support tickets → 48% churn; pricing/billing complaints dominate churned feedback.", score: 0.92, tags: ["saas_customers", "run:run_demo_churn"], created_at: iso(now0 - 2 * HOUR) },
  { text: "Dataset saas_customers: low NPS (≤6) precedes churn — 41% churn among detractors vs 5% among promoters. EMEA Business accounts carry the most at-risk MRR.", score: 0.88, tags: ["saas_customers", "run:run_demo_churn"], created_at: iso(now0 - 2 * HOUR) },
  { text: "Dataset ecommerce_orders: Q: What drives returns? Findings: shipping over 7 days doubles return rate; Apparel returns 2.3× Electronics; 1–2 star reviews cluster on damage and sizing.", score: 0.81, tags: ["ecommerce_orders", "run:run_demo_returns"], created_at: iso(now0 - 26 * HOUR) },
  { text: "Dataset ecommerce_orders: discounts above 15% do not reduce return rate; they correlate with lower ratings in Beauty.", score: 0.74, tags: ["ecommerce_orders", "run:run_demo_returns"], created_at: iso(now0 - 26 * HOUR) },
  { text: "Dataset sf_airbnb_listings: Q: What makes a listing premium? Findings: entire homes in Marina and Noe Valley command 1.8× median; descriptions mentioning 'view', 'deck' or 'workspace' price 22% higher.", score: 0.79, tags: ["sf_airbnb_listings", "run:run_demo_airbnb"], created_at: iso(now0 - 3 * 24 * HOUR) },
  { text: "Dataset sf_airbnb_listings: family-oriented listings (crib, high chair, backyard) are scarce in Sunset and Richmond relative to demand signals in reviews.", score: 0.7, tags: ["sf_airbnb_listings", "run:run_demo_airbnb"], created_at: iso(now0 - 3 * 24 * HOUR) },
  { text: "Dataset saas_customers: inactivity beyond 45 days is the strongest single churn signal (38% churn vs 9%).", score: 0.86, tags: ["saas_customers", "run:run_demo_churn"], created_at: iso(now0 - 2 * HOUR) },
  { text: "Dataset saas_customers: Retail and Hospitality churn ~1.6× the base rate; Finance and Healthcare are stickiest.", score: 0.66, tags: ["saas_customers", "run:run_demo_churn"], created_at: iso(now0 - 2 * HOUR) },
];

function recallHits(q: string, tags?: string[]): MemoryHit[] {
  const terms = q.toLowerCase().split(/\W+/).filter((t) => t.length > 2);
  return MEMORY
    .filter((m) => !tags?.length || tags.some((t) => m.tags.includes(t)))
    .map((m) => {
      const text = m.text.toLowerCase();
      const overlap = terms.filter((t) => text.includes(t)).length;
      const score = terms.length ? Math.min(0.98, 0.25 + (overlap / terms.length) * 0.7) : m.score;
      return { ...m, score: round(score, 2) };
    })
    .filter((m) => m.score > 0.3)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);
}

/* ── hypothesis templates ──────────────────────────────────────────── */
interface Template {
  title: string; rationale: string; approach: Approach; cols: string[]; sql: string;
  columns: string[]; rows: Cell[][]; claim: string; evidence: string; confidence: number;
  chart?: { type: ChartSpec["type"]; x: string; y: string; title: string }; tags: string[];
}

const SAAS: Template[] = [
  { title: "Churn concentrates in Starter-plan accounts", rationale: "Small accounts have low switching costs; compare churn by plan.", approach: "sql", cols: ["plan", "churned", "mrr"],
    sql: "SELECT plan, COUNT(*) AS customers, ROUND(AVG(churned)*100,1) AS churn_pct, ROUND(SUM(mrr)) AS mrr\nFROM data GROUP BY plan ORDER BY churn_pct DESC",
    columns: ["plan", "customers", "churn_pct", "mrr"], rows: [["Starter", 2310, 27.4, 101640], ["Growth", 1840, 16.9, 228160], ["Business", 1210, 9.8, 301290], ["Enterprise", 640, 4.1, 412480]],
    claim: "Starter accounts churn at 27% — 6.7× the Enterprise rate — yet hold only 10% of MRR.", evidence: "Churn falls monotonically with plan tier: 27.4% → 16.9% → 9.8% → 4.1%. MRR concentration is inverted, so raw churn count overstates revenue risk.", confidence: 0.86, chart: { type: "bar", x: "plan", y: "churn_pct", title: "Churn % by plan" }, tags: ["churn", "plan"] },
  { title: "Support ticket volume is a leading indicator of churn", rationale: "Friction shows up as tickets before it shows up as cancellations.", approach: "sql", cols: ["support_tickets_90d", "churned"],
    sql: "SELECT CASE WHEN support_tickets_90d=0 THEN '0' WHEN support_tickets_90d<=2 THEN '1-2' WHEN support_tickets_90d<=5 THEN '3-5' ELSE '6+' END AS tickets,\n       COUNT(*) AS customers, ROUND(AVG(churned)*100,1) AS churn_pct\nFROM data GROUP BY 1 ORDER BY 1",
    columns: ["tickets", "customers", "churn_pct"], rows: [["0", 2104, 8.2], ["1-2", 2210, 14.6], ["3-5", 1180, 29.3], ["6+", 506, 47.8]],
    claim: "Customers filing 6+ tickets in 90 days churn at 48%, versus 8% for those with none.", evidence: "Churn rises with every ticket band (8.2% → 14.6% → 29.3% → 47.8%); the 3+ band is 28% of accounts but 58% of churn.", confidence: 0.91, chart: { type: "bar", x: "tickets", y: "churn_pct", title: "Churn % by 90-day ticket volume" }, tags: ["churn", "support"] },
  { title: "Negative feedback clusters around pricing and billing", rationale: "Keyword search the free-text feedback for price and billing complaints.", approach: "bm25", cols: ["feedback"],
    sql: "SELECT company, plan, churned, score, feedback\nFROM bm25_search('data','feedback','price increase expensive billing overage invoice',10)\nORDER BY score DESC",
    columns: ["company", "plan", "churned", "score", "feedback"], rows: [["Ionic Retail", "Starter", 1, 8.41, "The price increase this year was hard to justify to leadership."], ["Copperline", "Growth", 1, 7.92, "Billing surprised us with overage charges we didn't understand."], ["Summit Fitness", "Starter", 1, 7.55, "The price increase this year was hard to justify to leadership."], ["Orchard Foods", "Growth", 0, 6.1, "Reliable and predictable pricing. We expanded to two more teams."], ["Lumen Media", "Business", 1, 5.87, "Billing surprised us with overage charges we didn't understand."]],
    claim: "Pricing and billing complaints appear in 31% of churned customers' feedback but only 9% of retained.", evidence: "Top BM25 hits for price/billing terms are 80% churned accounts, concentrated in Starter and Growth plans.", confidence: 0.78, chart: { type: "bar", x: "plan", y: "score", title: "Top pricing complaints by plan" }, tags: ["churn", "pricing", "feedback"] },
  { title: "Onboarding friction is a semantic theme in churned feedback", rationale: "Vector search finds complaints that don't share exact keywords.", approach: "vector", cols: ["feedback"],
    sql: "SELECT company, churned, signup_date, _distance, feedback\nFROM vector_search('data_vec','feedback','hard to get started, confusing setup, nobody helped with onboarding',10)\nORDER BY _distance ASC",
    columns: ["company", "churned", "signup_date", "_distance", "feedback"], rows: [["Glasswing", 1, "2026-04-11", 0.182, "Setup was confusing and nobody reached out during onboarding."], ["Pinecrest", 1, "2026-05-02", 0.191, "Setup was confusing and nobody reached out during onboarding."], ["Nimbus Cloud", 1, "2026-03-20", 0.234, "We kept hitting bugs in exports and support took days to reply."], ["Fathom AI", 0, "2025-11-08", 0.301, "Great support — our onboarding call answered everything."], ["Kestrel Logistics", 1, "2026-06-14", 0.312, "Setup was confusing and nobody reached out during onboarding."]],
    claim: "The nearest neighbours to “confusing setup” are 80% churned and all signed up within the last 6 months.", evidence: "Semantic matches surface onboarding complaints phrased five different ways; the retained match praises an onboarding call — the intervention that's missing elsewhere.", confidence: 0.72, chart: { type: "bar", x: "company", y: "_distance", title: "Closest matches to onboarding friction" }, tags: ["churn", "onboarding", "feedback"] },
  { title: "Revenue at risk is concentrated in EMEA Business accounts", rationale: "Combine churn precursors (low NPS + high tickets) on active accounts and sum MRR.", approach: "sql", cols: ["region", "plan", "mrr", "nps_score", "support_tickets_90d"],
    sql: "SELECT region, plan, COUNT(*) AS at_risk, ROUND(SUM(mrr)) AS mrr_at_risk\nFROM data WHERE churned=0 AND nps_score<=6 AND support_tickets_90d>=3\nGROUP BY region, plan ORDER BY mrr_at_risk DESC LIMIT 8",
    columns: ["region", "plan", "at_risk", "mrr_at_risk"], rows: [["EMEA", "Business", 41, 69840], ["NA", "Enterprise", 9, 41230], ["NA", "Business", 27, 31210], ["APAC", "Business", 18, 20140], ["EMEA", "Growth", 44, 12760], ["LATAM", "Growth", 31, 8930]],
    claim: "$184K MRR sits in 212 active accounts showing churn precursors; EMEA Business alone is 38% of it.", evidence: "Filtering on NPS ≤ 6 and 3+ tickets isolates 212 accounts; EMEA Business has both the highest count and the highest MRR per account among them.", confidence: 0.83, chart: { type: "bar", x: "region", y: "mrr_at_risk", title: "MRR at risk by region" }, tags: ["revenue", "risk", "region"] },
  { title: "Low NPS precedes churn", rationale: "NPS is a survey-based early warning; test how sharply churn rises below 7.", approach: "mixed", cols: ["nps_score", "churned"],
    sql: "SELECT nps_score, COUNT(*) AS customers, ROUND(AVG(churned)*100,1) AS churn_pct\nFROM data GROUP BY nps_score ORDER BY nps_score",
    columns: ["nps_score", "customers", "churn_pct"], rows: [[0, 310, 52.3], [1, 298, 49.7], [2, 355, 46.2], [3, 402, 41.8], [4, 466, 39.1], [5, 590, 36.4], [6, 620, 33.9], [7, 760, 12.1], [8, 802, 8.4], [9, 740, 5.6], [10, 657, 4.7]],
    claim: "Churn is 41% among detractors (NPS ≤ 6) versus 5% among promoters — the cliff is between 6 and 7.", evidence: "Churn declines slowly from 52% at NPS 0 to 34% at NPS 6, then drops to 12% at 7. Detractors are 51% of accounts and 84% of churn.", confidence: 0.88, chart: { type: "line", x: "nps_score", y: "churn_pct", title: "Churn % by NPS" }, tags: ["churn", "nps"] },
  { title: "Inactivity beyond 45 days is the strongest single churn signal", rationale: "Usage recency should dominate survey signals; bucket days since last activity.", approach: "sql", cols: ["last_active_date", "churned"],
    sql: "SELECT CASE WHEN d<=7 THEN '≤7d' WHEN d<=30 THEN '8-30d' WHEN d<=45 THEN '31-45d' ELSE '>45d' END AS inactivity,\n       COUNT(*) AS customers, ROUND(AVG(churned)*100,1) AS churn_pct\nFROM (SELECT churned, DATE_DIFF('day', last_active_date, DATE '2026-09-01') AS d FROM data)\nGROUP BY 1 ORDER BY 1",
    columns: ["inactivity", "customers", "churn_pct"], rows: [["≤7d", 2480, 6.1], ["8-30d", 1760, 11.9], ["31-45d", 690, 21.4], [">45d", 1070, 38.2]],
    claim: "Accounts inactive for more than 45 days churn at 38%, four times the rate of weekly-active accounts.", evidence: "Churn climbs with every inactivity band; the >45d band is 18% of accounts but 39% of churn — a clean trigger for a re-engagement play.", confidence: 0.84, chart: { type: "bar", x: "inactivity", y: "churn_pct", title: "Churn % by inactivity" }, tags: ["churn", "activity"] },
  { title: "Retail and Hospitality churn faster than other industries", rationale: "Vertical fit may explain residual churn after controlling for plan.", approach: "sql", cols: ["industry", "churned"],
    sql: "SELECT industry, COUNT(*) AS customers, ROUND(AVG(churned)*100,1) AS churn_pct\nFROM data GROUP BY industry ORDER BY churn_pct DESC",
    columns: ["industry", "customers", "churn_pct"], rows: [["Retail", 780, 27.9], ["Hospitality", 690, 26.1], ["Media", 720, 19.4], ["Education", 740, 17.8], ["Logistics", 760, 16.2], ["SaaS", 810, 14.9], ["Healthcare", 750, 11.3], ["Finance", 750, 10.6]],
    claim: "Retail and Hospitality churn at ~27%, 1.6× the base rate; Finance and Healthcare are the stickiest verticals.", evidence: "Industry spread is 10.6%–27.9%. Retail and Hospitality also skew Starter, so part of the gap is plan mix rather than vertical fit.", confidence: 0.69, chart: { type: "bar", x: "industry", y: "churn_pct", title: "Churn % by industry" }, tags: ["churn", "industry"] },
];

const ECOM: Template[] = [
  { title: "Slow shipping drives returns", rationale: "Delivery delays sour the experience before the product is even opened.", approach: "sql", cols: ["shipping_days", "returned"],
    sql: "SELECT CASE WHEN shipping_days<=3 THEN '1-3d' WHEN shipping_days<=7 THEN '4-7d' ELSE '8d+' END AS shipping, COUNT(*) AS orders, ROUND(AVG(returned)*100,1) AS return_pct, ROUND(AVG(rating),2) AS avg_rating\nFROM data GROUP BY 1 ORDER BY 1",
    columns: ["shipping", "orders", "return_pct", "avg_rating"], rows: [["1-3d", 2610, 7.4, 4.31], ["4-7d", 3480, 11.9, 4.02], ["8d+", 1910, 22.6, 3.41]],
    claim: "Orders shipping in 8+ days are returned 3× as often as 1–3 day orders and rate nearly a full star lower.", evidence: "Return rate steps from 7.4% to 11.9% to 22.6% across shipping bands; average rating falls from 4.31 to 3.41.", confidence: 0.9, chart: { type: "bar", x: "shipping", y: "return_pct", title: "Return % by shipping time" }, tags: ["returns", "shipping"] },
  { title: "Apparel returns dwarf other categories", rationale: "Fit and sizing issues make apparel structurally return-prone.", approach: "sql", cols: ["category", "returned"],
    sql: "SELECT category, COUNT(*) AS orders, ROUND(AVG(returned)*100,1) AS return_pct\nFROM data GROUP BY category ORDER BY return_pct DESC",
    columns: ["category", "orders", "return_pct"], rows: [["Apparel", 1980, 21.7], ["Beauty", 1120, 12.8], ["Home", 1640, 10.9], ["Sports", 1210, 9.6], ["Electronics", 2050, 9.3]],
    claim: "Apparel is returned at 21.7% — 2.3× Electronics — and accounts for 38% of all returns.", evidence: "Apparel leads every other category by at least 9 points; the rest cluster between 9% and 13%.", confidence: 0.87, chart: { type: "bar", x: "category", y: "return_pct", title: "Return % by category" }, tags: ["returns", "category"] },
  { title: "Low ratings cite damage and sizing", rationale: "Search 1–2 star reviews for recurring complaint themes.", approach: "bm25", cols: ["review_text"],
    sql: "SELECT category, product, rating, score, review_text\nFROM bm25_search('data','review_text','damaged crushed broken small sizing return',10)\nORDER BY score DESC",
    columns: ["category", "product", "rating", "score", "review_text"], rows: [["Electronics", "4K Monitor", 1, 9.1, "Arrived damaged and the box was crushed."], ["Apparel", "Trail Runners", 2, 8.4, "Sizing runs small, had to return."], ["Home", "Air Purifier", 1, 7.9, "Stopped working after three days."], ["Apparel", "Merino Hoodie", 2, 7.7, "Sizing runs small, had to return."]],
    claim: "Two themes explain most 1–2 star reviews: transit damage (Electronics, Home) and sizing (Apparel).", evidence: "Top keyword matches split cleanly by category — damage language on bulky items, sizing language on apparel.", confidence: 0.76, chart: { type: "bar", x: "category", y: "score", title: "Complaint keyword hits by category" }, tags: ["ratings", "reviews"] },
  { title: "Discounts don't buy satisfaction", rationale: "Test whether discounted orders rate or return differently.", approach: "sql", cols: ["discount_pct", "rating", "returned"],
    sql: "SELECT discount_pct, COUNT(*) AS orders, ROUND(AVG(rating),2) AS avg_rating, ROUND(AVG(returned)*100,1) AS return_pct\nFROM data GROUP BY discount_pct ORDER BY discount_pct",
    columns: ["discount_pct", "orders", "avg_rating", "return_pct"], rows: [[0, 3410, 4.05, 12.1], [5, 1120, 4.02, 12.4], [10, 1180, 3.98, 12.9], [15, 1150, 3.91, 13.4], [25, 1140, 3.72, 14.8]],
    claim: "Discounts above 15% correlate with lower ratings (3.72 vs 4.05) and slightly higher returns — they don't offset a poor experience.", evidence: "Both rating and return rate move in the wrong direction as discount rises; the 25% tier is the worst on both.", confidence: 0.71, chart: { type: "line", x: "discount_pct", y: "avg_rating", title: "Average rating by discount" }, tags: ["ratings", "pricing"] },
  { title: "Review sentiment about delivery experience", rationale: "Semantic search for delivery complaints regardless of wording.", approach: "vector", cols: ["review_text"],
    sql: "SELECT city, shipping_days, rating, _distance, review_text\nFROM vector_search('data_vec','review_text','delivery took far too long, package late',10)\nORDER BY _distance ASC",
    columns: ["city", "shipping_days", "rating", "_distance", "review_text"], rows: [["Miami", 11, 2, 0.17, "Took two weeks to ship. Not worth it."], ["Denver", 9, 2, 0.21, "Took two weeks to ship. Not worth it."], ["Chicago", 2, 5, 0.44, "Exactly as described, arrived early."]],
    claim: "Delivery complaints cluster in Miami and Denver, the two cities with the longest median shipping time.", evidence: "Nearest neighbours to “package late” are 9–11 day shipments; the retained positive match is a 2-day order.", confidence: 0.68, chart: { type: "bar", x: "city", y: "shipping_days", title: "Shipping days for delivery complaints" }, tags: ["shipping", "reviews"] },
  { title: "Texas and Florida carry the return burden", rationale: "Geography proxies for carrier performance.", approach: "sql", cols: ["state", "returned", "shipping_days"],
    sql: "SELECT state, COUNT(*) AS orders, ROUND(AVG(shipping_days),1) AS avg_ship_days, ROUND(AVG(returned)*100,1) AS return_pct\nFROM data GROUP BY state ORDER BY return_pct DESC",
    columns: ["state", "orders", "avg_ship_days", "return_pct"], rows: [["FL", 990, 8.1, 18.9], ["TX", 1010, 7.4, 16.2], ["CO", 1020, 6.2, 12.8], ["IL", 980, 5.8, 11.7], ["NY", 1010, 5.1, 10.4], ["CA", 1000, 4.6, 9.8], ["WA", 990, 4.9, 9.7], ["OR", 1000, 5.0, 9.5]],
    claim: "FL and TX orders return at 17–19% versus ~10% on the West Coast, tracking a 3-day gap in shipping time.", evidence: "State-level return rate correlates with average shipping days (r ≈ 0.9 across 8 states).", confidence: 0.8, chart: { type: "bar", x: "state", y: "return_pct", title: "Return % by state" }, tags: ["returns", "geo"] },
];

const AIRBNB: Template[] = [
  { title: "Entire homes in Marina and Noe Valley command the premium", rationale: "Neighbourhood and room type should explain most of the price spread.", approach: "sql", cols: ["neighbourhood", "room_type", "price"],
    sql: "SELECT neighbourhood, ROUND(MEDIAN(price)) AS median_price, COUNT(*) AS listings\nFROM data WHERE room_type='Entire home/apt' GROUP BY neighbourhood ORDER BY median_price DESC LIMIT 8",
    columns: ["neighbourhood", "median_price", "listings"], rows: [["Marina", 389, 214], ["Noe Valley", 352, 301], ["Nob Hill", 331, 268], ["Castro", 298, 322], ["Mission", 262, 611], ["SoMa", 249, 540], ["Sunset", 198, 288], ["Richmond", 187, 240]],
    claim: "Entire homes in Marina and Noe Valley list at 1.8× the city-wide median.", evidence: "Median entire-home price ranges from $187 (Richmond) to $389 (Marina); the top three neighbourhoods are all north-central.", confidence: 0.85, chart: { type: "bar", x: "neighbourhood", y: "median_price", title: "Median price by neighbourhood" }, tags: ["price", "neighbourhood"] },
  { title: "Descriptions that sell views, decks and workspaces price higher", rationale: "Keyword search the description for premium amenities.", approach: "bm25", cols: ["description"],
    sql: "SELECT name, neighbourhood, price, score\nFROM bm25_search('data','description','view deck skyline workspace designer',10)\nORDER BY score DESC",
    columns: ["name", "neighbourhood", "price", "score"], rows: [["Modern flat in Nob Hill", "Nob Hill", 410, 9.3], ["Spacious flat in Marina", "Marina", 395, 8.8], ["Sunny flat in Noe Valley", "Noe Valley", 340, 8.1], ["Charming flat in Mission", "Mission", 290, 7.4]],
    claim: "Listings whose descriptions mention views, decks or a workspace price 22% above comparable listings.", evidence: "Top keyword hits average $359 versus a $294 entire-home median in the same neighbourhoods.", confidence: 0.74, chart: { type: "bar", x: "neighbourhood", y: "price", title: "Price of amenity-rich listings" }, tags: ["price", "description"] },
  { title: "Review volume is a weak price signal", rationale: "Popular listings might charge more — or undercut to stay booked.", approach: "sql", cols: ["number_of_reviews", "price"],
    sql: "SELECT CASE WHEN number_of_reviews=0 THEN '0' WHEN number_of_reviews<25 THEN '1-24' WHEN number_of_reviews<100 THEN '25-99' ELSE '100+' END AS reviews, COUNT(*) AS listings, ROUND(MEDIAN(price)) AS median_price\nFROM data GROUP BY 1 ORDER BY 1",
    columns: ["reviews", "listings", "median_price"], rows: [["0", 1210, 205], ["1-24", 2480, 214], ["25-99", 2160, 221], ["100+", 1301, 209]],
    claim: "Median price barely moves with review count ($205–$221) — popularity is not where the premium comes from.", evidence: "All four review bands sit within 8% of each other; the 100+ band is slightly cheaper than 25–99.", confidence: 0.77, chart: { type: "bar", x: "reviews", y: "median_price", title: "Median price by review count" }, tags: ["price", "reviews"] },
  { title: "Family-friendly supply is thin in Sunset and Richmond", rationale: "Semantic search for family amenities, then compare against neighbourhood supply.", approach: "vector", cols: ["description"],
    sql: "SELECT neighbourhood, COUNT(*) AS family_listings, ROUND(AVG(_distance),3) AS avg_distance\nFROM vector_search('data_vec','description','family friendly with crib, high chair and backyard',60)\nGROUP BY neighbourhood ORDER BY family_listings DESC",
    columns: ["neighbourhood", "family_listings", "avg_distance"], rows: [["Noe Valley", 14, 0.21], ["Bernal Heights", 11, 0.23], ["Mission", 9, 0.27], ["Sunset", 4, 0.29], ["Richmond", 3, 0.3]],
    claim: "Only 7 of the 60 most family-oriented listings are in Sunset or Richmond despite those being the largest residential neighbourhoods.", evidence: "Family amenity matches concentrate in Noe Valley and Bernal Heights; Sunset and Richmond are under-represented relative to their share of total listings.", confidence: 0.66, chart: { type: "bar", x: "neighbourhood", y: "family_listings", title: "Family-oriented listings by neighbourhood" }, tags: ["supply", "families"] },
  { title: "Minimum-night rules split the market", rationale: "30-night minimums signal mid-term rentals with different pricing.", approach: "sql", cols: ["minimum_nights", "price", "availability_365"],
    sql: "SELECT CASE WHEN minimum_nights>=30 THEN '30+' WHEN minimum_nights>=7 THEN '7-29' ELSE '1-6' END AS min_nights, COUNT(*) AS listings, ROUND(MEDIAN(price)) AS median_price, ROUND(AVG(availability_365)) AS avg_avail\nFROM data GROUP BY 1 ORDER BY 1",
    columns: ["min_nights", "listings", "median_price", "avg_avail"], rows: [["1-6", 4820, 231, 148], ["30+", 1890, 168, 240], ["7-29", 441, 204, 171]],
    claim: "30+ night listings are 26% of supply and price 27% below short-stay listings while sitting open 92 more days a year.", evidence: "Median price: $231 (1–6 nights) vs $168 (30+); availability 148 vs 240 days.", confidence: 0.82, chart: { type: "bar", x: "min_nights", y: "median_price", title: "Median price by minimum nights" }, tags: ["price", "supply"] },
  { title: "Private rooms are priced on neighbourhood, not on size", rationale: "Check whether the neighbourhood premium holds for private rooms.", approach: "sql", cols: ["room_type", "neighbourhood", "price"],
    sql: "SELECT neighbourhood, ROUND(MEDIAN(price)) AS median_price, COUNT(*) AS listings\nFROM data WHERE room_type='Private room' GROUP BY neighbourhood ORDER BY median_price DESC LIMIT 6",
    columns: ["neighbourhood", "median_price", "listings"], rows: [["Marina", 158, 62], ["Nob Hill", 149, 91], ["Noe Valley", 141, 88], ["Castro", 132, 120], ["Mission", 118, 240], ["Sunset", 96, 130]],
    claim: "The neighbourhood ranking for private rooms mirrors entire homes almost exactly — location is the premium, room type sets the scale.", evidence: "Spearman rank correlation between entire-home and private-room neighbourhood medians is 0.94.", confidence: 0.73, chart: { type: "bar", x: "neighbourhood", y: "median_price", title: "Private room median price" }, tags: ["price", "neighbourhood"] },
];

function genericTemplates(ds: Dataset): Template[] {
  const numeric = ds.columns.filter((c) => /int|double|float|decimal|numeric/i.test(c.type)).map((c) => c.name);
  const categorical = ds.columns.filter((c) => /char|text|string/i.test(c.type) && !ds.text_columns.includes(c.name)).map((c) => c.name);
  const text = ds.text_columns[0];
  const preview = buildPreview(ds, 6);
  const out: Template[] = [];
  const cat = categorical[0] ?? ds.columns[0].name;
  const num = numeric[0] ?? ds.columns[ds.columns.length - 1].name;
  const catIdx = preview.columns.indexOf(cat);
  const rows: Cell[][] = preview.rows.slice(0, 5).map((r, i) => [r[catIdx] ?? `group_${i}`, 120 - i * 17, round(40 + i * 11.5, 1)]);
  out.push({ title: `Distribution of ${cat} explains variation in ${num}`, rationale: `Group by ${cat} and compare ${num}.`, approach: "sql", cols: [cat, num],
    sql: `SELECT ${cat}, COUNT(*) AS n, ROUND(AVG(${num}),1) AS avg_${num}\nFROM data GROUP BY 1 ORDER BY n DESC LIMIT 10`, columns: [cat, "n", `avg_${num}`], rows,
    claim: `${cat} segments differ by ${Math.round(((rows[rows.length - 1]?.[2] as number) / (rows[0]?.[2] as number) - 1) * 100)}% in average ${num}.`, evidence: `Top ${rows.length} groups by count show a monotonic spread in ${num}.`, confidence: 0.7, chart: { type: "bar", x: cat, y: `avg_${num}`, title: `Average ${num} by ${cat}` }, tags: [cat, num] });
  if (numeric.length > 1) {
    const n2 = numeric[1];
    out.push({ title: `${num} and ${n2} move together`, rationale: `Bucket ${num} and inspect ${n2}.`, approach: "sql", cols: [num, n2],
      sql: `SELECT NTILE(4) OVER (ORDER BY ${num}) AS quartile, ROUND(AVG(${n2}),2) AS avg_${n2}\nFROM data GROUP BY 1 ORDER BY 1`, columns: ["quartile", `avg_${n2}`], rows: [[1, 12.4], [2, 18.9], [3, 27.3], [4, 41.6]],
      claim: `The top quartile of ${num} has 3.4× the ${n2} of the bottom quartile.`, evidence: "Quartile averages rise monotonically.", confidence: 0.68, chart: { type: "line", x: "quartile", y: `avg_${n2}`, title: `${n2} by ${num} quartile` }, tags: [num, n2] });
  }
  if (text) {
    out.push({ title: `Recurring themes in ${text}`, rationale: `Keyword search ${text} for the most frequent complaint and praise terms.`, approach: "bm25", cols: [text],
      sql: `SELECT score, ${text} FROM bm25_search('data','${text}','issue problem great love',10) ORDER BY score DESC`, columns: ["score", text], rows: preview.rows.slice(0, 4).map((r, i) => [round(9 - i * 0.8, 2), r[preview.columns.indexOf(text)]]),
      claim: `Free text in ${text} splits into a clear positive and negative cluster.`, evidence: "Top BM25 hits separate cleanly by sentiment terms.", confidence: 0.62, chart: { type: "bar", x: text, y: "score", title: `Top ${text} matches` }, tags: [text] });
    out.push({ title: `Semantic neighbours of the question in ${text}`, rationale: `Vector search ${text} using the question itself.`, approach: "vector", cols: [text],
      sql: `SELECT _distance, ${text} FROM vector_search('data_vec','${text}','<question>',10) ORDER BY _distance ASC`, columns: ["_distance", text], rows: preview.rows.slice(0, 4).map((r, i) => [round(0.18 + i * 0.06, 3), r[preview.columns.indexOf(text)]]),
      claim: `The closest ${text} entries to the question share a single underlying theme.`, evidence: "Nearest neighbours cluster within 0.25 cosine distance.", confidence: 0.6, chart: { type: "bar", x: text, y: "_distance", title: "Nearest neighbours" }, tags: [text] });
  }
  if (categorical.length > 1) {
    const c2 = categorical[1];
    out.push({ title: `${c2} modulates the ${cat} effect`, rationale: `Cross-tab ${cat} × ${c2}.`, approach: "mixed", cols: [cat, c2, num],
      sql: `SELECT ${cat}, ${c2}, COUNT(*) AS n, ROUND(AVG(${num}),1) AS avg_${num}\nFROM data GROUP BY 1,2 ORDER BY n DESC LIMIT 12`, columns: [cat, c2, "n", `avg_${num}`], rows: rows.slice(0, 4).map((r, i) => [r[0], `${c2}_${i}`, (r[1] as number) - 30, r[2]]),
      claim: `The ${cat} spread persists within every ${c2} — it is not a composition effect.`, evidence: "Within-group ordering matches the overall ordering.", confidence: 0.64, chart: { type: "bar", x: cat, y: `avg_${num}`, title: `${num} by ${cat} within ${c2}` }, tags: [cat, c2] });
  }
  return out;
}

function templatesFor(ds: Dataset, agents: number): Template[] {
  const base = ds.id === "saas_customers" ? SAAS : ds.id === "ecommerce_orders" ? ECOM : ds.id === "sf_airbnb_listings" ? AIRBNB : genericTemplates(ds);
  const out: Template[] = [];
  for (let i = 0; i < agents; i++) {
    const t = base[i % base.length];
    if (i < base.length) { out.push(t); continue; }
    const k = Math.floor(i / base.length);
    const cohort = REGIONS[(k - 1) % REGIONS.length];
    out.push({ ...t, title: `${t.title} — ${cohort} cohort`, rationale: `Replicate the “${t.title}” analysis restricted to ${cohort}.`, sql: t.sql.replace(/FROM data(?![_\w])/, `FROM data WHERE region = '${cohort}'`), claim: `Replicated in ${cohort}: ${t.claim}`, confidence: round(Math.max(0.4, t.confidence - 0.12 * k), 2), tags: [...t.tags, cohort.toLowerCase()] });
  }
  return out;
}

/* ── run construction ──────────────────────────────────────────────── */
interface Scheduled { at: number; ev: Omit<RunEvent, "ts"> }
interface MockRun { final: Run; current: Run; ds: Dataset; timeline: Scheduled[]; startedAt: number | null; totalMs: number }

const runs = new Map<string, MockRun>();
const health: Health = {
  ok: true, version: "0.1.0-mock",
  data: { mode: "auto", kind: "local", detail: "DuckDB (mock)" },
  llm: { chain: ["fake"], active: "fake", detail: "FakeLLM" },
  memory: { kind: "local", detail: "JSON + hashed embeddings" },
  rocketride: { configured: false, reachable: false, uri: null, cloud: false },
  hotdata: { configured: false, reachable: false },
  cognee: { configured: false, active: false },
};

function emptyMetrics(startedAt: string): Metrics {
  return { databases_created: 0, forks: 0, queries: 0, peak_concurrency: 0, p50_ms: 0, p95_ms: 0, llm_calls: 0, llm_calls_by_provider: {}, started_at: startedAt, finished_at: null, elapsed_ms: null, time_to_first_finding_ms: null, burst: null };
}

function buildReport(ds: Dataset, question: string, branches: Branch[], plan: Hypothesis[]): Report {
  const hypo = (b: Branch) => plan.find((h) => h.id === b.hypothesis_id)?.title ?? b.hypothesis_id;
  const done = branches.filter((b) => b.finding).sort((a, b) => (b.finding!.confidence - a.finding!.confidence));
  const key = done.map((b) => ({ claim: b.finding!.claim, confidence: b.finding!.confidence, branch_id: b.id }));
  const top = done.slice(0, 3).map((b) => b.finding!.claim);
  const summary = `Across ${branches.length} parallel branches, the evidence converges on three drivers: ${top.map((t, i) => `(${i + 1}) ${t.replace(/\.$/, "")}`).join("; ")}. ${done.length >= 4 ? `${done.length - 3} further branches add supporting context.` : ""}`.trim();
  const next = ds.id === "saas_customers"
    ? ["Which retention offers moved churn in the Starter cohort last quarter?", "Does ticket volume predict churn earlier than NPS, or are they the same accounts?", "What share of EMEA Business at-risk MRR renews in the next 90 days?"]
    : ds.id === "ecommerce_orders"
      ? ["Which carriers serve FL/TX and how do their SLAs differ?", "Would size guides reduce Apparel returns measurably?", "Is the discount–rating link causal or a clearance-stock artefact?"]
      : ["How does price elasticity differ between Marina and Mission?", "Which amenities in descriptions are under-priced relative to demand?", "Do 30+ night listings convert if repriced toward short-stay levels?"];
  const md = [
    `# ${question}`,
    "",
    "## Executive summary",
    "",
    summary,
    "",
    "## Key findings",
    "",
    ...done.map((b, i) => `${i + 1}. **${b.finding!.claim}** — ${b.finding!.evidence} [branch:${b.id}]`),
    "",
    "## Evidence by branch",
    "",
    ...done.flatMap((b) => [
      `### ${hypo(b)}`,
      "",
      b.finding!.evidence,
      "",
      "```sql",
      b.finding!.supporting_sql[0] ?? "",
      "```",
      "",
      `_Confidence ${(b.finding!.confidence * 100).toFixed(0)}%_ [branch:${b.id}]`,
      "",
    ]),
    "## Recommended next questions",
    "",
    ...next.map((q) => `- ${q}`),
    "",
  ].join("\n");
  return {
    title: question,
    executive_summary: summary,
    markdown: md,
    key_findings: key,
    next_questions: next,
    citations: done.map((b) => ({ branch_id: b.id, hypothesis: hypo(b) })),
  };
}

function buildRun(id: string, ds: Dataset, question: string, agents: number, createdAt: number, fail?: string): MockRun {
  const r = rng(id.split("").reduce((a, c) => a + c.charCodeAt(0), 0));
  const created = iso(createdAt);
  const root: DB = { id: `db_${id}_root`, name: `parallax-${id}`, parent_id: null, created_at: created, expires_at: iso(createdAt + 24 * HOUR), connection_id: "conn_default" };
  const templates = templatesFor(ds, agents);
  const plan: Hypothesis[] = templates.map((t, i) => ({ id: `h${i + 1}`, title: t.title, rationale: t.rationale, approach: t.approach, target_columns: t.cols }));
  const branches: Branch[] = templates.map((t, i) => {
    const bid = `b${i + 1}`;
    const kind = t.approach === "mixed" ? "sql" : t.approach;
    const elapsed = latency(r);
    const result: QueryResult = { columns: t.columns, rows: t.rows, row_count: t.rows.length, elapsed_ms: elapsed, truncated: false, sql: t.sql };
    const steps: AgentStep[] = [
      { n: 1, kind: "think", text: `Hypothesis: ${t.title}. ${t.rationale} I'll start with a ${kind.toUpperCase()} pass over ${t.cols.join(", ")}.`, provider: "fake" },
      { n: 2, kind, text: kind === "sql" ? "Querying the branch database." : kind === "bm25" ? `Keyword (BM25) search over ${t.cols[0]}.` : `Vector search over ${t.cols[0]}.`, sql: t.sql, result, elapsed_ms: elapsed, provider: "fake" },
      { n: 3, kind: "observe", text: `Observed ${t.rows.length} rows in ${elapsed} ms. ${t.evidence}`, provider: "fake" },
      { n: 4, kind: "finding", text: t.claim, provider: "fake" },
    ];
    const chart: ChartSpec | null = t.chart ? { type: t.chart.type, title: t.chart.title, x: t.chart.x, y: t.chart.y, data: t.rows.map((row) => Object.fromEntries(t.columns.map((c, ci) => [c, row[ci]]))) } : null;
    const finding: Finding = { claim: t.claim, evidence: t.evidence, confidence: t.confidence, supporting_sql: [t.sql], chart, tags: t.tags };
    const db: DB = { id: `db_${id}_${bid}`, name: `parallax-${id}-${bid}`, parent_id: root.id, created_at: created, expires_at: root.expires_at, connection_id: "conn_default" };
    return { id: bid, hypothesis_id: `h${i + 1}`, db, status: "done" as BranchStatus, steps, finding };
  });
  const recalled = recallHits(question, [ds.id]).slice(0, 3);
  const report = buildReport(ds, question, branches, plan);
  const modes: Run["modes"] = { data: "local", llm: "fake", memory: "local" };
  const skeleton: Run = {
    id, created_at: created, status: "queued", dataset_id: ds.id, dataset_name: ds.name, question, agents, modes,
    root_db: null, branches: [], recalled: [], plan: [], report: null, metrics: emptyMetrics(created), error: null,
  };

  /* timeline */
  const tl: Scheduled[] = [];
  const push = (at: number, type: RunEvent["type"], payload: Record<string, unknown>, branch_id?: string) => tl.push({ at, ev: { type, run_id: id, branch_id: branch_id ?? null, payload } });
  let queries = 3; let forks = 0; let llm = 0; let inflight = 0; let peak = 0; let firstFinding: number | null = null;
  const lat: number[] = [24, 31, 19];
  const metrics = (at: number, finished = false): Metrics => {
    const sorted = [...lat].sort((a, b) => a - b);
    const q = (p: number) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] : 0;
    return { databases_created: 1 + forks, forks, queries, peak_concurrency: peak, p50_ms: round(q(0.5), 1), p95_ms: round(q(0.95), 1), llm_calls: llm, llm_calls_by_provider: llm ? { fake: llm } : {}, started_at: created, finished_at: finished ? iso(createdAt + at) : null, elapsed_ms: at, time_to_first_finding_ms: firstFinding, burst: null };
  };
  push(300, "run.status", { status: "provisioning" });
  push(1200, "db.created", { db: root });
  push(1500, "metrics.update", { metrics: metrics(1500) });
  push(1800, "run.status", { status: "planning" });
  push(2400, "run.recalled", { hits: recalled });
  llm += 1;
  push(3600, "run.plan", { hypotheses: plan, branches: branches.map((b) => ({ ...b, db: null, status: "forking" as BranchStatus, steps: [], finding: null })) });
  push(3900, "run.status", { status: "exploring" });
  const forkGap = agents > 8 ? 140 : 220;
  branches.forEach((b, i) => {
    const at = 4000 + i * forkGap;
    forks += 1; queries += 1; lat.push(latency(r));
    push(at, "db.forked", { db: b.db, parent_id: root.id, branch_id: b.id, hypothesis_id: b.hypothesis_id }, b.id);
  });
  let lastDone = 0;
  branches.forEach((b, i) => {
    const base = 4000 + agents * forkGap + 600 + i * (agents > 8 ? 120 : 240) + Math.floor(r() * 500);
    const gaps = [0, 1900 + Math.floor(r() * 900), 3300 + Math.floor(r() * 900), 4700 + Math.floor(r() * 1100)];
    inflight += 1; peak = Math.max(peak, inflight);
    b.steps.forEach((s, k) => {
      const at = base + gaps[k];
      if (s.kind === "think" || s.kind === "finding") llm += 1;
      if (s.result) { queries += 1; lat.push(s.result.elapsed_ms); }
      push(at, "agent.step", { step: s }, b.id);
    });
    const doneAt = base + gaps[3] + 120;
    if (firstFinding === null || doneAt < firstFinding) firstFinding = doneAt;
    push(doneAt, "agent.finding", { finding: b.finding }, b.id);
    push(doneAt + 80, "branch.status", { status: "done" }, b.id);
    inflight -= 1;
    lastDone = Math.max(lastDone, doneAt + 80);
  });
  for (let t = 5500; t < lastDone; t += 2000) push(t, "metrics.update", { metrics: metrics(t) });
  let end: number;
  if (fail) {
    const failAt = 4000 + agents * forkGap + 2600;
    end = failAt + 200;
    push(failAt, "run.error", { message: fail });
    push(end, "run.finished", {});
  } else {
    const synthAt = lastDone + 500;
    llm += 1;
    push(synthAt, "run.status", { status: "synthesizing" });
    push(synthAt + 3200, "report.ready", { report });
    push(synthAt + 3900, "memory.remembered", { n: 1 });
    end = synthAt + 4300;
    push(end, "metrics.update", { metrics: metrics(end, true) });
    push(end + 100, "run.status", { status: "done" });
    push(end + 400, "run.finished", {});
    end += 400;
  }
  tl.sort((a, b) => a.at - b.at);

  // authoritative final snapshot
  const final: Run = fail
    ? { ...skeleton, status: "failed", error: fail, root_db: root, plan, recalled, branches: branches.map((b) => ({ ...b, status: "failed" as BranchStatus, steps: b.steps.slice(0, 1), finding: null })), metrics: { ...metrics(end), finished_at: iso(createdAt + end) } }
    : { ...skeleton, status: "done", root_db: root, plan, recalled, branches, report, metrics: metrics(end, true) };

  return { final, current: skeleton, ds, timeline: tl, startedAt: null, totalMs: end };
}

/* ── reducer (mirrors src/lib/store.ts applyEvent) ─────────────────── */
function reduce(run: Run, ev: Omit<RunEvent, "ts">): Run {
  const p = ev.payload as Record<string, unknown>;
  const withBranch = (id: string, fn: (b: Branch) => Branch): Run => ({ ...run, branches: run.branches.map((b) => (b.id === id ? fn(b) : b)) });
  switch (ev.type) {
    case "run.status": return { ...run, status: p.status as RunStatus };
    case "run.recalled": return { ...run, recalled: (p.hits as MemoryHit[]) ?? [] };
    case "run.plan": return { ...run, plan: (p.hypotheses as Hypothesis[]) ?? [], branches: (p.branches as Branch[]) ?? run.branches };
    case "db.created": return { ...run, root_db: p.db as DB };
    case "db.forked": {
      const bid = (ev.branch_id ?? (p.branch_id as string)) as string;
      if (run.branches.some((b) => b.id === bid)) return withBranch(bid, (b) => ({ ...b, db: p.db as DB, status: "exploring" }));
      return { ...run, branches: [...run.branches, { id: bid, hypothesis_id: (p.hypothesis_id as string) ?? "", db: p.db as DB, status: "exploring", steps: [], finding: null }] };
    }
    case "agent.step": {
      const step = p.step as AgentStep;
      return withBranch(ev.branch_id as string, (b) => (b.steps.some((s) => s.n === step.n) ? { ...b, steps: b.steps.map((s) => (s.n === step.n ? step : s)) } : { ...b, steps: [...b.steps, step] }));
    }
    case "agent.finding": return withBranch(ev.branch_id as string, (b) => ({ ...b, finding: p.finding as Finding }));
    case "branch.status": return withBranch(ev.branch_id as string, (b) => ({ ...b, status: p.status as BranchStatus }));
    case "metrics.update": return { ...run, metrics: { ...run.metrics, ...(p.metrics as Metrics) } };
    case "report.ready": return { ...run, report: p.report as Report };
    case "run.error": return { ...run, status: "failed", error: (p.message as string) ?? "Unknown error", branches: run.branches.map((b) => (b.status === "done" ? b : { ...b, status: "failed" as BranchStatus })) };
    case "run.finished": return { ...run, status: run.status === "failed" ? "failed" : "done" };
    default: return run;
  }
}

function startSimulation(m: MockRun) {
  if (m.startedAt !== null) return;
  m.startedAt = Date.now();
  for (const s of m.timeline) setTimeout(() => { m.current = reduce(m.current, s.ev); }, s.at);
}

function seedDemoRun(id: string, dsId: string, question: string, agents: number, ageMs: number, fail?: string) {
  const ds = DATASETS.find((d) => d.id === dsId)!;
  const m = buildRun(id, ds, question, agents, Date.now() - ageMs, fail);
  m.current = m.final;
  m.startedAt = Date.now() - ageMs; // everything already due → instant replay
  runs.set(id, m);
}

function ensureRun(id: string): MockRun {
  let m = runs.get(id);
  if (!m) {
    const ds = DATASETS[0];
    m = buildRun(id, ds, ds.suggested_questions[0], 6, Date.now());
    runs.set(id, m);
    startSimulation(m);
  }
  return m;
}

function summary(m: MockRun): RunSummary {
  const c = m.current;
  return { id: c.id, created_at: c.created_at, status: c.status, dataset_name: c.dataset_name, question: c.question, agents: c.agents, elapsed_ms: c.metrics.elapsed_ms, p50_ms: c.metrics.p50_ms || null, queries: c.metrics.queries, modes: c.modes };
}

/* ── EventSource replacement ───────────────────────────────────────── */
const EVENTS_RE = /\/api\/runs\/([^/?#]+)\/events(?:[?#].*)?$/;

function makeMockEventSource(Native: typeof EventSource | undefined) {
  class MockEventSource extends EventTarget {
    static readonly CONNECTING = 0; static readonly OPEN = 1; static readonly CLOSED = 2;
    readonly CONNECTING = 0; readonly OPEN = 1; readonly CLOSED = 2;
    url = "";
    readonly withCredentials = false;
    readyState = 0;
    onopen: ((ev: Event) => void) | null = null;
    onmessage: ((ev: MessageEvent) => void) | null = null;
    onerror: ((ev: Event) => void) | null = null;
    private timers: ReturnType<typeof setTimeout>[] = [];

    constructor(url: string | URL, init?: EventSourceInit) {
      super();
      const href = String(url);
      const match = EVENTS_RE.exec(href);
      if (!match) {
        if (Native) return new Native(href, init) as unknown as MockEventSource;
        throw new Error(`Mock EventSource: unsupported URL ${href}`);
      }
      this.url = href;
      const m = ensureRun(decodeURIComponent(match[1]));
      startSimulation(m);
      const elapsed = Date.now() - (m.startedAt ?? Date.now());
      this.timers.push(setTimeout(() => {
        this.readyState = 1;
        const e = new Event("open");
        this.onopen?.(e); this.dispatchEvent(e);
      }, 15));
      const due = m.timeline.filter((s) => s.at <= elapsed);
      const pending = m.timeline.filter((s) => s.at > elapsed);
      due.forEach((s, k) => this.timers.push(setTimeout(() => this.emit(s, m), 30 + k * 8)));
      const floor = 30 + due.length * 8;
      pending.forEach((s) => this.timers.push(setTimeout(() => this.emit(s, m), Math.max(floor, s.at - elapsed))));
    }

    private emit(s: Scheduled, m: MockRun) {
      if (this.readyState === 2) return;
      const data = JSON.stringify({ ts: iso((m.startedAt ?? Date.now()) + s.at), ...s.ev });
      const e = new MessageEvent("message", { data });
      this.onmessage?.(e); this.dispatchEvent(e);
      if (s.ev.type === "run.finished") this.close();
    }

    close() {
      this.readyState = 2;
      for (const t of this.timers) clearTimeout(t);
      this.timers = [];
    }
  }
  return MockEventSource;
}

/* ── install ───────────────────────────────────────────────────────── */
export function installMock(): void {
  if (typeof window === "undefined") return;
  const g = globalThis as unknown as Record<string, unknown>;
  if (g[FLAG]) return;
  g[FLAG] = true;

  seedDemoRun("run_demo_churn", "saas_customers", "Why are customers churning and where is revenue at risk?", 6, 2 * HOUR);
  seedDemoRun("run_demo_returns", "ecommerce_orders", "What drives returns and low ratings?", 8, 26 * HOUR);
  seedDemoRun("run_demo_airbnb", "sf_airbnb_listings", "What makes a listing command a premium price?", 4, 3 * 24 * HOUR);
  seedDemoRun("run_demo_failed", "saas_customers", "Which segments have the best expansion potential?", 6, 5 * HOUR, "LLM provider timed out after 3 retries (fake provider forced failure for demo)");

  const datasets: Dataset[] = [...DATASETS];
  const jitter = () => 180 + Math.random() * 320;

  const mock: Partial<typeof api> = {
    health: async () => { await wait(120 + Math.random() * 120); return { ...health }; },
    datasets: async () => { await wait(jitter()); return datasets.map((d) => ({ ...d })); },
    datasetPreview: async (id: string, limit = 20) => {
      await wait(jitter());
      const ds = datasets.find((d) => d.id === id);
      if (!ds) throw new Error(`Dataset ${id} not found`);
      return buildPreview(ds, limit);
    },
    uploadDataset: async (file: File) => {
      await wait(900 + Math.random() * 600);
      const ds = await datasetFromFile(file);
      const idx = datasets.findIndex((d) => d.id === ds.id);
      if (idx >= 0) datasets.splice(idx, 1);
      datasets.unshift(ds);
      return ds;
    },
    createRun: async (body) => {
      await wait(jitter());
      const ds = datasets.find((d) => d.id === body.dataset_id);
      if (!ds) throw new Error(`Dataset ${body.dataset_id} not found`);
      if (!body.question?.trim()) throw new Error("question is required");
      const agents = Math.max(2, Math.min(16, Math.round(body.agents || 6)));
      const id = `run_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
      const m = buildRun(id, ds, body.question.trim(), agents, Date.now());
      runs.set(id, m);
      startSimulation(m);
      return { run_id: id };
    },
    runs: async () => {
      await wait(jitter());
      return [...runs.values()].map(summary).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
    },
    run: async (id: string) => { await wait(120 + Math.random() * 120); return structuredClone(ensureRun(id).current); },
    deleteRun: async (id: string) => { await wait(jitter()); runs.delete(id); return { ok: true }; },
    query: async (id: string, branch_id: string, sql: string) => {
      const m = ensureRun(id);
      const start = performance.now();
      await wait(20 + Math.random() * 90);
      const s = sql.trim().replace(/;+$/, "");
      if (!/^(select|with)\b/i.test(s)) throw new Error("Only SELECT / WITH statements are allowed");
      const b = m.current.branches.find((x) => x.id === branch_id);
      const stepResult = b?.steps.find((x) => x.result)?.result;
      if (/count\(\*\)/i.test(s) && !/group by/i.test(s)) return { columns: ["count"], rows: [[m.ds.rows]], row_count: 1, elapsed_ms: round(performance.now() - start, 1), truncated: false, sql: s };
      if (stepResult && /group by|bm25_search|vector_search/i.test(s)) return { ...stepResult, elapsed_ms: round(performance.now() - start, 1), sql: s };
      const preview = buildPreview(m.ds, 200);
      const limit = Number(/limit\s+(\d+)/i.exec(s)?.[1] ?? 200);
      const rows = preview.rows.slice(0, Math.min(limit, 200));
      return { columns: preview.columns, rows, row_count: rows.length, elapsed_ms: round(performance.now() - start, 1), truncated: m.ds.rows > rows.length, sql: s };
    },
    search: async (id: string, _branch_id: string, kind: "bm25" | "vector", q: string, k = 10) => {
      const m = ensureRun(id);
      const start = performance.now();
      await wait(40 + Math.random() * 120);
      const text = m.ds.text_columns[0];
      if (!text) throw new Error("Dataset has no text column to search");
      const preview = buildPreview(m.ds, 60);
      const ti = preview.columns.indexOf(text);
      const rows = preview.rows.slice(0, k).map((r, i) => (kind === "bm25" ? [r[0], round(9.5 - i * 0.6, 2), r[ti]] : [r[0], round(0.12 + i * 0.045, 3), r[ti]]));
      return { columns: [preview.columns[0], kind === "bm25" ? "score" : "_distance", text], rows, row_count: rows.length, elapsed_ms: round(performance.now() - start, 1), truncated: false, sql: `SELECT ... FROM ${kind}_search('data','${text}','${q.replace(/'/g, "''")}',${k})` };
    },
    lineage: async (id: string): Promise<LineageNode[]> => {
      await wait(jitter());
      const c = ensureRun(id).current;
      const nodes: LineageNode[] = [];
      if (c.root_db) nodes.push({ id: c.root_db.id, name: c.root_db.name, parent_id: null, created_at: c.root_db.created_at, exists: true });
      for (const b of c.branches) if (b.db) nodes.push({ id: b.db.id, name: b.db.name, parent_id: b.db.parent_id, created_at: b.db.created_at, exists: true });
      return nodes;
    },
    burst: async (id: string, queries = 100): Promise<BurstResult> => {
      const m = ensureRun(id);
      const n = Math.max(10, Math.min(200, queries));
      await wait(600 + n * 6);
      const r = rng(n * 17 + m.current.branches.length);
      const per = Array.from({ length: n }, () => round(14 + r() * r() * 190 + (r() < 0.04 ? 220 : 0), 1));
      const sorted = [...per].sort((a, b) => a - b);
      const res: BurstResult = { count: n, p50_ms: sorted[Math.floor(n * 0.5)], p95_ms: sorted[Math.floor(n * 0.95)], max_ms: sorted[n - 1], total_ms: round(Math.max(...per) * 1.15, 1), per_query: per, concurrency: Math.max(1, m.current.branches.length) };
      m.current = { ...m.current, metrics: { ...m.current.metrics, burst: res, queries: m.current.metrics.queries + n } };
      return res;
    },
    reportUrl: (id: string) => {
      const md = runs.get(id)?.current.report?.markdown ?? `# Report not ready\n\nRun ${id} has no report yet.`;
      return URL.createObjectURL(new Blob([md], { type: "text/markdown" }));
    },
    memory: async () => {
      await wait(jitter());
      return { kind: "local", stats: { count: MEMORY.length + Math.max(0, runs.size - 4), tags: 7, runs: runs.size }, recent: MEMORY.slice(0, 6) };
    },
    recall: async (q: string, tags?: string[]) => { await wait(jitter()); return recallHits(q, tags); },
  };
  Object.assign(api, mock);

  const Native = (globalThis as { EventSource?: typeof EventSource }).EventSource;
  (globalThis as { EventSource: unknown }).EventSource = makeMockEventSource(Native);
  console.info("%c[parallax] mock mode — no backend required (NEXT_PUBLIC_MOCK=1)", "color:#22d3ee");
}

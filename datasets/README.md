# Parallax bundled datasets

Three CSVs (each under 3 MB) registered in `registry.json` and served by the backend as `source: "bundled"`.
Regenerate everything with `make datasets` (`scripts/generate_datasets.py` + `scripts/fetch_datasets.py`).

| id | file | rows | size | kind | text column(s) |
|---|---|---:|---:|---|---|
| `saas_customers` | `saas_customers.csv` | 6,000 | ~0.9 MB | synthetic, seeded (`default_rng(42)`) | `feedback`, `churn_reason` |
| `ecommerce_orders` | `ecommerce_orders.csv` | 8,000 | ~1.0 MB | synthetic, seeded | `review_text` |
| `sf_airbnb_listings` | `sf_airbnb_listings.csv` | 6,102 | ~2.9 MB | **real** (hotdata.dev mirror of Inside Airbnb), price modelled | `description`, `name` |

The synthetic sets are deliberately *correlated* so a hypothesis-driven analyst can find real signal with SQL,
BM25 and vector search. The exact effect sizes printed by the generator (seed 42) are listed below so demos and
tests can assert against them.

## saas_customers.csv

| column | type | description |
|---|---|---|
| `customer_id` | text | `C00001` … `C06000` |
| `company` | text | Synthetic company name |
| `industry` | text | SaaS, Fintech, Retail, Healthcare, Education, Manufacturing, Media, Logistics |
| `region` | text | NA (45 %), EMEA (30 %), APAC (17 %), LATAM (8 %) |
| `plan` | text | Starter (46 %), Growth (36 %), Enterprise (18 %) |
| `seats` | int | Starter 1–15, Growth 8–80, Enterprise 40–500 |
| `mrr` | decimal | Plan price × seats (29 / 59 / 99 per seat, volume discount above 30 and 100 seats) |
| `signup_date` | date | 2023-01-01 … 2026-06-30 |
| `last_active_date` | date | Relative to 2026-08-31; churned accounts went quiet 30–240 days ago, ~12 % of active accounts are 21–90 days inactive (at risk) |
| `support_tickets_90d` | int | Poisson; higher for Starter, Retail and a latent "frustration" factor |
| `nps_score` | int 0–10 | Falls with tickets and frustration |
| `churned` | 0/1 | Overall **17.9 %** |
| `churn_reason` | text, empty when active | Vocabulary of 10 reasons, weighted by the real driver (tickets → support/reliability, Starter+low NPS → price, Enterprise → features/integrations, Retail → budget) |
| `feedback` | text | 1–2 sentences from ~40 fragments per sentiment bucket (negative ≤ 6, neutral 7–8, positive 9–10) across pricing / support / onboarding / integrations / reliability / features, aligned with `nps_score` and `churn_reason` |

Built-in signal (seed 42): churn by plan Enterprise 7.0 % / Growth 14.0 % / Starter 25.3 %; Retail 27.5 % vs
16.1 % elsewhere; `support_tickets_90d ≥ 4` → 44.8 % vs `< 2` → 8.4 %; EMEA slightly above other regions.

## ecommerce_orders.csv

| column | type | description |
|---|---|---|
| `order_id` | text | `O100001` … ordered by date |
| `customer_id` | text | `U10000` … `U13499` (repeat buyers) |
| `order_date` | date | 2025-01-01 … 2026-08-31 |
| `city`, `state` | text | 32 real US cities, population-weighted |
| `category` | text | Apparel, Electronics, Home & Kitchen, Beauty, Sports & Outdoors, Toys & Games |
| `product` | text | 43 products with a base price and a latent quality score |
| `quantity` | int 1–5 | Geometric |
| `unit_price` | decimal | Base price ± 5 % |
| `discount_pct` | int | 0 / 10 / 15 / 20 / 25 / 30 / 40 / 50; deeper in Apparel and in Nov–Dec |
| `shipping_days` | int 1–14 | Depends on state (fulfilment in CA/TX/OH/PA; AK/HI slow), holidays, Apparel |
| `returned` | 0/1 | Overall **11.3 %** |
| `rating` | int 1–5 | Product quality − shipping delay − Apparel fit − deep discount + noise (mean 3.92) |
| `review_text` | text | Category-specific fragments by rating bucket, plus shipping remarks when slow/fast and "returned it" when returned |

Built-in signal (seed 42): returns Apparel 23.0 % vs 7.1 %; `shipping_days > 5` → 20.2 % vs 9.5 %;
`discount_pct > 30` → 25.8 %; low ratings strongly predict returns.

## sf_airbnb_listings.csv

Source: `https://hotdata.dev/data/sf-airbnb-listings.parquet` (7,535 listings × 85 columns, the Inside Airbnb
San Francisco schema), fetched by `scripts/fetch_datasets.py`, trimmed to 6,102 rows so the CSV stays under 3 MB
(descriptions are ~440 characters each, truncated at 600). All columns are real **except `price`** — the scrape
ships `price` and `estimated_revenue_l365d` entirely NULL, so the script models a nightly rate from the listing's
real attributes (room type, neighbourhood, capacity, bedrooms, review score; seeded noise). Treat price analyses
as illustrative. If a future scrape carries prices the script uses them automatically. On any download failure a
3,000-row synthetic stand-in with the same columns and real SF neighbourhood names is written instead.

| column | type | description |
|---|---|---|
| `id` | int | Airbnb listing id |
| `name` | text | Listing title |
| `neighbourhood` | text | `neighbourhood_cleansed` — 37 official SF neighbourhoods (Downtown/Civic Center, South of Market, Mission, Western Addition, …) |
| `room_type` | text | Entire home/apt (62 %), Private room (34 %), Hotel room, Shared room |
| `price` | int | Nightly rate in USD — **modelled** (see above); medians ≈ 370 entire home, 132 private room |
| `minimum_nights` | int | Many listings are 30+ nights (SF short-term-rental rules) |
| `number_of_reviews` | int | Lifetime reviews |
| `availability_365` | int | Days available in the next year |
| `description` | text | Listing description, HTML stripped, ≤ 600 chars |
| `accommodates` | int | Guest capacity |
| `bedrooms` | float, nullable | Bedrooms (382 nulls) |
| `review_scores_rating` | float, nullable | Overall rating 0–5 (990 nulls: unreviewed listings) |

## registry.json

```json
{ "datasets": [ { "id", "name", "description", "file", "text_columns": [...], "suggested_questions": [3] } ] }
```

The backend reads it at startup (`backend/app/datasets.py`), resolves `file` relative to this directory and
profiles columns on the fly, so adding a dataset is: drop the CSV here, add an entry, restart.

## Uploads

User uploads (`POST /api/datasets/upload`, CSV ≤ 25 MB) live under `.parallax/uploads/`, never here.

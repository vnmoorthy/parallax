#!/usr/bin/env python3
"""Generate Parallax's bundled synthetic datasets (docs/SPEC.md section 8).

    python scripts/generate_datasets.py            # writes datasets/saas_customers.csv + ecommerce_orders.csv
    python scripts/generate_datasets.py --out DIR  # elsewhere

Deterministic (numpy default_rng(42)). The data is deliberately *correlated* so that a hypothesis-driven
analyst can discover real signal:

saas_customers.csv (6,000 rows)
    churn probability rises with support_tickets_90d, low nps_score, plan "Starter", industry "Retail",
    long inactivity (old last_active_date) and, slightly, region "EMEA". mrr = plan price x seats.
    churn_reason (vocabulary) only when churned; feedback is 1-2 sentences built from ~40 fragments per
    sentiment bucket across pricing / support / onboarding / integrations / reliability / features,
    consistent with nps_score and churn_reason.

ecommerce_orders.csv (8,000 rows)
    returned probability rises with shipping_days > 5, category "Apparel", discount_pct > 30 and low rating.
    rating depends on product quality, category and shipping delay. review_text is consistent with the
    rating and the return. Real US cities/states; ~42 products across 6 categories; dates 2025-2026.
"""
from __future__ import annotations

import argparse
from datetime import date, timedelta
from pathlib import Path

import numpy as np
import pandas as pd

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_OUT = REPO_ROOT / "datasets"
SEED = 42
REF_DATE = date(2026, 8, 31)  # "today" for the synthetic world
MAX_BYTES = 3 * 1024 * 1024


def sigmoid(x):
    return 1.0 / (1.0 + np.exp(-x))


# ─────────────────────────────────────────────────────────────────────────────
# SaaS customers
# ─────────────────────────────────────────────────────────────────────────────
INDUSTRIES = ["SaaS", "Fintech", "Retail", "Healthcare", "Education", "Manufacturing", "Media", "Logistics"]
INDUSTRY_W = [0.22, 0.14, 0.16, 0.12, 0.09, 0.10, 0.08, 0.09]
REGIONS = ["NA", "EMEA", "APAC", "LATAM"]
REGION_W = [0.45, 0.30, 0.17, 0.08]
PLANS = ["Starter", "Growth", "Enterprise"]
PLAN_W = [0.46, 0.36, 0.18]
PLAN_PRICE = {"Starter": 29.0, "Growth": 59.0, "Enterprise": 99.0}

COMPANY_A = ["Northwind", "Bluepeak", "Harbor", "Summit", "Lumen", "Cobalt", "Evergreen", "Quantum", "Atlas", "Vertex",
             "Nimbus", "Redwood", "Ironclad", "Solstice", "Pioneer", "Beacon", "Cascade", "Orbit", "Meridian", "Granite",
             "Keystone", "Halcyon", "Brightline", "Falcon", "Sable", "Tidewater", "Copperfield", "Windmill", "Silverlake",
             "Foxglove", "Juniper", "Oakridge", "Riverbend", "Stellar", "Crescent", "Mosaic", "Ember", "Frontier", "Zenith",
             "Aurora"]
COMPANY_B = ["Labs", "Systems", "Analytics", "Retail", "Health", "Logistics", "Media", "Capital", "Learning", "Works",
             "Dynamics", "Software", "Studio", "Foods", "Supply", "Robotics", "Networks", "Partners", "Digital", "Group"]
COMPANY_SFX = ["", "", "", " Inc", " Ltd", " Co", " GmbH", " LLC"]

CHURN_REASONS = ["Too expensive", "Switched to competitor", "Missing features", "Poor support experience",
                 "Low usage / no longer needed", "Onboarding too complex", "Integration gaps", "Reliability issues",
                 "Company downsized", "Budget cuts"]
REASON_TOPIC = {"Too expensive": "pricing", "Switched to competitor": "features", "Missing features": "features",
                "Poor support experience": "support", "Low usage / no longer needed": "onboarding",
                "Onboarding too complex": "onboarding", "Integration gaps": "integrations",
                "Reliability issues": "reliability", "Company downsized": "pricing", "Budget cuts": "pricing"}
TOPICS = ["pricing", "support", "onboarding", "integrations", "reliability", "features"]

# ~40+ fragments per sentiment bucket (7 per topic), plus generic second sentences.
FEEDBACK = {
    "negative": {
        "pricing": ["The price per seat is hard to justify for a team our size.",
                    "Pricing jumped at renewal and nobody warned us.",
                    "We pay for features we never use; the plan tiers make no sense.",
                    "Too expensive compared with the alternatives we evaluated.",
                    "The per-seat model punishes us every time we onboard a contractor.",
                    "Our budget was cut and the platform was the first thing to go.",
                    "Overage charges were a nasty surprise on the invoice."],
        "support": ["Support tickets sit for days before anyone replies.",
                    "We opened four tickets for the same bug and got four different answers.",
                    "The support team is friendly but never actually fixes anything.",
                    "Escalations go nowhere; we had to chase our account manager repeatedly.",
                    "Response times got noticeably worse over the last quarter.",
                    "Chat support only sends links to docs we have already read.",
                    "No phone support and email replies take forever."],
        "onboarding": ["Onboarding was confusing and we never really got set up properly.",
                       "It took weeks to import our data and the docs were out of date.",
                       "Half the team stopped logging in after the first month.",
                       "The setup wizard failed twice and we gave up on the advanced features.",
                       "We were never shown how to use the reporting module.",
                       "Adoption stalled because the learning curve is steep.",
                       "Honestly we barely used it; it never became part of our workflow."],
        "integrations": ["The Salesforce integration breaks every other week.",
                         "No native Slack or HubSpot connector, so we had to build our own.",
                         "The API is rate limited so aggressively that our sync jobs fail nightly.",
                         "Webhook payloads changed without notice and broke our pipeline.",
                         "We could not connect it to our data warehouse without a consultant.",
                         "SSO setup with Okta took three support tickets to get working.",
                         "Zapier is the only integration path and it is flaky."],
        "reliability": ["We had three outages in one month during peak hours.",
                        "Dashboards time out constantly when we filter more than a few weeks.",
                        "Exports randomly fail with no error message.",
                        "The mobile app crashes whenever we open a large report.",
                        "Data was missing for two days and nobody told us why.",
                        "Performance degraded badly as our dataset grew.",
                        "Frequent logouts and stale sessions made it unusable for the field team."],
        "features": ["Missing basic features like bulk edit and custom roles.",
                     "A competitor offered everything we needed at a lower price, so we switched.",
                     "The roadmap items we were promised never shipped.",
                     "Reporting is too rigid; we ended up exporting to spreadsheets anyway.",
                     "No audit log, which our compliance team requires.",
                     "The forecasting module is too simplistic for our use case.",
                     "We outgrew the product; it is fine for small teams but not for us."],
    },
    "neutral": {
        "pricing": ["Pricing is fair but the Growth tier is a big jump from Starter.",
                    "Decent value, though we keep an eye on seat costs.",
                    "Would like more flexible billing for seasonal staff.",
                    "The annual discount helped, monthly pricing feels steep.",
                    "We are on the fence at renewal because of the price increase.",
                    "Costs are acceptable for what we use today.",
                    "Would prefer usage-based pricing over per-seat."],
        "support": ["Support is okay, sometimes quick, sometimes slow.",
                    "Tickets get resolved eventually but it takes follow-ups.",
                    "The help center is good; live support is average.",
                    "Our account manager is responsive, tier-1 support less so.",
                    "Support quality varies a lot depending on who picks up the ticket.",
                    "Would like faster responses on weekends.",
                    "Fine for simple questions, weaker on technical issues."],
        "onboarding": ["Onboarding was fine but could use more templates.",
                       "Setup took longer than expected, mostly on our side.",
                       "The tutorials are helpful; the data import could be smoother.",
                       "We are still ramping up usage across the team.",
                       "Most of the team uses it weekly, a few power users daily.",
                       "Documentation is solid but a guided setup call would have helped.",
                       "It does the job; adoption is growing slowly."],
        "integrations": ["Integrations cover the basics; we still miss a native Jira connector.",
                         "The API works but the docs could be clearer.",
                         "The Slack integration is handy, the HubSpot one is limited.",
                         "We sync with our warehouse nightly and it mostly works.",
                         "Would love a two-way calendar sync.",
                         "Setup for SSO was fiddly but works now.",
                         "Good enough integration options for our stack."],
        "reliability": ["Mostly stable, with the occasional slow dashboard.",
                        "One outage this quarter, communicated well.",
                        "Reports are a bit slow at month end.",
                        "Reliable overall, exports could be faster.",
                        "Uptime is fine; performance on large filters could improve.",
                        "The mobile app lags behind the web app.",
                        "No major issues, some minor bugs here and there."],
        "features": ["Covers our core needs; advanced reporting is limited.",
                     "Good product, waiting on the custom fields feature.",
                     "Does what it says, nothing spectacular.",
                     "We like the dashboards but want more automation.",
                     "Solid basics, some rough edges in the admin console.",
                     "Useful tool; the roadmap looks promising.",
                     "Feature set is competitive but not best in class."],
    },
    "positive": {
        "pricing": ["Great value for the price, especially on the annual plan.",
                    "Pricing is transparent and scales sensibly with our team.",
                    "Cheaper than what we replaced and far more capable.",
                    "The Enterprise plan pays for itself in saved hours.",
                    "Fair pricing and no surprise fees.",
                    "Easily worth the seat cost given the time saved.",
                    "Budget approval was easy because the ROI is obvious."],
        "support": ["Support is outstanding, replies within the hour.",
                    "Our account manager proactively checks in every month.",
                    "Every ticket we raised was resolved the same day.",
                    "The support team clearly knows the product inside out.",
                    "Fast, friendly and technically sharp support.",
                    "Best customer success team we have worked with.",
                    "Support even helped us design our dashboards."],
        "onboarding": ["Onboarding was smooth and the whole team was productive in a week.",
                       "Great templates got us started immediately.",
                       "The guided setup made data import painless.",
                       "Adoption was instant; people actually enjoy using it.",
                       "Excellent documentation and training videos.",
                       "We were live in two days, which is unheard of for us.",
                       "It became part of our daily workflow almost immediately."],
        "integrations": ["The Salesforce and Slack integrations work flawlessly.",
                         "The API is clean and well documented; we automated everything.",
                         "Connected to Snowflake in an afternoon.",
                         "Webhooks are reliable and easy to configure.",
                         "SSO and SCIM provisioning worked out of the box.",
                         "Plays nicely with every tool in our stack.",
                         "The HubSpot sync saved us hours every week."],
        "reliability": ["Rock solid, we have never seen an outage.",
                        "Dashboards load instantly even on huge datasets.",
                        "Reliable exports and fast reports every time.",
                        "The platform is fast and stable; no complaints.",
                        "Uptime has been perfect for as long as we have used it.",
                        "Performance is excellent even at month-end peaks.",
                        "The mobile app is snappy and dependable."],
        "features": ["The reporting and forecasting features are exactly what we needed.",
                     "Custom roles and audit logs made our compliance team happy.",
                     "Automation rules removed a ton of manual work.",
                     "Feature releases ship every month and they listen to feedback.",
                     "Best-in-class dashboards, our execs love them.",
                     "Powerful yet simple; it grows with us.",
                     "We expanded to two more teams because it works so well."],
    },
}
SECOND = {
    "negative": ["We are evaluating alternatives.", "Would not recommend at this point.", "Frustrating overall.",
                 "It has been a disappointing year.", "Renewal is unlikely.", ""],
    "neutral": ["Overall it is fine.", "Happy enough to stay for now.", "Some room for improvement.",
                "We will see how the next release goes.", "", ""],
    "positive": ["Highly recommended.", "We plan to add more seats next quarter.", "Keep up the great work.",
                 "Would buy again without hesitation.", "", ""],
}


def gen_saas(rng: np.random.Generator, n: int = 6000) -> pd.DataFrame:
    industry = rng.choice(INDUSTRIES, n, p=INDUSTRY_W)
    region = rng.choice(REGIONS, n, p=REGION_W)
    plan = rng.choice(PLANS, n, p=PLAN_W)

    seats = np.empty(n, dtype=int)
    for p_name, lo, hi, mode in (("Starter", 1, 15, 4), ("Growth", 8, 80, 22), ("Enterprise", 40, 500, 120)):
        m = plan == p_name
        seats[m] = np.clip(rng.triangular(lo, mode, hi, m.sum()).round(), lo, hi)
    price = np.vectorize(PLAN_PRICE.get)(plan)
    vol_disc = np.where(seats > 100, 0.85, np.where(seats > 30, 0.93, 1.0))
    mrr = np.round(price * seats * vol_disc * rng.normal(1.0, 0.04, n), 2)

    start, end = date(2023, 1, 1), date(2026, 6, 30)
    signup = np.array([start + timedelta(days=int(d)) for d in rng.integers(0, (end - start).days, n)])
    tenure_days = np.array([(REF_DATE - s).days for s in signup])

    # latent frustration drives tickets, nps and churn together
    frustration = rng.normal(0, 1, n)
    ticket_rate = np.exp(0.35 + 0.55 * frustration + 0.35 * (plan == "Starter") + 0.30 * (industry == "Retail")
                         - 0.25 * (plan == "Enterprise"))
    tickets = rng.poisson(ticket_rate)
    nps = np.clip(np.round(7.6 - 0.45 * tickets - 0.9 * frustration + rng.normal(0, 1.2, n)), 0, 10).astype(int)

    logit = (-2.35 + 0.20 * tickets + 0.32 * np.maximum(0, 6 - nps) - 0.20 * np.maximum(0, nps - 8)
             + 0.65 * (plan == "Starter") - 0.55 * (plan == "Enterprise") + 0.60 * (industry == "Retail")
             + 0.22 * (region == "EMEA") + 0.35 * frustration - 0.0006 * np.minimum(tenure_days, 900))
    churned = (rng.random(n) < sigmoid(logit)).astype(int)

    # inactivity: churned customers went quiet 30-240 days ago; a slice of active customers are at risk
    days_inactive = np.where(churned == 1, rng.integers(30, 240, n),
                             np.where(rng.random(n) < 0.12, rng.integers(21, 90, n), rng.integers(0, 21, n)))
    days_inactive = np.minimum(days_inactive, np.maximum(tenure_days - 1, 0))
    last_active = np.array([REF_DATE - timedelta(days=int(d)) for d in days_inactive])

    # churn reasons weighted by the actual driver
    reasons = []
    for i in range(n):
        if not churned[i]:
            reasons.append("")
            continue
        w = np.ones(len(CHURN_REASONS))
        if tickets[i] >= 4:
            w[CHURN_REASONS.index("Poor support experience")] += 4
            w[CHURN_REASONS.index("Reliability issues")] += 2.5
        if nps[i] <= 4 and plan[i] == "Starter":
            w[CHURN_REASONS.index("Too expensive")] += 3
        if plan[i] == "Enterprise":
            w[CHURN_REASONS.index("Missing features")] += 3
            w[CHURN_REASONS.index("Integration gaps")] += 2.5
        if industry[i] == "Retail":
            w[CHURN_REASONS.index("Budget cuts")] += 3
            w[CHURN_REASONS.index("Company downsized")] += 2
        if days_inactive[i] > 120:
            w[CHURN_REASONS.index("Low usage / no longer needed")] += 3
            w[CHURN_REASONS.index("Onboarding too complex")] += 1.5
        if nps[i] >= 7:
            w[CHURN_REASONS.index("Switched to competitor")] += 1.5
        reasons.append(rng.choice(CHURN_REASONS, p=w / w.sum()))

    feedback = []
    for i in range(n):
        bucket = "negative" if nps[i] <= 6 else ("neutral" if nps[i] <= 8 else "positive")
        if churned[i]:
            topic = REASON_TOPIC[reasons[i]] if rng.random() < 0.8 else rng.choice(TOPICS)
            if nps[i] >= 7 and rng.random() < 0.5:
                bucket = "neutral"
        else:
            tw = np.ones(len(TOPICS))
            if tickets[i] >= 3:
                tw[TOPICS.index("support")] += 3
                tw[TOPICS.index("reliability")] += 1.5
            topic = rng.choice(TOPICS, p=tw / tw.sum())
        s1 = rng.choice(FEEDBACK[bucket][topic])
        s2 = rng.choice(SECOND[bucket]) if rng.random() < 0.6 else ""
        feedback.append((s1 + " " + s2).strip())

    ids = rng.permutation(n)
    company = [f"{COMPANY_A[i % 40]} {COMPANY_B[(i // 40) % 20]}{COMPANY_SFX[(i // 800) % 8]}" for i in ids]
    return pd.DataFrame({
        "customer_id": [f"C{i + 1:05d}" for i in range(n)],
        "company": company,
        "industry": industry,
        "region": region,
        "plan": plan,
        "seats": seats,
        "mrr": mrr,
        "signup_date": [d.isoformat() for d in signup],
        "last_active_date": [d.isoformat() for d in last_active],
        "support_tickets_90d": tickets,
        "nps_score": nps,
        "churned": churned,
        "churn_reason": reasons,
        "feedback": feedback,
    })


# ─────────────────────────────────────────────────────────────────────────────
# E-commerce orders
# ─────────────────────────────────────────────────────────────────────────────
CITIES = [("New York", "NY", 8.3), ("Los Angeles", "CA", 3.9), ("Chicago", "IL", 2.7), ("Houston", "TX", 2.3),
          ("Phoenix", "AZ", 1.6), ("Philadelphia", "PA", 1.6), ("San Antonio", "TX", 1.5), ("San Diego", "CA", 1.4),
          ("Dallas", "TX", 1.3), ("San Jose", "CA", 1.0), ("Austin", "TX", 1.0), ("Jacksonville", "FL", 0.95),
          ("Columbus", "OH", 0.9), ("Charlotte", "NC", 0.9), ("San Francisco", "CA", 0.85), ("Indianapolis", "IN", 0.88),
          ("Seattle", "WA", 0.75), ("Denver", "CO", 0.72), ("Boston", "MA", 0.68), ("Nashville", "TN", 0.69),
          ("Portland", "OR", 0.65), ("Las Vegas", "NV", 0.64), ("Detroit", "MI", 0.64), ("Memphis", "TN", 0.63),
          ("Atlanta", "GA", 0.5), ("Miami", "FL", 0.45), ("Minneapolis", "MN", 0.43), ("Salt Lake City", "UT", 0.2),
          ("Anchorage", "AK", 0.29), ("Honolulu", "HI", 0.35), ("Boise", "ID", 0.24), ("Omaha", "NE", 0.49)]
# shipping baseline by state: fulfilment centres in CA / TX / OH / PA
STATE_SHIP = {"CA": 2.0, "TX": 2.2, "OH": 2.3, "PA": 2.4, "NY": 2.8, "IL": 2.7, "AZ": 2.9, "NV": 3.0, "FL": 3.3,
              "GA": 3.1, "NC": 3.2, "IN": 2.8, "TN": 3.0, "MI": 3.1, "WA": 3.4, "OR": 3.3, "CO": 3.2, "MA": 3.3,
              "MN": 3.4, "UT": 3.3, "NE": 3.3, "ID": 3.5, "AK": 6.0, "HI": 6.5}

CATALOG = {
    "Apparel": [("Classic Denim Jacket", 79, 3.9), ("Merino Wool Sweater", 95, 4.1), ("Slim Fit Chinos", 59, 3.6),
                ("Running Tights", 48, 3.7), ("Linen Summer Dress", 69, 3.8), ("Graphic Cotton Tee", 24, 3.9),
                ("Waterproof Rain Shell", 129, 4.0), ("Leather Ankle Boots", 149, 3.7)],
    "Electronics": [("Wireless Earbuds Pro", 129, 4.2), ("4K Streaming Stick", 49, 4.4), ("Mechanical Keyboard", 109, 4.3),
                    ("Portable Power Bank 20k", 39, 4.1), ("Smart Home Speaker", 89, 4.0), ("Noise-Cancelling Headphones", 249, 4.5),
                    ("Action Camera Mini", 199, 3.8)],
    "Home & Kitchen": [("Cast Iron Skillet", 45, 4.6), ("Cold Brew Coffee Maker", 35, 4.3), ("Air Fryer 5qt", 99, 4.4),
                       ("Bamboo Cutting Board Set", 29, 4.5), ("Weighted Blanket", 79, 4.2), ("Robot Vacuum", 279, 3.9),
                       ("Ceramic Dinnerware Set", 89, 4.1)],
    "Beauty": [("Vitamin C Serum", 32, 4.2), ("Hydrating Face Mask Pack", 18, 4.3), ("Electric Toothbrush", 69, 4.4),
               ("Hair Dryer Ionic", 59, 4.0), ("Mineral Sunscreen SPF50", 22, 4.1), ("Beard Grooming Kit", 34, 4.3),
               ("Nail Polish Gift Set", 26, 3.9)],
    "Sports & Outdoors": [("Yoga Mat Premium", 42, 4.5), ("Insulated Water Bottle 32oz", 29, 4.6), ("Camping Tent 2P", 139, 4.1),
                          ("Adjustable Dumbbells", 249, 4.3), ("Trail Running Shoes", 119, 4.0), ("Foam Roller", 25, 4.4),
                          ("Cycling Helmet", 65, 4.2)],
    "Toys & Games": [("Building Blocks 500pc", 39, 4.6), ("Strategy Board Game", 45, 4.5), ("Remote Control Car", 59, 3.8),
                     ("Plush Dinosaur", 19, 4.7), ("STEM Robotics Kit", 89, 4.2), ("1000-piece Jigsaw Puzzle", 22, 4.4),
                     ("Kids Art Easel", 69, 4.1)],
}
DISCOUNTS = np.array([0, 10, 15, 20, 25, 30, 40, 50])

REVIEW = {
    "bad": {
        "Apparel": ["Runs two sizes small and the stitching came apart after one wash.", "Fabric feels cheap and the color faded immediately.",
                    "Fit was completely off; sent it back.", "Nothing like the photos, thin and see-through.",
                    "Zipper broke the second time I wore it.", "Sizing chart is useless, way too tight in the shoulders."],
        "Electronics": ["Stopped charging after a week.", "Bluetooth drops every few minutes, unusable.",
                        "Arrived with a cracked screen and no protective packaging.", "Battery life is a fraction of what was advertised.",
                        "Firmware is buggy and support was no help.", "Dead on arrival."],
        "Home & Kitchen": ["Cracked on first use.", "Smells of chemicals and the coating peeled off.",
                           "Much smaller than described.", "Lid does not seal, leaked all over the counter.",
                           "Motor burned out within a month.", "Poor build quality for the price."],
        "Beauty": ["Broke me out badly.", "Arrived leaking and half empty.", "Strong artificial smell, could not use it.",
                   "Did nothing after four weeks.", "Packaging was damaged and the pump does not work.", "Not the shade shown online."],
        "Sports & Outdoors": ["Seams split on the first outing.", "Leaks and the paint chipped right away.",
                              "Poles bent in light wind.", "Strap broke after two workouts.", "Far too heavy for the trail.",
                              "Sizing is wrong and it gave me blisters."],
        "Toys & Games": ["Pieces missing from the box.", "Broke within a day, my kid was so disappointed.",
                         "Battery compartment is flimsy and stopped working.", "Not age appropriate, too complicated.",
                         "Smells like plastic fumes.", "Instructions are wrong and parts do not fit."],
    },
    "ok": {
        "Apparel": ["Decent quality, a bit tight around the waist.", "Nice color, fabric thinner than expected.",
                    "Fits okay after washing, average overall.", "Looks good but wrinkles easily.", "Fine for the price."],
        "Electronics": ["Works as described, setup was fiddly.", "Sound is fine, battery is average.",
                        "Does the job, nothing special.", "Good value but feels a little plasticky.", "Okay, app could be better."],
        "Home & Kitchen": ["Solid but heavier than expected.", "Works well, a little loud.", "Good enough, instructions unclear.",
                           "Average quality, nice design.", "Does what it says."],
        "Beauty": ["Pleasant but no dramatic results yet.", "Nice scent, small bottle.", "Works okay, a bit pricey.",
                   "Average, will finish the bottle.", "Decent for daily use."],
        "Sports & Outdoors": ["Comfortable enough, grip could be better.", "Sturdy but bulky.", "Good for beginners.",
                              "Works fine, straps are short.", "Okay quality for the price."],
        "Toys & Games": ["Kids liked it for a week.", "Fun but a few pieces are flimsy.", "Good concept, mediocre build.",
                         "Okay, batteries drain fast.", "Nice but overpriced."],
    },
    "good": {
        "Apparel": ["Fits perfectly and the fabric is lovely.", "Great quality, exactly as pictured.", "Comfortable and stylish, wearing it constantly.",
                    "True to size and beautifully made.", "Warm, soft and well stitched.", "Best jacket I have owned."],
        "Electronics": ["Excellent sound and battery lasts for days.", "Setup took two minutes, flawless since.",
                        "Fantastic value, works better than my old premium one.", "Crisp picture and fast interface.",
                        "Build quality is superb.", "Exceeded expectations."],
        "Home & Kitchen": ["Cooks evenly and cleans up easily.", "Sturdy, beautiful and works perfectly.",
                           "Use it every single day.", "Great quality for the price.", "Exactly what our kitchen needed.",
                           "Solid build, highly recommend."],
        "Beauty": ["Skin feels noticeably smoother.", "Gentle, effective and smells great.", "Great results in two weeks.",
                   "Lovely packaging and product.", "Perfect shade, long lasting.", "My new daily essential."],
        "Sports & Outdoors": ["Durable and comfortable on long runs.", "Kept me dry through a storm.", "Excellent grip and cushioning.",
                              "Lightweight and well made.", "Great gear, worth every penny.", "Perfect for my home gym."],
        "Toys & Games": ["Hours of fun for the whole family.", "Well made and educational.", "My kids adore it.",
                         "Great quality pieces, easy instructions.", "Perfect birthday gift.", "Engaging and sturdy."],
    },
}
SHIP_SLOW = ["Shipping took forever.", "Delivery was very slow.", "Took over a week to arrive.", "Arrived much later than promised."]
SHIP_FAST = ["Arrived quickly.", "Fast shipping.", "Delivered in two days."]
RETURNED = ["Returned it.", "Sent it back for a refund.", "Returning this one.", "Had to return it."]


def gen_orders(rng: np.random.Generator, n: int = 8000) -> pd.DataFrame:
    cats = list(CATALOG)
    cat_w = np.array([0.26, 0.18, 0.18, 0.12, 0.14, 0.12])
    cat_idx = rng.choice(len(cats), n, p=cat_w)
    prod_idx = np.array([rng.integers(0, len(CATALOG[cats[c]])) for c in cat_idx])
    category = np.array([cats[c] for c in cat_idx])
    product = np.array([CATALOG[cats[c]][p][0] for c, p in zip(cat_idx, prod_idx)])
    base_price = np.array([CATALOG[cats[c]][p][1] for c, p in zip(cat_idx, prod_idx)], dtype=float)
    quality = np.array([CATALOG[cats[c]][p][2] for c, p in zip(cat_idx, prod_idx)], dtype=float)

    start, end = date(2025, 1, 1), REF_DATE
    order_dates = np.array([start + timedelta(days=int(d)) for d in rng.integers(0, (end - start).days + 1, n)])
    month = np.array([d.month for d in order_dates])
    holiday = np.isin(month, [11, 12])

    city_w = np.array([c[2] for c in CITIES]); city_w /= city_w.sum()
    ci = rng.choice(len(CITIES), n, p=city_w)
    city = np.array([CITIES[i][0] for i in ci]); state = np.array([CITIES[i][1] for i in ci])

    quantity = np.minimum(rng.geometric(0.55, n), 5)
    unit_price = np.round(base_price * rng.normal(1.0, 0.05, n), 2)

    disc_logit_hi = 0.9 * (category == "Apparel") + 0.8 * holiday
    disc_w = np.array([0.55, 0.12, 0.08, 0.08, 0.05, 0.05, 0.04, 0.03])
    discount = np.empty(n, dtype=int)
    for i in range(n):
        w = disc_w.copy(); w[5:] *= np.exp(disc_logit_hi[i]); w[0] *= np.exp(-0.6 * disc_logit_hi[i])
        discount[i] = rng.choice(DISCOUNTS, p=w / w.sum())

    ship_base = np.array([STATE_SHIP[s] for s in state]) + 0.6 * holiday + 0.3 * (category == "Apparel")
    shipping_days = np.clip(rng.poisson(ship_base) + 1, 1, 14)

    rating_f = (quality - 0.14 * np.maximum(0, shipping_days - 4) - 0.25 * (category == "Apparel")
                - 0.30 * (discount > 30) + rng.normal(0, 0.7, n))
    rating = np.clip(np.round(rating_f), 1, 5).astype(int)

    ret_logit = (-2.75 + 0.32 * np.maximum(0, shipping_days - 5) + 1.0 * (category == "Apparel") + 0.65 * (discount > 30)
                 + 1.3 * (rating <= 2) + 0.4 * (rating == 3) - 0.5 * (rating == 5))
    returned = (rng.random(n) < sigmoid(ret_logit)).astype(int)

    reviews = []
    for i in range(n):
        bucket = "bad" if rating[i] <= 2 else ("ok" if rating[i] == 3 else "good")
        parts = [rng.choice(REVIEW[bucket][category[i]])]
        if shipping_days[i] >= 7 and rng.random() < 0.7:
            parts.append(rng.choice(SHIP_SLOW))
        elif shipping_days[i] <= 2 and rng.random() < 0.35:
            parts.append(rng.choice(SHIP_FAST))
        if returned[i] and rng.random() < 0.75:
            parts.append(rng.choice(RETURNED))
        reviews.append(" ".join(parts))

    cust_pool = rng.integers(10000, 13500, n)
    order_ids = np.argsort(np.array([d.toordinal() for d in order_dates]), kind="stable")
    rank = np.empty(n, dtype=int); rank[order_ids] = np.arange(n)
    return pd.DataFrame({
        "order_id": [f"O{100001 + r}" for r in rank],
        "customer_id": [f"U{c}" for c in cust_pool],
        "order_date": [d.isoformat() for d in order_dates],
        "city": city,
        "state": state,
        "category": category,
        "product": product,
        "quantity": quantity,
        "unit_price": unit_price,
        "discount_pct": discount,
        "shipping_days": shipping_days,
        "returned": returned,
        "rating": rating,
        "review_text": reviews,
    }).sort_values("order_id").reset_index(drop=True)


def write(df: pd.DataFrame, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(path, index=False)
    size = path.stat().st_size
    while size > MAX_BYTES:  # safety: trim rows if a future edit inflates the text
        df = df.iloc[: int(len(df) * 0.9)]
        df.to_csv(path, index=False)
        size = path.stat().st_size
        print(f"  trimmed {path.name} to {len(df)} rows to stay under 3 MB")
    print(f"wrote {path.relative_to(REPO_ROOT) if path.is_relative_to(REPO_ROOT) else path}: {len(df):,} rows, {size / 1024:.0f} KB")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    args = ap.parse_args()

    rng = np.random.default_rng(SEED)
    saas = gen_saas(rng)
    write(saas, args.out / "saas_customers.csv")
    print(f"  churn rate {saas.churned.mean():.1%} | by plan: "
          + ", ".join(f"{k}={v:.1%}" for k, v in saas.groupby('plan').churned.mean().items())
          + f" | Retail={saas[saas.industry == 'Retail'].churned.mean():.1%} vs other={saas[saas.industry != 'Retail'].churned.mean():.1%}"
          + f" | tickets>=4: {saas[saas.support_tickets_90d >= 4].churned.mean():.1%} vs <2: {saas[saas.support_tickets_90d < 2].churned.mean():.1%}")

    orders = gen_orders(rng)
    write(orders, args.out / "ecommerce_orders.csv")
    print(f"  return rate {orders.returned.mean():.1%} | Apparel={orders[orders.category == 'Apparel'].returned.mean():.1%} "
          f"vs other={orders[orders.category != 'Apparel'].returned.mean():.1%} | ship>5: "
          f"{orders[orders.shipping_days > 5].returned.mean():.1%} vs <=5: {orders[orders.shipping_days <= 5].returned.mean():.1%} "
          f"| disc>30: {orders[orders.discount_pct > 30].returned.mean():.1%} | avg rating {orders.rating.mean():.2f}")


if __name__ == "__main__":
    main()

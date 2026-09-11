#!/usr/bin/env python3
"""Fetch the real SF Airbnb listings dataset for Parallax (docs/SPEC.md section 8).

    python scripts/fetch_datasets.py            # -> datasets/sf_airbnb_listings.csv
    python scripts/fetch_datasets.py --offline  # skip the download, synthesize the stand-in

Downloads https://hotdata.dev/data/sf-airbnb-listings.parquet (httpx, 60 s timeout), reads it with
pandas/pyarrow, keeps id, name, neighbourhood, room_type, price, minimum_nights, number_of_reviews,
availability_365, description (adapting to the closest column names present — e.g. neighbourhood_cleansed),
adds the real accommodates / bedrooms / review_scores_rating columns, caps rows at 7,600 and keeps the CSV
under 3 MB.

NOTE on price: the current hotdata.dev scrape ships `price` (and estimated_revenue) entirely NULL. When that
happens the script MODELS a nightly price from the listing's real attributes (room type, neighbourhood,
capacity, bedrooms, review score) with seeded noise, and says so loudly. Every other column is real data. On ANY failure it synthesizes a 3,000-row stand-in with the same columns, real SF
neighbourhood names, price distributions by room type / neighbourhood and descriptive text, so the app always
has this dataset.
"""
from __future__ import annotations

import argparse
import io
import sys
from pathlib import Path

import numpy as np
import pandas as pd

REPO_ROOT = Path(__file__).resolve().parent.parent
OUT = REPO_ROOT / "datasets" / "sf_airbnb_listings.csv"
URL = "https://hotdata.dev/data/sf-airbnb-listings.parquet"
COLUMNS = ["id", "name", "neighbourhood", "room_type", "price", "minimum_nights", "number_of_reviews",
           "availability_365", "description"]
EXTRA = ["accommodates", "bedrooms", "review_scores_rating"]  # real columns kept when present
ALIASES = {
    "id": ["id", "listing_id"],
    "name": ["name", "listing_name", "title"],
    "neighbourhood": ["neighbourhood_cleansed", "neighborhood_cleansed", "neighbourhood", "neighborhood"],
    "room_type": ["room_type", "property_type"],
    "price": ["price", "nightly_price"],
    "minimum_nights": ["minimum_nights", "min_nights"],
    "number_of_reviews": ["number_of_reviews", "reviews_count", "review_count"],
    "availability_365": ["availability_365", "availability"],
    "description": ["description", "summary", "space", "neighborhood_overview", "name"],
}
MAX_ROWS = 7600
MAX_BYTES = 3 * 1024 * 1024
DESC_MAX_CHARS = 600

SF_NEIGHBOURHOODS = [
    ("Mission", 1.00, 1.15), ("Western Addition", 0.75, 1.20), ("South of Market", 0.70, 1.35), ("Castro/Upper Market", 0.55, 1.25),
    ("Haight Ashbury", 0.55, 1.05), ("Noe Valley", 0.45, 1.30), ("Bernal Heights", 0.50, 1.00), ("Downtown/Civic Center", 0.60, 1.10),
    ("Nob Hill", 0.40, 1.40), ("Russian Hill", 0.30, 1.50), ("Pacific Heights", 0.30, 1.60), ("Marina", 0.35, 1.55),
    ("North Beach", 0.30, 1.35), ("Potrero Hill", 0.35, 1.10), ("Inner Richmond", 0.35, 0.95), ("Outer Richmond", 0.35, 0.85),
    ("Inner Sunset", 0.35, 0.95), ("Outer Sunset", 0.40, 0.80), ("Bayview", 0.30, 0.70), ("Excelsior", 0.30, 0.70),
    ("Chinatown", 0.20, 1.00), ("Financial District", 0.20, 1.45), ("Twin Peaks", 0.15, 1.05), ("Glen Park", 0.15, 1.00),
    ("Parkside", 0.20, 0.80), ("Ocean View", 0.15, 0.70), ("Presidio Heights", 0.10, 1.70), ("Seacliff", 0.05, 1.80),
    ("Visitacion Valley", 0.12, 0.65), ("Lakeshore", 0.12, 0.85), ("Crocker Amazon", 0.08, 0.65), ("Diamond Heights", 0.08, 1.05),
    ("West of Twin Peaks", 0.15, 1.00), ("Outer Mission", 0.25, 0.75), ("Golden Gate Park", 0.02, 1.00), ("Treasure Island/YBI", 0.03, 0.90),
]
HOOD_MULT = {h[0]: h[2] for h in SF_NEIGHBOURHOODS}
ROOM_TYPES = ["Entire home/apt", "Private room", "Shared room", "Hotel room"]
ROOM_W = [0.62, 0.33, 0.03, 0.02]
ROOM_PRICE = {"Entire home/apt": 240, "Private room": 110, "Shared room": 60, "Hotel room": 210}
ADJ = ["Sunny", "Charming", "Modern", "Cozy", "Spacious", "Bright", "Quiet", "Stylish", "Renovated", "Classic Victorian",
       "Garden-level", "Top-floor", "Designer", "Historic", "Light-filled"]
NOUN = {"Entire home/apt": ["flat", "apartment", "home", "condo", "loft", "Victorian", "2BR apartment", "studio"],
        "Private room": ["room", "private room", "bedroom", "guest room", "suite"],
        "Shared room": ["shared room", "bunk", "hostel bed"], "Hotel room": ["hotel room", "boutique room", "king room"]}
FEATURES = ["steps from the Muni line", "with a view of the bay", "with a private deck", "next to great cafes and bars",
            "close to Golden Gate Park", "with fast wifi and a desk", "in a walkable neighborhood", "with parking included",
            "minutes from downtown", "with a fully equipped kitchen", "near Dolores Park", "on a quiet tree-lined street",
            "with in-unit laundry", "perfect for families", "ideal for a long stay", "with a fireplace and bay windows"]
AUDIENCE = ["Great for couples.", "Perfect for families with kids.", "Ideal for remote workers.", "Popular with business travelers.",
            "Sleeps four comfortably.", "Best suited to solo travelers.", "Pet friendly on request.", "Self check-in with a keypad."]


def pick(df: pd.DataFrame, target: str) -> pd.Series | None:
    for alias in ALIASES[target]:
        if alias in df.columns:
            return df[alias]
    return None


def clean_price(s: pd.Series) -> pd.Series:
    if s.dtype == object:
        s = s.astype(str).str.replace(r"[^0-9.]", "", regex=True).replace("", np.nan)
    return pd.to_numeric(s, errors="coerce")


def model_price(df: pd.DataFrame, seed: int = 42) -> pd.Series:
    """Nightly price modelled from REAL listing attributes (used only when the scrape has no price)."""
    rng = np.random.default_rng(seed)
    base = df["room_type"].map(ROOM_PRICE).fillna(150.0).astype(float)
    hood = df["neighbourhood"].map(HOOD_MULT).fillna(1.0).astype(float)
    acc = pd.to_numeric(df.get("accommodates", 2), errors="coerce").fillna(2).clip(1, 16)
    beds = pd.to_numeric(df.get("bedrooms", 1), errors="coerce").fillna(1).clip(0, 8)
    score = pd.to_numeric(df.get("review_scores_rating", 4.7), errors="coerce").fillna(4.7).clip(3.0, 5.0)
    log_p = (np.log(base) + np.log(hood) + 0.35 * np.log(acc / 2.0) + 0.08 * beds + 0.25 * (score - 4.7)
             + rng.normal(0, 0.22, len(df)))
    return np.round(np.exp(log_p)).clip(35, 3000).astype(int)


def fetch() -> pd.DataFrame:
    import httpx

    print(f"downloading {URL} ...")
    with httpx.Client(timeout=60, follow_redirects=True) as client:
        r = client.get(URL)
        r.raise_for_status()
    raw = pd.read_parquet(io.BytesIO(r.content))
    print(f"  parquet: {len(raw):,} rows x {raw.shape[1]} cols: {list(raw.columns)[:25]}{' ...' if raw.shape[1] > 25 else ''}")
    out = pd.DataFrame()
    missing = []
    for col in COLUMNS:
        s = pick(raw, col)
        if s is None:
            missing.append(col)
            continue
        out[col] = s.values
    if missing:
        print(f"  columns not found (filled empty): {missing}")
        for col in missing:
            out[col] = np.nan
    for col in EXTRA:
        if col in raw.columns:
            out[col] = raw[col].values
    out = out[COLUMNS + [c for c in EXTRA if c in out.columns]]
    out["price"] = clean_price(out["price"])
    price_modelled = False
    if out["price"].notna().sum() < 0.2 * len(out):
        price_modelled = True
        print("  WARNING: `price` is empty in this scrape -> modelling nightly price from room_type, neighbourhood, "
              "accommodates, bedrooms and review score (seeded). All other columns are real.")
        out["price"] = model_price(out)
    out.attrs["price_modelled"] = price_modelled
    for col in ("minimum_nights", "number_of_reviews", "availability_365"):
        out[col] = pd.to_numeric(out[col], errors="coerce").fillna(0).astype(int)
    out["description"] = (out["description"].fillna(out["name"]).astype(str)
                          .str.replace(r"<[^>]+>", " ", regex=True).str.replace(r"\s+", " ", regex=True).str.strip()
                          .str.slice(0, DESC_MAX_CHARS))
    out["name"] = out["name"].fillna("").astype(str).str.replace(r"\s+", " ", regex=True).str.strip()
    out = out.dropna(subset=["price"])
    out = out[(out["price"] > 0) & (out["price"] < 5000)]
    if len(out) < 500:
        raise RuntimeError(f"only {len(out)} usable rows after cleaning")
    out = out.head(MAX_ROWS).reset_index(drop=True)
    return out


def synthesize(n: int = 3000, seed: int = 42) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    hood_w = np.array([h[1] for h in SF_NEIGHBOURHOODS]); hood_w /= hood_w.sum()
    hi = rng.choice(len(SF_NEIGHBOURHOODS), n, p=hood_w)
    hood = np.array([SF_NEIGHBOURHOODS[i][0] for i in hi]); hood_mult = np.array([SF_NEIGHBOURHOODS[i][2] for i in hi])
    room = rng.choice(ROOM_TYPES, n, p=ROOM_W)
    base = np.array([ROOM_PRICE[r] for r in room])
    price = np.round(base * hood_mult * rng.lognormal(0, 0.35, n)).clip(35, 2500).astype(int)
    min_nights = np.where(rng.random(n) < 0.42, 30, rng.choice([1, 2, 3, 4, 5, 7, 14], n, p=[0.2, 0.3, 0.2, 0.08, 0.1, 0.07, 0.05]))
    reviews = rng.negative_binomial(1.2, 0.03, n)
    reviews = np.where(min_nights >= 30, (reviews * 0.4).astype(int), reviews)
    availability = rng.integers(0, 366, n)
    names, descs = [], []
    for i in range(n):
        adj = rng.choice(ADJ); noun = rng.choice(NOUN[room[i]]); feat = rng.choice(FEATURES, 2, replace=False)
        names.append(f"{adj} {noun} in {hood[i]}")
        premium = " Premium finishes, luxury linens and a chef's kitchen." if price[i] > 350 else ""
        descs.append(f"{adj} {noun} in {hood[i]}, {feat[0]} and {feat[1]}.{premium} {rng.choice(AUDIENCE)} "
                     f"{'Minimum 30-night stays.' if min_nights[i] >= 30 else 'Short stays welcome.'}")
    return pd.DataFrame({
        "id": 10_000_000 + rng.choice(8_999_999, n, replace=False),
        "name": names, "neighbourhood": hood, "room_type": room, "price": price, "minimum_nights": min_nights,
        "number_of_reviews": reviews, "availability_365": availability, "description": descs,
    })


def write(df: pd.DataFrame, path: Path, source: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(path, index=False)
    trimmed = False
    while path.stat().st_size > MAX_BYTES and len(df) > 500:
        df = df.iloc[: int(len(df) * 0.9)]
        df.to_csv(path, index=False)
        trimmed = True
    if trimmed:
        print(f"  trimmed to {len(df):,} rows to stay under 3 MB")
    print(f"wrote {path.relative_to(REPO_ROOT)}: {len(df):,} rows, {path.stat().st_size / 1024:.0f} KB (source: {source})")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", type=Path, default=OUT)
    ap.add_argument("--offline", action="store_true", help="skip download, synthesize the stand-in")
    args = ap.parse_args()
    if not args.offline:
        try:
            df = fetch()
            src = "hotdata.dev sf-airbnb-listings.parquet (real" + ("; price modelled)" if df.attrs.get("price_modelled") else ")")
            write(df, args.out, src)
            return 0
        except Exception as e:  # noqa: BLE001 — any failure falls back to the synthetic stand-in
            print(f"  fetch failed ({e.__class__.__name__}: {e}); synthesizing stand-in", file=sys.stderr)
    write(synthesize(), args.out, "synthetic stand-in")
    return 0


if __name__ == "__main__":
    sys.exit(main())

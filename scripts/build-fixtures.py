"""
One-off converter: local RH source data -> JSON fixtures used by the offline
provider fallback.

This runs at development time only. The app has no Python dependency at
runtime; committing the generated JSON keeps the serverless bundle small and
avoids a PDF/XLSX parser in the Node dependency tree.

Usage:
    .venv/Scripts/python.exe scripts/build-fixtures.py

Inputs:
    data/transcripts/*.pdf      vendor earnings-call transcripts
    data/RH Closing Price.xlsx  daily closes

Output:
    lib/providers/fixtures/data/transcripts.json
    lib/providers/fixtures/data/prices.json
"""

from __future__ import annotations

import glob
import json
import os
import re
from datetime import datetime

import pandas as pd
import pypdf

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "lib", "providers", "fixtures", "data")

# "RH, Q1 2026 Earnings Call, Jun 12, 2025"
HEADER = re.compile(
    r"([A-Z][A-Za-z0-9.\- ]{0,40}),\s*Q(\d)\s+(\d{4})\s+Earnings Call,\s*"
    r"([A-Z][a-z]{2}\s+\d{1,2},\s*\d{4})"
)

# The vendor prepends an editorial summary ("Key Takeaways") that is NOT
# management language. Analyzing it would let the model attribute a third
# party's characterization to executives, so the transcript is sliced to the
# genuine call body.
BODY_START = ("Call Participants", "Presentation")
BODY_END = ("Copyright ©", "Copyright (c)", "Copyright ©")


def clean(text: str) -> str:
    """Normalize ligatures and layout artifacts from PDF extraction."""
    for bad, good in (
        ("ﬀ", "ff"), ("ﬁ", "fi"), ("ﬂ", "fl"),
        ("ﬃ", "ffi"), ("ﬄ", "ffl"),
        ("‘", "'"), ("’", "'"),
        ("“", '"'), ("”", '"'),
        ("–", "-"), ("—", "-"), (" ", " "),
    ):
        text = text.replace(bad, good)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def slice_body(text: str) -> str:
    start = -1
    for marker in BODY_START:
        found = text.find(marker)
        if found != -1:
            start = found
            break
    if start == -1:
        # Better to analyze the whole document than to silently drop it, but
        # this is worth knowing about.
        print("    ! no body marker found; using full text")
        start = 0

    end = len(text)
    for marker in BODY_END:
        found = text.rfind(marker)
        if found != -1 and found > start:
            end = min(end, found)
    return text[start:end].strip()


def build_transcripts() -> list[dict]:
    out: list[dict] = []
    for path in sorted(glob.glob(os.path.join(ROOT, "data", "transcripts", "*.pdf"))):
        reader = pypdf.PdfReader(path)
        raw = clean("\n".join(page.extract_text() or "" for page in reader.pages))

        match = HEADER.search(raw)
        if not match:
            print(f"  skip (no header): {os.path.basename(path)}")
            continue

        ticker, quarter, year, date_str = match.groups()
        call_date = datetime.strptime(re.sub(r"\s+", " ", date_str), "%b %d, %Y").date()
        body = slice_body(raw)

        out.append({
            "ticker": ticker.strip().upper(),
            "fiscalYear": int(year),
            "fiscalQuarter": int(quarter),
            "callDate": call_date.isoformat(),
            "text": body,
            "source": "local-fixture",
        })
        print(
            f"  {ticker} Q{quarter} FY{year} {call_date}  "
            f"{len(raw):>6} raw -> {len(body):>6} body chars"
        )

    out.sort(key=lambda t: (-t["fiscalYear"], -t["fiscalQuarter"]))
    return out


def build_prices() -> list[dict]:
    matches = (
        glob.glob(os.path.join(ROOT, "data", "*.xlsx"))
        + glob.glob(os.path.join(ROOT, "data", "*.xls"))
    )
    if not matches:
        print("  no price workbook found")
        return []

    df = pd.read_excel(matches[0])

    # Columns are unnamed in the source workbook; detect by dtype rather than
    # relying on header text.
    date_col = next(
        (c for c in df.columns if pd.api.types.is_datetime64_any_dtype(df[c])), None
    )
    price_col = next(
        (c for c in df.columns
         if c != date_col and pd.api.types.is_numeric_dtype(df[c]) and df[c].notna().sum() > 10),
        None,
    )
    if date_col is None or price_col is None:
        print("  could not detect date/price columns")
        return []

    rows = (
        df[[date_col, price_col]]
        .dropna()
        .rename(columns={date_col: "date", price_col: "close"})
        .sort_values("date")
    )

    out = [
        {"date": r.date.date().isoformat(), "close": round(float(r.close), 4)}
        for r in rows.itertuples()
    ]
    if out:
        print(f"  {len(out)} closes, {out[0]['date']} -> {out[-1]['date']}")
    return out


def main() -> None:
    os.makedirs(OUT_DIR, exist_ok=True)

    print("Transcripts:")
    transcripts = build_transcripts()
    print("Prices:")
    prices = build_prices()

    with open(os.path.join(OUT_DIR, "transcripts.json"), "w", encoding="utf-8") as fh:
        json.dump(transcripts, fh, indent=1, ensure_ascii=False)

    # `close` doubles as `adjClose` here: this workbook carries unadjusted
    # closes only. Documented in lib/providers/fixtures/index.ts.
    with open(os.path.join(OUT_DIR, "prices.json"), "w", encoding="utf-8") as fh:
        json.dump({"ticker": "RH", "prices": prices}, fh, indent=1)

    print(f"\nWrote {len(transcripts)} transcripts and {len(prices)} closes to {OUT_DIR}")


if __name__ == "__main__":
    main()

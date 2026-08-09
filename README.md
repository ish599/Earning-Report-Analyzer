# RH Earnings Sentiment vs Price Impact

Dashboard that links **earnings call sentiment** (tone/words from management) to **stock returns** over 7, 14, 21, and 30 trading days after the call.

- **No hardcoded data**: reads PDF transcripts and an Excel price file from local folders.
- **Vercel-ready**: build runs the processor then Next.js; deploy with `public/analysis.json` (generated from your data or committed after `npm run process`).

## Quick start

1. **Put your data in place**
   - **Transcripts**: PDFs of earnings calls in `data/transcripts/`.
   - **Prices**: Excel with date + closing price in `data/`.  
     Supported names: `RH Closing Price.xlsx`, `prices.xlsx`, or any `*.xlsx` in `data/`.  
     Expected: one sheet with a **date** column and a **closing price** column (auto-detected).

2. **Generate analysis**
   ```bash
   pip install -r requirements.txt
   npm install
   ```
   For **Claude-powered sentiment and language analysis** (tone, confidence, themes, risks, quotes), set your API key and run:
   ```bash
   set ANTHROPIC_API_KEY=your_key_here
   npm run process
   ```
   Without `ANTHROPIC_API_KEY`, the script uses VADER for sentiment only (no language breakdown).
   This writes `public/analysis.json` (sentiment + returns + optional Claude language analysis per call).

3. **Run the dashboard**
   ```bash
   npm run dev
   ```
   Open [http://localhost:3000](http://localhost:3000).

4. **Deploy to Vercel**
   - Run `npm run process` locally, then commit `public/analysis.json` so the deployed app has data.
   - In Vercel set Build command to `npm run build:vercel`.  
   - If the Python step fails in Vercel (no Python/data), the build still succeeds and the app shows “No data” until you run `npm run process` locally and commit `public/analysis.json`.

## What it does

- **PDFs**: Extracts text, parses earnings date (e.g. “RH, Q3 2026 Earnings Call, Dec 11, 2025”), runs **VADER** sentiment on the full transcript.
- **Excel**: Loads date and close; for each earnings date finds the first trading day on or after that date, then closing price 7/14/21/30 **trading days** later and computes % return.
- **Dashboard**: Table of calls (date, quarter, sentiment score/label, price at day 0, returns); correlation of sentiment vs return by horizon; scatter plots (sentiment vs 7d and 30d return); bar chart by call.

## Config (optional)

Environment variables (or defaults):

- `ANTHROPIC_API_KEY` — if set, sentiment and language analysis use the Claude API (recommended).
- `ANTHROPIC_MODEL` — optional; default `claude-3-5-sonnet-20241022`.
- `DATA_DIR` → `./data`
- `DATA_TRANSCRIPTS_DIR` → `./data/transcripts`
- `DATA_PRICES_PATH` → first matching file in `DATA_DIR`: `RH Closing Price.xlsx`, `prices.xlsx`, or any `*.xlsx`
- `OUTPUT_PATH` → `./public/analysis.json`

## Scripts

- `npm run process` — run the pipeline only (Python).
- `npm run build` — run the pipeline then `next build` (for production / Vercel).
- `npm run dev` — local Next.js dev server.

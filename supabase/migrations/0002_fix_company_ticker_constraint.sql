-- Fix company ticker upsert conflict handling for Supabase.
-- The previous migration created a unique index on upper(ticker), which is not
-- directly usable by PostgREST's ON CONFLICT (ticker) clause.
-- This migration normalizes ticker values and creates a plain unique constraint
-- on ticker so upserts can reliably target the conflict column.

update companies
set ticker = upper(ticker)
where ticker is not null;

-- Remove the case-insensitive unique index used by the initial schema.
drop index if exists companies_ticker_key;

alter table companies
  add constraint companies_ticker_key unique (ticker);

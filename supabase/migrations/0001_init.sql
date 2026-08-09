-- Earnings Intelligence — initial schema
--
-- Design notes:
--   * One row per (company, fiscal year, fiscal quarter) in earnings_calls.
--     Transcript text is stored so we never re-fetch it from the provider.
--   * earnings_analysis is keyed by (call, analysis_version) so that bumping
--     the version produces a new row rather than destroying prior work. The
--     app reads the row matching the current ANALYSIS_VERSION constant; a
--     miss is what triggers a re-analysis.
--   * All writes go through the service role. RLS is enabled with read-only
--     public policies because this holds public market data and no user data.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- companies
-- ---------------------------------------------------------------------------

create table if not exists companies (
  id           uuid primary key default gen_random_uuid(),
  ticker       text not null,
  company_name text not null,
  sector       text,
  industry     text,
  exchange     text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create unique index if not exists companies_ticker_key on companies (upper(ticker));

-- ---------------------------------------------------------------------------
-- earnings_calls
-- ---------------------------------------------------------------------------

create table if not exists earnings_calls (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references companies (id) on delete cascade,
  fiscal_year       integer not null,
  fiscal_quarter    integer not null check (fiscal_quarter between 1 and 4),
  call_date         date,
  transcript_text   text,
  transcript_source text not null default 'fmp',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint earnings_calls_period_key unique (company_id, fiscal_year, fiscal_quarter)
);

create index if not exists earnings_calls_company_period_idx
  on earnings_calls (company_id, fiscal_year desc, fiscal_quarter desc);

-- ---------------------------------------------------------------------------
-- earnings_analysis
-- ---------------------------------------------------------------------------

create table if not exists earnings_analysis (
  id                    uuid primary key default gen_random_uuid(),
  earnings_call_id      uuid not null references earnings_calls (id) on delete cascade,
  overall_sentiment     numeric(5, 2) not null check (overall_sentiment between 0 and 100),
  management_sentiment  numeric(5, 2) not null check (management_sentiment between 0 and 100),
  qa_sentiment          numeric(5, 2) not null check (qa_sentiment between 0 and 100),
  management_confidence numeric(5, 2) check (management_confidence between 0 and 100),
  guidance_tone         numeric(5, 2) check (guidance_tone between 0 and 100),
  business_momentum     numeric(5, 2) check (business_momentum between 0 and 100),
  -- Retained for compatibility with the prior dashboard's notion of a single
  -- headline score; mirrors overall_sentiment.
  sentiment_score       numeric(5, 2) not null,
  confidence_score      numeric(5, 2) check (confidence_score between 0 and 100),
  -- 'improving' | 'stable' | 'deteriorating'. Never a buy/sell rating.
  signal                text check (signal in ('improving', 'stable', 'deteriorating')),
  classification        text check (classification in (
                          'very_bearish', 'bearish', 'neutral', 'bullish', 'very_bullish')),
  summary               text,
  risks                 jsonb not null default '[]'::jsonb,
  positives             jsonb not null default '[]'::jsonb,
  changes_vs_prior      jsonb not null default '[]'::jsonb,
  analysis_version      text not null,
  model_used            text not null,
  created_at            timestamptz not null default now(),
  constraint earnings_analysis_version_key unique (earnings_call_id, analysis_version)
);

create index if not exists earnings_analysis_call_idx on earnings_analysis (earnings_call_id);

-- ---------------------------------------------------------------------------
-- topic_analysis
-- ---------------------------------------------------------------------------

create table if not exists topic_analysis (
  id               uuid primary key default gen_random_uuid(),
  earnings_call_id uuid not null references earnings_calls (id) on delete cascade,
  analysis_id      uuid not null references earnings_analysis (id) on delete cascade,
  topic            text not null,
  sentiment_score  numeric(5, 2) not null check (sentiment_score between 0 and 100),
  mention_count    integer not null default 0,
  direction        text check (direction in ('improving', 'stable', 'deteriorating', 'new')),
  summary          text,
  constraint topic_analysis_key unique (analysis_id, topic)
);

create index if not exists topic_analysis_call_idx on topic_analysis (earnings_call_id);

-- ---------------------------------------------------------------------------
-- key_quotes
-- ---------------------------------------------------------------------------

create table if not exists key_quotes (
  id               uuid primary key default gen_random_uuid(),
  earnings_call_id uuid not null references earnings_calls (id) on delete cascade,
  analysis_id      uuid not null references earnings_analysis (id) on delete cascade,
  speaker          text,
  speaker_role     text,
  quote            text not null,
  topic            text,
  sentiment        text,
  importance_score numeric(5, 2),
  why_it_matters   text,
  -- Character offset into earnings_calls.transcript_text, enabling
  -- scroll-to-quote. Null when the excerpt could not be located verbatim.
  char_offset      integer
);

create index if not exists key_quotes_call_idx on key_quotes (earnings_call_id);

-- ---------------------------------------------------------------------------
-- financial_results
-- ---------------------------------------------------------------------------

create table if not exists financial_results (
  id               uuid primary key default gen_random_uuid(),
  earnings_call_id uuid not null references earnings_calls (id) on delete cascade,
  revenue          numeric(20, 2),
  revenue_growth   numeric(10, 6),
  eps              numeric(12, 4),
  eps_estimate     numeric(12, 4),
  eps_surprise     numeric(12, 4),
  gross_margin     numeric(10, 6),
  operating_margin numeric(10, 6),
  guidance_json    jsonb,
  updated_at       timestamptz not null default now(),
  constraint financial_results_call_key unique (earnings_call_id)
);

-- ---------------------------------------------------------------------------
-- price_reactions
-- ---------------------------------------------------------------------------

create table if not exists price_reactions (
  id               uuid primary key default gen_random_uuid(),
  earnings_call_id uuid not null references earnings_calls (id) on delete cascade,
  return_1d        numeric(10, 6),
  return_5d        numeric(10, 6),
  return_10d       numeric(10, 6),
  return_20d       numeric(10, 6),
  base_date        date,
  base_price       numeric(16, 4),
  -- 'bmo' | 'amc' | 'unknown'. When 'unknown', the UI shows a methodology
  -- caveat instead of implying the window is exact.
  release_timing   text not null default 'unknown'
                     check (release_timing in ('bmo', 'amc', 'unknown')),
  updated_at       timestamptz not null default now(),
  constraint price_reactions_call_key unique (earnings_call_id)
);

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists companies_set_updated_at on companies;
create trigger companies_set_updated_at
  before update on companies
  for each row execute function set_updated_at();

drop trigger if exists earnings_calls_set_updated_at on earnings_calls;
create trigger earnings_calls_set_updated_at
  before update on earnings_calls
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Row level security
--
-- Public market research data: anon may read, nobody may write. The server
-- uses the service role key, which bypasses RLS entirely.
-- ---------------------------------------------------------------------------

alter table companies         enable row level security;
alter table earnings_calls    enable row level security;
alter table earnings_analysis enable row level security;
alter table topic_analysis    enable row level security;
alter table key_quotes        enable row level security;
alter table financial_results enable row level security;
alter table price_reactions   enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array[
    'companies', 'earnings_calls', 'earnings_analysis', 'topic_analysis',
    'key_quotes', 'financial_results', 'price_reactions'
  ]
  loop
    execute format('drop policy if exists %I on %I', t || '_read', t);
    execute format('create policy %I on %I for select using (true)', t || '_read', t);
  end loop;
end;
$$;

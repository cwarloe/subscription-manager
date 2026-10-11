create table if not exists services (
  id text primary key,
  name text not null,
  category text not null,
  official_url text not null,
  notes text not null default ''
);

create table if not exists card_products (
  id text primary key,
  family_id text not null,
  family_name text not null,
  name text not null,
  issuer text not null,
  official_url text not null,
  separates_from text not null default ''
);

create table if not exists user_settings (
  user_id text primary key,
  qualifies_student boolean not null default true,
  qualifies_military boolean not null default true
);

create table if not exists plan_quotes (
  id text primary key,
  user_id text not null,
  service_id text not null references services (id),
  name text not null,
  billing_period text not null,
  price_cents integer,
  student_price_cents integer,
  military_price_cents integer,
  eligibility text not null default '',
  terms text not null default '',
  support_excerpt text not null default '',
  origin text not null,
  verification text not null,
  source_url text,
  checked_at timestamptz,
  last_success_at timestamptz,
  failure_note text not null default ''
);

create index if not exists plan_quotes_user_idx on plan_quotes (user_id, service_id);

create table if not exists fee_quotes (
  id text primary key,
  user_id text not null,
  card_id text not null references card_products (id),
  annual_fee_cents integer,
  support_excerpt text not null default '',
  origin text not null,
  verification text not null,
  source_url text,
  checked_at timestamptz,
  last_success_at timestamptz,
  failure_note text not null default '',
  unique (user_id, card_id)
);

create table if not exists benefit_quotes (
  id text primary key,
  user_id text not null,
  card_id text not null references card_products (id),
  name text not null,
  kind text not null,
  amount_cents integer,
  rate_bps integer,
  points_per_dollar_milli integer,
  period text not null,
  eligible_service_ids text not null default '',
  enrollment_required boolean not null default false,
  enrollment_notes text not null default '',
  expires_on date,
  stacking_notes text not null default '',
  support_excerpt text not null default '',
  origin text not null,
  verification text not null,
  source_url text,
  checked_at timestamptz,
  last_success_at timestamptz,
  failure_note text not null default ''
);

create index if not exists benefit_quotes_user_idx on benefit_quotes (user_id, card_id);

create table if not exists user_cards (
  id text primary key,
  user_id text not null,
  card_id text not null references card_products (id),
  fee_anniversary date,
  military_relief text not null default 'unconfirmed',
  unique (user_id, card_id)
);

create table if not exists benefit_enrollments (
  user_id text not null,
  benefit_id text not null,
  enrolled boolean not null default false,
  primary key (user_id, benefit_id)
);

create table if not exists subscriptions (
  id text primary key,
  user_id text not null,
  service_id text not null references services (id),
  plan_quote_id text,
  user_card_id text,
  billing_frequency text not null,
  renewal_date date,
  price_override_cents integer,
  status text not null default 'active',
  notes text not null default ''
);

create index if not exists subscriptions_user_idx on subscriptions (user_id);

create table if not exists monthly_entries (
  id text primary key,
  user_id text not null,
  year_month text not null,
  subscription_id text,
  benefit_id text,
  kind text not null,
  label text not null,
  amount_cents integer not null,
  points integer,
  affects_oop boolean not null,
  note text not null default '',
  source text not null default 'manual',
  created_at timestamptz not null default now()
);

create index if not exists monthly_entries_user_idx on monthly_entries (user_id, year_month);

create table if not exists refresh_runs (
  id text primary key,
  user_id text not null,
  status text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  message text not null default ''
);

create table if not exists refresh_items (
  id text primary key,
  run_id text not null,
  user_id text not null,
  target_type text not null,
  target_id text not null,
  label text not null,
  status text not null,
  message text not null default '',
  source_url text,
  position integer not null
);

create index if not exists refresh_items_run_idx on refresh_items (run_id, position);

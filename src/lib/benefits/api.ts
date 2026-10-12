import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { getSql, type Sql } from "@/lib/db";
import { CARDS, SERVICES } from "./catalog";
import { buildMonthEstimate } from "./calc";
import { ledgerToEstimate } from "./view";
import {
  BENEFIT_KINDS,
  BILLING_PERIODS,
  type BenefitKind,
  type BillingPeriod,
  type Verification,
  firstOfNextMonth,
} from "./money";

export type ServiceRow = {
  id: string;
  name: string;
  category: string;
  officialUrl: string;
  notes: string;
};

export type CardRow = {
  id: string;
  familyId: string;
  familyName: string;
  name: string;
  issuer: string;
  officialUrl: string;
  separatesFrom: string;
};

export type PlanRow = {
  id: string;
  serviceId: string;
  name: string;
  billing: BillingPeriod;
  priceCents: number | null;
  studentPriceCents: number | null;
  militaryPriceCents: number | null;
  eligibility: string;
  terms: string;
  excerpt: string;
  origin: string;
  verification: Verification;
  sourceUrl: string | null;
  checkedAt: string | null;
  lastSuccessAt: string | null;
  failureNote: string;
};

export type BenefitRow = {
  id: string;
  cardId: string;
  name: string;
  kind: BenefitKind;
  amountCents: number | null;
  rateBps: number | null;
  pointsPerDollarMilli: number | null;
  period: BillingPeriod;
  eligibleServiceIds: string[];
  enrollmentRequired: boolean;
  enrollmentNotes: string;
  expiresOn: string | null;
  stackingNotes: string;
  excerpt: string;
  origin: string;
  verification: Verification;
  sourceUrl: string | null;
  checkedAt: string | null;
  lastSuccessAt: string | null;
  failureNote: string;
  enrolled: boolean;
};

export type FeeRow = {
  cardId: string;
  annualFeeCents: number | null;
  excerpt: string;
  origin: string;
  verification: Verification;
  sourceUrl: string | null;
  checkedAt: string | null;
  lastSuccessAt: string | null;
  failureNote: string;
};

export type HeldCard = {
  id: string;
  cardId: string;
  anniversary: string | null;
  militaryRelief: "unconfirmed" | "waived_user" | "not_waived_user";
};

export type SubscriptionRow = {
  id: string;
  serviceId: string;
  planQuoteId: string | null;
  userCardId: string | null;
  billing: BillingPeriod;
  renewalDate: string | null;
  priceOverrideCents: number | null;
  status: "active" | "paused" | "canceled";
  notes: string;
};

export type EntryRow = {
  id: string;
  yearMonth: string;
  subscriptionId: string | null;
  benefitId: string | null;
  kind: string;
  label: string;
  amountCents: number;
  points: number | null;
  affectsOop: boolean;
  note: string;
  source: string;
};

export type RefreshItem = {
  id: string;
  targetType: string;
  targetId: string;
  label: string;
  status: string;
  message: string;
  sourceUrl: string | null;
};

export type Ledger = {
  services: ServiceRow[];
  cards: CardRow[];
  qualifiesStudent: boolean;
  qualifiesMilitary: boolean;
  plans: PlanRow[];
  benefits: BenefitRow[];
  fees: FeeRow[];
  heldCards: HeldCard[];
  subscriptions: SubscriptionRow[];
  entries: EntryRow[];
  refresh: { id: string; status: string; message: string; items: RefreshItem[] } | null;
};

const g = globalThis as { __benefitsSeeded?: string };
const CATALOG_VERSION = "2026-10-urls";

async function ensureCatalog(sql: Sql) {
  if (g.__benefitsSeeded === CATALOG_VERSION) return;
  for (const service of SERVICES) {
    await sql`
      insert into services (id, name, category, official_url, notes)
      values (${service.id}, ${service.name}, ${service.category}, ${service.officialUrl}, ${service.notes})
      on conflict (id) do update set
        name = excluded.name,
        category = excluded.category,
        official_url = excluded.official_url,
        notes = excluded.notes
    `;
  }
  for (const card of CARDS) {
    await sql`
      insert into card_products (id, family_id, family_name, name, issuer, official_url, separates_from)
      values (
        ${card.id}, ${card.familyId}, ${card.familyName}, ${card.name}, ${card.issuer},
        ${card.officialUrl}, ${card.separatesFrom}
      )
      on conflict (id) do update set
        family_id = excluded.family_id,
        family_name = excluded.family_name,
        name = excluded.name,
        issuer = excluded.issuer,
        official_url = excluded.official_url,
        separates_from = excluded.separates_from
    `;
  }
  g.__benefitsSeeded = CATALOG_VERSION;
}

function text(value: unknown): string | null {
  if (value == null) return null;
  return String(value);
}

function period(value: unknown): BillingPeriod {
  if (typeof value === "string" && BILLING_PERIODS.includes(value as BillingPeriod)) {
    return value as BillingPeriod;
  }
  throw new Error("Choose a billing period.");
}

function kind(value: unknown): BenefitKind {
  if (typeof value === "string" && BENEFIT_KINDS.includes(value as BenefitKind)) return value as BenefitKind;
  throw new Error("Choose a benefit type.");
}

function cents(value: unknown): number | null {
  if (value == null || value === "") return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 2_000_000) {
    throw new Error("Enter a valid dollar amount.");
  }
  return value;
}

function required(value: unknown, label: string, max = 160): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required.`);
  return value.trim().slice(0, max);
}

function optionalText(value: unknown, max = 800): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}

function dateOrNull(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("Use a YYYY-MM-DD date.");
  }
  return value;
}

function yearMonth(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}$/.test(value)) throw new Error("Choose a month.");
  return value;
}

async function readLedger(sql: Sql, userId: string): Promise<Ledger> {
  await ensureCatalog(sql);
  await sql`
    insert into user_settings (user_id) values (${userId})
    on conflict (user_id) do nothing
  `;
  const settings = await sql<{ qualifies_student: boolean; qualifies_military: boolean }>`
    select qualifies_student, qualifies_military from user_settings where user_id = ${userId}
  `;
  const services = await sql<{
    id: string;
    name: string;
    category: string;
    official_url: string;
    notes: string;
  }>`select id, name, category, official_url, notes from services order by category, name`;
  const cards = await sql<{
    id: string;
    family_id: string;
    family_name: string;
    name: string;
    issuer: string;
    official_url: string;
    separates_from: string;
  }>`select id, family_id, family_name, name, issuer, official_url, separates_from from card_products order by family_name, name`;
  const plans = await sql<{
    id: string;
    service_id: string;
    name: string;
    billing_period: BillingPeriod;
    price_cents: number | null;
    student_price_cents: number | null;
    military_price_cents: number | null;
    eligibility: string;
    terms: string;
    support_excerpt: string;
    origin: string;
    verification: Verification;
    source_url: string | null;
    checked_at: string | null;
    last_success_at: string | null;
    failure_note: string;
  }>`
    select id, service_id, name, billing_period, price_cents, student_price_cents, military_price_cents,
      eligibility, terms, support_excerpt, origin, verification, source_url,
      checked_at::text as checked_at, last_success_at::text as last_success_at, failure_note
    from plan_quotes where user_id = ${userId} order by name
  `;
  const benefits = await sql<{
    id: string;
    card_id: string;
    name: string;
    kind: BenefitKind;
    amount_cents: number | null;
    rate_bps: number | null;
    points_per_dollar_milli: number | null;
    period: BillingPeriod;
    eligible_service_ids: string;
    enrollment_required: boolean;
    enrollment_notes: string;
    expires_on: string | null;
    stacking_notes: string;
    support_excerpt: string;
    origin: string;
    verification: Verification;
    source_url: string | null;
    checked_at: string | null;
    last_success_at: string | null;
    failure_note: string;
    enrolled: boolean | null;
  }>`
    select b.id, b.card_id, b.name, b.kind, b.amount_cents, b.rate_bps, b.points_per_dollar_milli,
      b.period, b.eligible_service_ids, b.enrollment_required, b.enrollment_notes, b.expires_on::text as expires_on,
      b.stacking_notes, b.support_excerpt, b.origin, b.verification, b.source_url,
      b.checked_at::text as checked_at, b.last_success_at::text as last_success_at, b.failure_note,
      e.enrolled
    from benefit_quotes b
    left join benefit_enrollments e on e.benefit_id = b.id and e.user_id = b.user_id
    where b.user_id = ${userId}
    order by b.name
  `;
  const fees = await sql<{
    card_id: string;
    annual_fee_cents: number | null;
    support_excerpt: string;
    origin: string;
    verification: Verification;
    source_url: string | null;
    checked_at: string | null;
    last_success_at: string | null;
    failure_note: string;
  }>`
    select card_id, annual_fee_cents, support_excerpt, origin, verification, source_url,
      checked_at::text as checked_at, last_success_at::text as last_success_at, failure_note
    from fee_quotes where user_id = ${userId}
  `;
  const heldCards = await sql<{
    id: string;
    card_id: string;
    fee_anniversary: string | null;
    military_relief: HeldCard["militaryRelief"];
  }>`
    select id, card_id, fee_anniversary::text as fee_anniversary, military_relief
    from user_cards where user_id = ${userId} order by card_id
  `;
  const subscriptions = await sql<{
    id: string;
    service_id: string;
    plan_quote_id: string | null;
    user_card_id: string | null;
    billing_frequency: BillingPeriod;
    renewal_date: string | null;
    price_override_cents: number | null;
    status: SubscriptionRow["status"];
    notes: string;
  }>`
    select id, service_id, plan_quote_id, user_card_id, billing_frequency, renewal_date::text as renewal_date,
      price_override_cents, status, notes
    from subscriptions where user_id = ${userId} order by service_id
  `;
  const entries = await sql<{
    id: string;
    year_month: string;
    subscription_id: string | null;
    benefit_id: string | null;
    kind: string;
    label: string;
    amount_cents: number;
    points: number | null;
    affects_oop: boolean;
    note: string;
    source: string;
  }>`
    select id, year_month, subscription_id, benefit_id, kind, label, amount_cents, points, affects_oop, note, source
    from monthly_entries where user_id = ${userId}
    order by year_month desc, created_at desc
  `;
  const renewalDefault = firstOfNextMonth();
  if (subscriptions.some((row) => !row.renewal_date)) {
    await sql`
      update subscriptions set renewal_date = ${renewalDefault}
      where user_id = ${userId} and renewal_date is null
    `;
    for (const row of subscriptions) {
      if (!row.renewal_date) row.renewal_date = renewalDefault;
    }
  }
  const runs = await sql<{ id: string; status: string; message: string }>`
    select id, status, message from refresh_runs
    where user_id = ${userId}
    order by started_at desc
    limit 1
  `;
  let refresh: Ledger["refresh"] = null;
  if (runs[0]) {
    const items = await sql<{
      id: string;
      target_type: string;
      target_id: string;
      label: string;
      status: string;
      message: string;
      source_url: string | null;
    }>`
      select id, target_type, target_id, label, status, message, source_url
      from refresh_items where run_id = ${runs[0].id} and user_id = ${userId}
      order by position
    `;
    refresh = {
      id: runs[0].id,
      status: runs[0].status,
      message: runs[0].message,
      items: items.map((item) => ({
        id: item.id,
        targetType: item.target_type,
        targetId: item.target_id,
        label: item.label,
        status: item.status,
        message: item.message,
        sourceUrl: item.source_url,
      })),
    };
  }
  return {
    services: services.map((row) => ({
      id: row.id,
      name: row.name,
      category: row.category,
      officialUrl: row.official_url,
      notes: row.notes,
    })),
    cards: cards.map((row) => ({
      id: row.id,
      familyId: row.family_id,
      familyName: row.family_name,
      name: row.name,
      issuer: row.issuer,
      officialUrl: row.official_url,
      separatesFrom: row.separates_from,
    })),
    qualifiesStudent: settings[0]?.qualifies_student ?? true,
    qualifiesMilitary: settings[0]?.qualifies_military ?? true,
    plans: plans.map((row) => ({
      id: row.id,
      serviceId: row.service_id,
      name: row.name,
      billing: row.billing_period,
      priceCents: row.price_cents,
      studentPriceCents: row.student_price_cents,
      militaryPriceCents: row.military_price_cents,
      eligibility: row.eligibility,
      terms: row.terms,
      excerpt: row.support_excerpt,
      origin: row.origin,
      verification: row.verification,
      sourceUrl: row.source_url,
      checkedAt: text(row.checked_at),
      lastSuccessAt: text(row.last_success_at),
      failureNote: row.failure_note,
    })),
    benefits: benefits.map((row) => ({
      id: row.id,
      cardId: row.card_id,
      name: row.name,
      kind: row.kind,
      amountCents: row.amount_cents,
      rateBps: row.rate_bps,
      pointsPerDollarMilli: row.points_per_dollar_milli,
      period: row.period,
      eligibleServiceIds: row.eligible_service_ids ? row.eligible_service_ids.split(",").filter(Boolean) : [],
      enrollmentRequired: row.enrollment_required,
      enrollmentNotes: row.enrollment_notes,
      expiresOn: text(row.expires_on),
      stackingNotes: row.stacking_notes,
      excerpt: row.support_excerpt,
      origin: row.origin,
      verification: row.verification,
      sourceUrl: row.source_url,
      checkedAt: text(row.checked_at),
      lastSuccessAt: text(row.last_success_at),
      failureNote: row.failure_note,
      enrolled: row.enrolled === true,
    })),
    fees: fees.map((row) => ({
      cardId: row.card_id,
      annualFeeCents: row.annual_fee_cents,
      excerpt: row.support_excerpt,
      origin: row.origin,
      verification: row.verification,
      sourceUrl: row.source_url,
      checkedAt: text(row.checked_at),
      lastSuccessAt: text(row.last_success_at),
      failureNote: row.failure_note,
    })),
    heldCards: heldCards.map((row) => ({
      id: row.id,
      cardId: row.card_id,
      anniversary: text(row.fee_anniversary),
      militaryRelief: row.military_relief,
    })),
    subscriptions: subscriptions.map((row) => ({
      id: row.id,
      serviceId: row.service_id,
      planQuoteId: row.plan_quote_id,
      userCardId: row.user_card_id,
      billing: row.billing_frequency,
      renewalDate: text(row.renewal_date),
      priceOverrideCents: row.price_override_cents,
      status: row.status,
      notes: row.notes,
    })),
    entries: entries.map((row) => ({
      id: row.id,
      yearMonth: row.year_month,
      subscriptionId: row.subscription_id,
      benefitId: row.benefit_id,
      kind: row.kind,
      label: row.label,
      amountCents: row.amount_cents,
      points: row.points,
      affectsOop: row.affects_oop,
      note: row.note,
      source: row.source,
    })),
    refresh,
  };
}

export const getLedger = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<Ledger> => {
    const sql = await getSql();
    return readLedger(sql, context.userId);
  });

export const updateSettings = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { qualifiesStudent: boolean; qualifiesMilitary: boolean }) => {
    if (typeof input?.qualifiesStudent !== "boolean" || typeof input?.qualifiesMilitary !== "boolean") {
      throw new Error("Settings are invalid.");
    }
    return input;
  })
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    await sql`
      insert into user_settings (user_id, qualifies_student, qualifies_military)
      values (${context.userId}, ${data.qualifiesStudent}, ${data.qualifiesMilitary})
      on conflict (user_id) do update set
        qualifies_student = excluded.qualifies_student,
        qualifies_military = excluded.qualifies_military
    `;
    return readLedger(sql, context.userId);
  });

type PlanInput = {
  id?: string;
  serviceId: string;
  name: string;
  billing: string;
  priceCents: number | null;
  studentPriceCents: number | null;
  militaryPriceCents: number | null;
  eligibility: string;
  terms: string;
};

export const savePlan = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: PlanInput) => {
    if (!SERVICES.some((service) => service.id === input.serviceId)) throw new Error("Unknown service.");
    return {
      ...input,
      name: optionalText(input.name, 120) || SERVICES.find((service) => service.id === input.serviceId)?.name || "What I pay",
      billing: period(input.billing),
      priceCents: cents(input.priceCents),
      studentPriceCents: cents(input.studentPriceCents),
      militaryPriceCents: cents(input.militaryPriceCents),
      eligibility: optionalText(input.eligibility, 400),
      terms: optionalText(input.terms, 800),
    };
  })
  .handler(async ({ context, data }) => {
    if (data.priceCents == null && data.studentPriceCents == null && data.militaryPriceCents == null) {
      throw new Error("Enter at least one price, or leave the plan off the books.");
    }
    const sql = await getSql();
    const id = data.id || crypto.randomUUID();
    const owned = await sql<{ id: string }>`
      select id from plan_quotes where id = ${id} and user_id = ${context.userId}
    `;
    if (owned[0]) {
      await sql`
        update plan_quotes set
          service_id = ${data.serviceId}, name = ${data.name}, billing_period = ${data.billing},
          price_cents = ${data.priceCents}, student_price_cents = ${data.studentPriceCents},
          military_price_cents = ${data.militaryPriceCents}, eligibility = ${data.eligibility},
          terms = ${data.terms}, origin = 'manual', verification = 'user_entered',
          failure_note = '', checked_at = now()
        where id = ${id} and user_id = ${context.userId}
      `;
    } else {
      await sql`
        insert into plan_quotes (
          id, user_id, service_id, name, billing_period, price_cents, student_price_cents,
          military_price_cents, eligibility, terms, origin, verification, checked_at, failure_note
        ) values (
          ${id}, ${context.userId}, ${data.serviceId}, ${data.name}, ${data.billing}, ${data.priceCents},
          ${data.studentPriceCents}, ${data.militaryPriceCents}, ${data.eligibility}, ${data.terms},
          'manual', 'user_entered', now(), ''
        )
      `;
    }
    return readLedger(sql, context.userId);
  });

export const deletePlan = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((id: string) => required(id, "Plan", 80))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    await sql`update subscriptions set plan_quote_id = null where plan_quote_id = ${data} and user_id = ${context.userId}`;
    await sql`delete from plan_quotes where id = ${data} and user_id = ${context.userId}`;
    return readLedger(sql, context.userId);
  });

type BenefitInput = {
  id?: string;
  cardId: string;
  name: string;
  kind: string;
  amountCents: number | null;
  rateBps: number | null;
  pointsPerDollarMilli: number | null;
  period: string;
  eligibleServiceIds: string[];
  enrollmentRequired: boolean;
  enrollmentNotes: string;
  expiresOn: string | null;
  stackingNotes: string;
};

export const saveBenefit = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: BenefitInput) => {
    if (!CARDS.some((card) => card.id === input.cardId)) throw new Error("Unknown card.");
    const ids = Array.isArray(input.eligibleServiceIds)
      ? input.eligibleServiceIds.filter((id) => SERVICES.some((service) => service.id === id))
      : [];
    return {
      ...input,
      name: required(input.name, "Benefit name"),
      kind: kind(input.kind),
      amountCents: cents(input.amountCents),
      rateBps: cents(input.rateBps),
      pointsPerDollarMilli: cents(input.pointsPerDollarMilli),
      period: period(input.period),
      eligibleServiceIds: ids,
      enrollmentRequired: input.enrollmentRequired === true,
      enrollmentNotes: optionalText(input.enrollmentNotes, 400),
      expiresOn: dateOrNull(input.expiresOn),
      stackingNotes: optionalText(input.stackingNotes, 400),
    };
  })
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const id = data.id || crypto.randomUUID();
    const eligible = data.eligibleServiceIds.join(",");
    const owned = await sql<{ id: string }>`
      select id from benefit_quotes where id = ${id} and user_id = ${context.userId}
    `;
    if (owned[0]) {
      await sql`
        update benefit_quotes set
          card_id = ${data.cardId}, name = ${data.name}, kind = ${data.kind},
          amount_cents = ${data.amountCents}, rate_bps = ${data.rateBps},
          points_per_dollar_milli = ${data.pointsPerDollarMilli}, period = ${data.period},
          eligible_service_ids = ${eligible}, enrollment_required = ${data.enrollmentRequired},
          enrollment_notes = ${data.enrollmentNotes}, expires_on = ${data.expiresOn},
          stacking_notes = ${data.stackingNotes}, origin = 'manual', verification = 'user_entered',
          failure_note = '', checked_at = now()
        where id = ${id} and user_id = ${context.userId}
      `;
    } else {
      await sql`
        insert into benefit_quotes (
          id, user_id, card_id, name, kind, amount_cents, rate_bps, points_per_dollar_milli,
          period, eligible_service_ids, enrollment_required, enrollment_notes, expires_on,
          stacking_notes, origin, verification, checked_at, failure_note
        ) values (
          ${id}, ${context.userId}, ${data.cardId}, ${data.name}, ${data.kind}, ${data.amountCents},
          ${data.rateBps}, ${data.pointsPerDollarMilli}, ${data.period}, ${eligible},
          ${data.enrollmentRequired}, ${data.enrollmentNotes}, ${data.expiresOn}, ${data.stackingNotes},
          'manual', 'user_entered', now(), ''
        )
      `;
    }
    return readLedger(sql, context.userId);
  });

export const deleteBenefit = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((id: string) => required(id, "Benefit", 80))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    await sql`delete from benefit_enrollments where benefit_id = ${data} and user_id = ${context.userId}`;
    await sql`delete from benefit_quotes where id = ${data} and user_id = ${context.userId}`;
    return readLedger(sql, context.userId);
  });

export const setEnrollment = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { benefitId: string; enrolled: boolean }) => {
    if (typeof input?.enrolled !== "boolean") throw new Error("Enrollment is invalid.");
    return { benefitId: required(input.benefitId, "Benefit", 80), enrolled: input.enrolled };
  })
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const owned = await sql<{ id: string }>`
      select id from benefit_quotes where id = ${data.benefitId} and user_id = ${context.userId}
    `;
    if (!owned[0]) throw new Error("Benefit not found.");
    await sql`
      insert into benefit_enrollments (user_id, benefit_id, enrolled)
      values (${context.userId}, ${data.benefitId}, ${data.enrolled})
      on conflict (user_id, benefit_id) do update set enrolled = excluded.enrolled
    `;
    return readLedger(sql, context.userId);
  });

export const saveFee = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { cardId: string; annualFeeCents: number | null }) => {
    if (!CARDS.some((card) => card.id === input.cardId)) throw new Error("Unknown card.");
    return { cardId: input.cardId, annualFeeCents: cents(input.annualFeeCents) };
  })
  .handler(async ({ context, data }) => {
    if (data.annualFeeCents == null) throw new Error("Enter the annual fee, including 0 if it is free.");
    const sql = await getSql();
    const existing = await sql<{ id: string }>`
      select id from fee_quotes where user_id = ${context.userId} and card_id = ${data.cardId}
    `;
    if (existing[0]) {
      await sql`
        update fee_quotes set
          annual_fee_cents = ${data.annualFeeCents}, origin = 'manual', verification = 'user_entered',
          failure_note = '', checked_at = now()
        where id = ${existing[0].id} and user_id = ${context.userId}
      `;
    } else {
      await sql`
        insert into fee_quotes (
          id, user_id, card_id, annual_fee_cents, origin, verification, checked_at, failure_note
        ) values (
          ${crypto.randomUUID()}, ${context.userId}, ${data.cardId}, ${data.annualFeeCents},
          'manual', 'user_entered', now(), ''
        )
      `;
    }
    return readLedger(sql, context.userId);
  });

export const holdCard = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { cardId: string; anniversary: string | null }) => {
    if (!CARDS.some((card) => card.id === input.cardId)) throw new Error("Unknown card.");
    return { cardId: input.cardId, anniversary: dateOrNull(input.anniversary) };
  })
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const existing = await sql<{ id: string }>`
      select id from user_cards where user_id = ${context.userId} and card_id = ${data.cardId}
    `;
    if (existing[0]) {
      await sql`
        update user_cards set fee_anniversary = ${data.anniversary}
        where id = ${existing[0].id} and user_id = ${context.userId}
      `;
    } else {
      await sql`
        insert into user_cards (id, user_id, card_id, fee_anniversary)
        values (${crypto.randomUUID()}, ${context.userId}, ${data.cardId}, ${data.anniversary})
      `;
    }
    return readLedger(sql, context.userId);
  });

export const releaseCard = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((cardId: string) => required(cardId, "Card", 80))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const held = await sql<{ id: string }>`
      select id from user_cards where user_id = ${context.userId} and card_id = ${data}
    `;
    if (held[0]) {
      await sql`update subscriptions set user_card_id = null where user_card_id = ${held[0].id} and user_id = ${context.userId}`;
      await sql`delete from user_cards where id = ${held[0].id} and user_id = ${context.userId}`;
    }
    return readLedger(sql, context.userId);
  });

export const setRelief = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { cardId: string; militaryRelief: string }) => {
    if (!["unconfirmed", "waived_user", "not_waived_user"].includes(input.militaryRelief)) {
      throw new Error("Unknown fee-relief status.");
    }
    return { cardId: required(input.cardId, "Card", 80), militaryRelief: input.militaryRelief };
  })
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const updated = await sql`
      update user_cards set military_relief = ${data.militaryRelief}
      where user_id = ${context.userId} and card_id = ${data.cardId}
    `;
    void updated;
    return readLedger(sql, context.userId);
  });

type SubscriptionInput = {
  id?: string;
  serviceId: string;
  planQuoteId: string | null;
  userCardId: string | null;
  billing: string;
  renewalDate: string | null;
  priceOverrideCents: number | null;
  status: string;
  notes: string;
};

export const saveSubscription = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: SubscriptionInput) => {
    if (!SERVICES.some((service) => service.id === input.serviceId)) throw new Error("Unknown service.");
    if (!["active", "paused", "canceled"].includes(input.status)) throw new Error("Unknown status.");
    return {
      ...input,
      billing: period(input.billing),
      renewalDate: dateOrNull(input.renewalDate),
      priceOverrideCents: cents(input.priceOverrideCents),
      notes: optionalText(input.notes, 400),
      planQuoteId: input.planQuoteId ? required(input.planQuoteId, "Plan", 80) : null,
      userCardId: input.userCardId ? required(input.userCardId, "Card", 80) : null,
      status: input.status as SubscriptionRow["status"],
    };
  })
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    if (data.planQuoteId) {
      const plan = await sql<{ id: string }>`
        select id from plan_quotes where id = ${data.planQuoteId} and user_id = ${context.userId}
      `;
      if (!plan[0]) throw new Error("That plan is not in your quotes.");
    }
    if (data.userCardId) {
      const card = await sql<{ id: string }>`
        select id from user_cards where id = ${data.userCardId} and user_id = ${context.userId}
      `;
      if (!card[0]) throw new Error("Choose a card you hold.");
    }
    const id = data.id || crypto.randomUUID();
    const renewalDate = data.renewalDate ?? firstOfNextMonth();
    const owned = await sql<{ id: string }>`
      select id from subscriptions where id = ${id} and user_id = ${context.userId}
    `;
    if (owned[0]) {
      await sql`
        update subscriptions set
          service_id = ${data.serviceId}, plan_quote_id = ${data.planQuoteId}, user_card_id = ${data.userCardId},
          billing_frequency = ${data.billing}, renewal_date = ${renewalDate},
          price_override_cents = ${data.priceOverrideCents}, status = ${data.status}, notes = ${data.notes}
        where id = ${id} and user_id = ${context.userId}
      `;
    } else {
      await sql`
        insert into subscriptions (
          id, user_id, service_id, plan_quote_id, user_card_id, billing_frequency, renewal_date,
          price_override_cents, status, notes
        ) values (
          ${id}, ${context.userId}, ${data.serviceId}, ${data.planQuoteId}, ${data.userCardId},
          ${data.billing}, ${renewalDate}, ${data.priceOverrideCents}, ${data.status}, ${data.notes}
        )
      `;
    }
    return readLedger(sql, context.userId);
  });

export const deleteSubscription = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((id: string) => required(id, "Subscription", 80))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    await sql`delete from subscriptions where id = ${data} and user_id = ${context.userId}`;
    return readLedger(sql, context.userId);
  });

type EntryInput = {
  id?: string;
  yearMonth: string;
  kind: string;
  label: string;
  amountCents: number;
  points: number | null;
  affectsOop: boolean;
  note: string;
};

export const saveEntry = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: EntryInput) => {
    const entryKind = required(input.kind, "Type", 40);
    if (!["charge", "statement_credit", "included_membership", "cash_back", "points", "card_fee", "adjustment"].includes(entryKind)) {
      throw new Error("Unknown entry type.");
    }
    const amount = cents(input.amountCents);
    if (amount == null) throw new Error("Enter an amount.");
    return {
      id: input.id,
      yearMonth: yearMonth(input.yearMonth),
      kind: entryKind,
      label: required(input.label, "Label"),
      amountCents: amount,
      points: input.points == null ? null : cents(input.points),
      affectsOop: input.affectsOop === true,
      note: optionalText(input.note, 400),
    };
  })
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const id = data.id || crypto.randomUUID();
    const owned = await sql<{ source: string }>`
      select source from monthly_entries where id = ${id} and user_id = ${context.userId}
    `;
    if (owned[0]) {
      await sql`
        update monthly_entries set
          year_month = ${data.yearMonth}, kind = ${data.kind}, label = ${data.label},
          amount_cents = ${data.amountCents}, points = ${data.points}, affects_oop = ${data.affectsOop},
          note = ${data.note}
        where id = ${id} and user_id = ${context.userId}
      `;
    } else {
      await sql`
        insert into monthly_entries (
          id, user_id, year_month, kind, label, amount_cents, points, affects_oop, note, source
        ) values (
          ${id}, ${context.userId}, ${data.yearMonth}, ${data.kind}, ${data.label}, ${data.amountCents},
          ${data.points}, ${data.affectsOop}, ${data.note}, 'manual'
        )
      `;
    }
    return readLedger(sql, context.userId);
  });

export const deleteEntry = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((id: string) => required(id, "Entry", 80))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    await sql`delete from monthly_entries where id = ${data} and user_id = ${context.userId}`;
    return readLedger(sql, context.userId);
  });

export const snapshotMonth = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { yearMonth: string }) => ({ yearMonth: yearMonth(input.yearMonth) }))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const ledger = await readLedger(sql, context.userId);
    const estimate = buildMonthEstimate(ledgerToEstimate(ledger, data.yearMonth));
    await sql`
      delete from monthly_entries
      where user_id = ${context.userId} and year_month = ${data.yearMonth} and source = 'snapshot'
    `;
    const stamp = "Saved from the estimate. Later catalog changes do not edit this row.";
    for (const charge of estimate.charges) {
      await sql`
        insert into monthly_entries (
          id, user_id, year_month, subscription_id, kind, label, amount_cents, affects_oop, note, source
        ) values (
          ${crypto.randomUUID()}, ${context.userId}, ${data.yearMonth}, ${charge.subscriptionId}, 'charge',
          ${`${charge.serviceName} · ${charge.label}`}, ${charge.amountCents}, true, ${stamp}, 'snapshot'
        )
      `;
    }
    for (const credit of estimate.credits.filter((item) => item.reducesOop)) {
      await sql`
        insert into monthly_entries (
          id, user_id, year_month, subscription_id, benefit_id, kind, label, amount_cents, affects_oop, note, source
        ) values (
          ${crypto.randomUUID()}, ${context.userId}, ${data.yearMonth}, ${credit.subscriptionId}, ${credit.benefitId},
          ${credit.kind}, ${credit.benefitName}, ${credit.amountCents}, true, ${stamp}, 'snapshot'
        )
      `;
    }
    for (const reward of estimate.rewards) {
      await sql`
        insert into monthly_entries (
          id, user_id, year_month, kind, label, amount_cents, points, affects_oop, note, source
        ) values (
          ${crypto.randomUUID()}, ${context.userId}, ${data.yearMonth},
          ${reward.points > 0 && reward.cashBackCents === 0 ? "points" : "cash_back"},
          ${reward.label}, ${reward.cashBackCents}, ${reward.points || null}, false, ${stamp}, 'snapshot'
        )
      `;
    }
    for (const fee of estimate.cardFees.filter((item) => item.scheduled && item.amountCents != null)) {
      await sql`
        insert into monthly_entries (
          id, user_id, year_month, kind, label, amount_cents, affects_oop, note, source
        ) values (
          ${crypto.randomUUID()}, ${context.userId}, ${data.yearMonth}, 'card_fee',
          ${`${fee.cardName} annual fee`}, ${fee.amountCents}, true, ${fee.note}, 'snapshot'
        )
      `;
    }
    return readLedger(sql, context.userId);
  });

export const beginRefresh = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { scope: "all" | "service" | "card"; targetId?: string | null }) => {
    if (!["all", "service", "card"].includes(input?.scope)) throw new Error("Unknown refresh.");
    return { scope: input.scope, targetId: input.targetId ?? null };
  })
  .handler(async ({ context, data }) => {
    const { startRefresh } = await import("./refresh.server");
    return startRefresh(context.userId, data.scope, data.targetId);
  });

export const stepRefresh = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { runId: string }) => ({ runId: required(input.runId, "Refresh", 80) }))
  .handler(async ({ context, data }) => {
    const { advanceRefresh } = await import("./refresh.server");
    return advanceRefresh(context.userId, data.runId);
  });


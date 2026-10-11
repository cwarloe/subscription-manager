import { BILLING_PERIODS, BENEFIT_KINDS, type BenefitKind, type BillingPeriod } from "./money.ts";
import { SERVICE_IDS } from "./catalog.ts";

export type ExtractedPlan = {
  name: string;
  billing: BillingPeriod;
  priceCents: number | null;
  studentPriceCents: number | null;
  militaryPriceCents: number | null;
  eligibility: string;
  terms: string;
  excerpt: string;
};

export type ExtractedBenefit = {
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
};

export type ExtractedPage = {
  plans: ExtractedPlan[];
  annualFeeCents: number | null;
  annualFeeExcerpt: string;
  benefits: ExtractedBenefit[];
};

const MAX_CENTS = 2_000_000;

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

export function htmlToText(html: string): string {
  return normalize(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&/gi, "&")
      .replace(/&#39;|'/gi, "'")
      .replace(/"/gi, '"')
      .replace(/</gi, "<")
      .replace(/>/gi, ">"),
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function centsAppear(excerpt: string, cents: number): boolean {
  const dollars = Math.floor(cents / 100);
  const fraction = cents % 100;
  if (fraction === 0) {
    const forms = [...new Set([String(dollars), dollars.toLocaleString("en-US")])];
    return forms.some((form) =>
      new RegExp(`(?<!\\d)\\$${escapeRegExp(form)}(?:\\.00)?(?!\\d)(?!\\.)`, "i").test(excerpt),
    );
  }
  const dotted = `${dollars}.${fraction.toString().padStart(2, "0")}`;
  return new RegExp(`(?<!\\d)\\$?${escapeRegExp(dotted)}(?!\\d)`, "i").test(excerpt);
}

export function excerptSupportsAmount(pageText: string, excerpt: string, cents: number | null): boolean {
  if (cents == null) return true;
  if (!Number.isInteger(cents) || cents < 0 || cents > MAX_CENTS) return false;
  const page = normalize(pageText);
  const quote = normalize(excerpt);
  if (quote.length < 8 || !page.includes(quote)) return false;
  return centsAppear(quote, cents);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asString(value: unknown, max = 500): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}

function asCents(value: unknown): number | null {
  if (value == null || value === "") return null;
  if (typeof value !== "number" || !Number.isInteger(value)) return null;
  if (value < 0 || value > MAX_CENTS) return null;
  return value;
}

function asPeriod(value: unknown): BillingPeriod | null {
  return BILLING_PERIODS.includes(value as BillingPeriod) ? (value as BillingPeriod) : null;
}

function asKind(value: unknown): BenefitKind | null {
  return BENEFIT_KINDS.includes(value as BenefitKind) ? (value as BenefitKind) : null;
}

function stripFence(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return fenced ? fenced[1].trim() : trimmed;
}

/** Keep only amounts whose excerpt is present in the official page text. */
export function validateExtraction(raw: string, pageText: string): ExtractedPage {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFence(raw));
  } catch {
    return { plans: [], annualFeeCents: null, annualFeeExcerpt: "", benefits: [] };
  }
  const body = asRecord(parsed);
  if (!body) return { plans: [], annualFeeCents: null, annualFeeExcerpt: "", benefits: [] };

  const plans: ExtractedPlan[] = [];
  if (Array.isArray(body.plans)) {
    for (const item of body.plans) {
      const row = asRecord(item);
      if (!row) continue;
      const billing = asPeriod(row.billing_period);
      const name = asString(row.name, 120);
      if (!billing || !name) continue;
      const priceCents = asCents(row.price_cents);
      const studentPriceCents = asCents(row.student_price_cents);
      const militaryPriceCents = asCents(row.military_price_cents);
      const excerpt = asString(row.excerpt, 400);
      if (priceCents == null || !excerptSupportsAmount(pageText, excerpt, priceCents)) continue;
      plans.push({
        name,
        billing,
        priceCents,
        studentPriceCents: excerptSupportsAmount(pageText, excerpt, studentPriceCents) ? studentPriceCents : null,
        militaryPriceCents: excerptSupportsAmount(pageText, excerpt, militaryPriceCents)
          ? militaryPriceCents
          : null,
        eligibility: asString(row.eligibility, 400),
        terms: asString(row.terms, 800),
        excerpt,
      });
    }
  }

  const annualFeeCents = asCents(body.annual_fee_cents);
  const annualFeeExcerpt = asString(body.annual_fee_excerpt, 400);
  const annualOk =
    annualFeeCents != null && excerptSupportsAmount(pageText, annualFeeExcerpt, annualFeeCents);

  const benefits: ExtractedBenefit[] = [];
  if (Array.isArray(body.benefits)) {
    for (const item of body.benefits) {
      const row = asRecord(item);
      if (!row) continue;
      const name = asString(row.name, 160);
      const kind = asKind(row.kind);
      const period = asPeriod(row.period);
      if (!name || !kind || !period) continue;
      const amountCents = asCents(row.amount_cents);
      const rateBps = asCents(row.rate_bps);
      const points = asCents(row.points_per_dollar_milli);
      const excerpt = asString(row.excerpt, 400);
      const numericClaims = [amountCents, rateBps != null ? rateBps : null].filter((value) => value != null);
      if (amountCents != null && !excerptSupportsAmount(pageText, excerpt, amountCents)) continue;
      if (amountCents == null && rateBps == null && points == null) continue;
      if (numericClaims.length === 0 && points == null) continue;
      if ((rateBps != null || points != null) && normalize(excerpt).length < 8) continue;
      if ((rateBps != null || points != null) && !normalize(pageText).includes(normalize(excerpt))) continue;
      const eligible = Array.isArray(row.eligible_service_ids)
        ? row.eligible_service_ids.filter((id): id is string => typeof id === "string" && SERVICE_IDS.has(id))
        : [];
      const expires = asString(row.expires_on, 10);
      benefits.push({
        name,
        kind,
        amountCents,
        rateBps: rateBps != null && rateBps <= 10000 ? rateBps : null,
        pointsPerDollarMilli: points,
        period,
        eligibleServiceIds: [...new Set(eligible)],
        enrollmentRequired: row.enrollment_required === true,
        enrollmentNotes: asString(row.enrollment_notes, 400),
        expiresOn: /^\d{4}-\d{2}-\d{2}$/.test(expires) ? expires : null,
        stackingNotes: asString(row.stacking_notes, 400),
        excerpt,
      });
    }
  }

  return {
    plans,
    annualFeeCents: annualOk ? annualFeeCents : null,
    annualFeeExcerpt: annualOk ? annualFeeExcerpt : "",
    benefits,
  };
}

export function sameRegistrableHost(officialUrl: string, finalUrl: string): boolean {
  try {
    const official = new URL(officialUrl);
    const final = new URL(finalUrl);
    if (official.protocol !== "https:" || final.protocol !== "https:") return false;
    const root = (host: string) => host.toLowerCase().replace(/^www\./, "").split(".").slice(-2).join(".");
    return root(official.hostname) === root(final.hostname);
  } catch {
    return false;
  }
}

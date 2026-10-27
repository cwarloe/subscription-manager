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

function collapse(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalize(value: string): string {
  return collapse(value).toLowerCase();
}

function decodeEntities(value: string): string {
  const named: Record<string, string> = {
    nbsp: " ",
    amp: "&",
    quot: '"',
    apos: "'",
    lt: "<",
    gt: ">",
    dollar: "$",
  };
  let current = value;
  for (let pass = 0; pass < 2; pass += 1) {
    current = current
      .replace(/&#x([0-9a-f]+);/gi, (full, hex: string) => {
        const code = Number.parseInt(hex, 16);
        return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : full;
      })
      .replace(/&#(\d+);/g, (full, num: string) => {
        const code = Number(num);
        return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : full;
      })
      .replace(/&([a-z]+);/gi, (full, name: string) => named[name.toLowerCase()] ?? full);
  }
  return current;
}

export function htmlToText(html: string): string {
  const withoutNoise = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ");
  return collapse(decodeEntities(withoutNoise).replace(/<[^>]+>/g, " "));
}

/** Keep the parts of a page that actually mention a price, not the stylesheet. */
export function pricingText(html: string): string {
  const jsonLd = [
    ...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi),
  ]
    .map((match) => decodeEntities(match[1] ?? ""))
    .join("\n");
  const source = collapse(`${jsonLd}\n${htmlToText(html)}`);
  const ranked: { score: number; index: number; text: string }[] = [];
  const seen = new Set<string>();
  const re = /\$\s?\d[\d,]*(?:\.\d{2})?|\bfree\b/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source))) {
    const start = Math.max(0, match.index - 160);
    const end = Math.min(source.length, match.index + match[0].length + 160);
    const text = source.slice(start, end).trim();
    const key = text.slice(0, 100);
    if (seen.has(key)) continue;
    seen.add(key);
    const score = /\b(month|monthly|year|annual|plan|fee|credit|premium|\/\s?mo)\b/i.test(text)
      ? 2
      : 1;
    ranked.push({ score, index: match.index, text });
    if (ranked.length >= 250) break;
  }
  ranked.sort((a, b) => b.score - a.score || a.index - b.index);
  const joined = ranked
    .map((item) => item.text)
    .join("\n")
    .slice(0, 12_000);
  return joined.length >= 80 ? joined : source.slice(0, 12_000);
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

function closestDollars(window: string): number | null {
  const match = window.match(/\$\s?(\d{1,3}(?:,\d{3})*|\d+)(?:\.(\d{2}))?/);
  if (!match) return null;
  const dollars = Number(match[1].replace(/,/g, ""));
  const fraction = match[2] ? Number(match[2]) : 0;
  if (!Number.isFinite(dollars) || !Number.isFinite(fraction)) return null;
  return dollars * 100 + fraction;
}

/** The claimed price has to be the price written next to that plan name. */
export function priceNearName(pageText: string, name: string, cents: number): boolean {
  const page = normalize(pageText);
  const token = normalize(name);
  if (token.length < 2) return false;
  const re = new RegExp(`(?:^|[^a-z0-9+])${escapeRegExp(token)}(?=$|[^a-z0-9+])`, "gi");
  let match: RegExpExecArray | null;
  while ((match = re.exec(page))) {
    const after = page.slice(match.index, Math.min(page.length, match.index + token.length + 80));
    const before = page.slice(Math.max(0, match.index - 24), match.index);
    const tail = after.slice(token.length);
    const head = tail.slice(0, 32);
    const beforeDollar = head.split("$")[0] ?? "";
    if (/[a-z]{3,}/i.test(beforeDollar) && /\$\s?\d/.test(head)) continue;
    const horizon = tail.slice(0, 180);
    if (cents === 0 && /\bfree\b/.test(`${before} ${horizon}`)) return true;
    const found = closestDollars(horizon) ?? closestDollars(before);
    if (found === cents) return true;
  }
  return false;
}

export function excerptSupportsAmount(
  pageText: string,
  excerpt: string,
  cents: number | null,
): boolean {
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
      const freeExcerpt =
        priceCents === 0 &&
        /\bfree\b/i.test(excerpt) &&
        normalize(pageText).includes(normalize(excerpt));
      if (
        priceCents == null ||
        (!excerptSupportsAmount(pageText, excerpt, priceCents) && !freeExcerpt) ||
        !priceNearName(pageText, name, priceCents)
      ) {
        continue;
      }
      plans.push({
        name,
        billing,
        priceCents,
        studentPriceCents: excerptSupportsAmount(pageText, excerpt, studentPriceCents)
          ? studentPriceCents
          : null,
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
      const numericClaims = [amountCents, rateBps != null ? rateBps : null].filter(
        (value) => value != null,
      );
      if (amountCents != null && !excerptSupportsAmount(pageText, excerpt, amountCents)) continue;
      if (amountCents == null && rateBps == null && points == null) continue;
      if (numericClaims.length === 0 && points == null) continue;
      if ((rateBps != null || points != null) && normalize(excerpt).length < 8) continue;
      if ((rateBps != null || points != null) && !normalize(pageText).includes(normalize(excerpt)))
        continue;
      const eligible = Array.isArray(row.eligible_service_ids)
        ? row.eligible_service_ids.filter(
            (id): id is string => typeof id === "string" && SERVICE_IDS.has(id),
          )
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
    const root = (host: string) =>
      host
        .toLowerCase()
        .replace(/^www\./, "")
        .split(".")
        .slice(-2)
        .join(".");
    return root(official.hostname) === root(final.hostname);
  } catch {
    return false;
  }
}

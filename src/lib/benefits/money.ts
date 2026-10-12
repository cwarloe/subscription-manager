export type Verification = "unknown" | "verified" | "stale" | "user_entered";

export type BillingPeriod = "monthly" | "quarterly" | "semiannual" | "annual";

export type BenefitKind =
  | "statement_credit"
  | "included_membership"
  | "cash_back"
  | "points"
  | "other";

export const BILLING_PERIODS: BillingPeriod[] = [
  "monthly",
  "quarterly",
  "semiannual",
  "annual",
];

export const BENEFIT_KINDS: BenefitKind[] = [
  "statement_credit",
  "included_membership",
  "cash_back",
  "points",
  "other",
];

const MONTHS: Record<BillingPeriod, number> = {
  monthly: 1,
  quarterly: 3,
  semiannual: 6,
  annual: 12,
};

export function periodMonths(period: BillingPeriod): number {
  return MONTHS[period];
}

export function formatCents(cents: number | null | undefined): string {
  if (cents == null || !Number.isInteger(cents)) return "Unknown";
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100).toLocaleString("en-US");
  const remainder = (abs % 100).toString().padStart(2, "0");
  return `${sign}$${dollars}.${remainder}`;
}

/** Parse a dollar string into integer cents. Empty is null. Rejects floats and junk. */
export function dollarsToCents(input: string): number | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(trimmed)) {
    throw new Error("Enter a dollar amount like 15.99, or leave it blank if unknown.");
  }
  const [dollars, fraction = ""] = trimmed.split(".");
  return Number(dollars) * 100 + Number(fraction.padEnd(2, "0"));
}

export function centsToDollarInput(cents: number | null): string {
  if (cents == null) return "";
  const dollars = Math.floor(cents / 100);
  const remainder = (cents % 100).toString().padStart(2, "0");
  return `${dollars}.${remainder}`;
}

export function firstOfNextMonth(now = new Date()): string {
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const month = String(next.getUTCMonth() + 1).padStart(2, "0");
  return `${next.getUTCFullYear()}-${month}-01`;
}

export function monthlyEquivalent(cents: number, period: BillingPeriod): number {
  return Math.round(cents / periodMonths(period));
}

export function periodKey(period: BillingPeriod, yearMonth: string): string {
  const year = Number(yearMonth.slice(0, 4));
  const month = Number(yearMonth.slice(5, 7));
  if (period === "monthly") return yearMonth;
  if (period === "quarterly") return `${year}-Q${Math.ceil(month / 3)}`;
  if (period === "semiannual") return `${year}-H${month <= 6 ? 1 : 2}`;
  return String(year);
}

export function isChargeMonth(
  renewalDate: string | null,
  billing: BillingPeriod,
  yearMonth: string,
): { charged: boolean; reason: string } {
  if (billing === "monthly") {
    return { charged: true, reason: "Monthly plans are charged every month." };
  }
  if (!renewalDate) {
    return {
      charged: false,
      reason: "Renewal date is missing, so this upfront charge is not placed in a month.",
    };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(renewalDate) || !/^\d{4}-\d{2}$/.test(yearMonth)) {
    return { charged: false, reason: "Renewal date is invalid." };
  }
  const anchor = renewalDate.slice(0, 7);
  if (yearMonth < anchor) {
    return { charged: false, reason: "This month is before the renewal anchor." };
  }
  const anchorMonth = Number(renewalDate.slice(5, 7));
  const month = Number(yearMonth.slice(5, 7));
  const step = periodMonths(billing);
  const charged = (month - anchorMonth + 12) % step === 0;
  return {
    charged,
    reason: charged
      ? "This is a charge month. The full term price is due, not the monthly equivalent."
      : "Not a charge month for this term.",
  };
}

export function verificationLabel(status: Verification): string {
  if (status === "verified") return "Verified";
  if (status === "stale") return "Stale";
  if (status === "user_entered") return "You entered";
  return "Unknown";
}

export function usableVerification(status: Verification): boolean {
  return status === "verified" || status === "stale" || status === "user_entered";
}

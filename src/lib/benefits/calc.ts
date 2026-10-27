import { findDuplicates, findOverlaps } from "./overlaps.ts";
import {
  monthlyEquivalent,
  isChargeMonth,
  periodKey,
  usableVerification,
  type BenefitKind,
  type BillingPeriod,
  type Verification,
} from "./money.ts";

export type PriceChoice = {
  cents: number | null;
  basis: string;
  verification: Verification;
};

export function selectPrice(input: {
  listCents: number | null;
  studentCents: number | null;
  militaryCents: number | null;
  overrideCents: number | null;
  qualifiesStudent: boolean;
  qualifiesMilitary: boolean;
  verification: Verification;
}): PriceChoice {
  if (input.overrideCents != null) {
    return {
      cents: input.overrideCents,
      basis: "Your price override",
      verification: "user_entered",
    };
  }
  if (!usableVerification(input.verification)) {
    return {
      cents: null,
      basis: "No verified or entered price",
      verification: "unknown",
    };
  }
  const options: { cents: number; basis: string }[] = [];
  if (input.listCents != null) options.push({ cents: input.listCents, basis: "List price" });
  if (input.qualifiesStudent && input.studentCents != null) {
    options.push({ cents: input.studentCents, basis: "Student price" });
  }
  if (input.qualifiesMilitary && input.militaryCents != null) {
    options.push({ cents: input.militaryCents, basis: "Military price" });
  }
  if (options.length === 0) {
    return {
      cents: null,
      basis: "No eligible price on this quote",
      verification: input.verification,
    };
  }
  options.sort((a, b) => a.cents - b.cents || a.basis.localeCompare(b.basis));
  const best = options[0];
  const basis =
    options.length > 1
      ? `${best.basis}. Student and military prices are alternate prices, not stacked discounts.`
      : best.basis;
  return { cents: best.cents, basis, verification: input.verification };
}

export type PlanQuoteInput = {
  id: string;
  serviceId: string;
  name: string;
  billing: BillingPeriod;
  listCents: number | null;
  studentCents: number | null;
  militaryCents: number | null;
  verification: Verification;
};

export type SubscriptionInput = {
  id: string;
  serviceId: string;
  serviceName: string;
  planQuoteId: string | null;
  userCardId: string | null;
  billing: BillingPeriod;
  renewalDate: string | null;
  priceOverrideCents: number | null;
  status: "active" | "paused" | "canceled";
};

export type BenefitInput = {
  id: string;
  userCardId: string;
  cardName: string;
  name: string;
  kind: BenefitKind;
  amountCents: number | null;
  rateBps: number | null;
  pointsPerDollarMilli: number | null;
  period: BillingPeriod;
  eligibleServiceIds: string[];
  enrollmentRequired: boolean;
  enrolled: boolean;
  expiresOn: string | null;
  verification: Verification;
};

export type CardFeeInput = {
  userCardId: string;
  cardName: string;
  anniversary: string | null;
  feeCents: number | null;
  feeVerification: Verification;
  militaryRelief: "unconfirmed" | "waived_user" | "not_waived_user";
};

export type PriorCreditUse = {
  benefitId: string;
  yearMonth: string;
  amountCents: number;
};

export type ChargeLine = {
  subscriptionId: string;
  serviceId: string;
  serviceName: string;
  label: string;
  amountCents: number;
  monthlyEquivalentCents: number;
  billing: BillingPeriod;
  verification: Verification;
  basis: string;
  userCardId: string | null;
};

export type CreditUse = {
  benefitId: string;
  benefitName: string;
  kind: BenefitKind;
  subscriptionId: string | null;
  serviceName: string | null;
  amountCents: number;
  reducesOop: boolean;
  verification: Verification;
  note: string;
};

export type RewardLine = {
  label: string;
  cashBackCents: number;
  points: number;
  verification: Verification;
  note: string;
};

export type FeeLine = {
  userCardId: string;
  cardName: string;
  amountCents: number | null;
  verification: Verification;
  note: string;
  scheduled: boolean;
};

export type UnknownItem = {
  subscriptionId: string;
  serviceName: string;
  reason: string;
};

export type Recommendation = {
  serviceId: string;
  serviceName: string;
  currentLabel: string;
  suggestion: string;
  assumptions: string[];
};

export type MonthEstimate = {
  yearMonth: string;
  charges: ChargeLine[];
  unknownSubscriptions: UnknownItem[];
  credits: CreditUse[];
  blockedBenefits: { benefitId: string; benefitName: string; reason: string }[];
  rewards: RewardLine[];
  cardFees: FeeLine[];
  overlaps: { ids: string[]; note: string }[];
  duplicateServiceIds: string[];
  grossChargeCents: number;
  discountCents: number;
  oopReductionCents: number;
  feeCents: number;
  expectedOopCents: number;
  incomplete: boolean;
  upfrontChargeCents: number;
  monthlyEquivalentOfUpfrontCents: number;
  rewardCashBackCents: number;
  rewardPoints: number;
  assumptions: string[];
  recommendations: Recommendation[];
};

export type EstimateInput = {
  yearMonth: string;
  qualifiesStudent: boolean;
  qualifiesMilitary: boolean;
  subscriptions: SubscriptionInput[];
  plans: PlanQuoteInput[];
  benefits: BenefitInput[];
  heldCardIds: string[];
  cardFees: CardFeeInput[];
  priorCreditUses: PriorCreditUse[];
  serviceNames: Record<string, string>;
};

function monthStart(yearMonth: string): string {
  return `${yearMonth}-01`;
}

function benefitAvailable(
  benefit: BenefitInput,
  yearMonth: string,
): { ok: boolean; reason: string } {
  if (!usableVerification(benefit.verification)) {
    return { ok: false, reason: "Benefit amount is unknown." };
  }
  if (benefit.expiresOn && benefit.expiresOn < monthStart(yearMonth)) {
    return { ok: false, reason: `Expired on ${benefit.expiresOn}.` };
  }
  if (benefit.enrollmentRequired && !benefit.enrolled) {
    return { ok: false, reason: "Enrollment is required and is not marked complete." };
  }
  return { ok: true, reason: "" };
}

function priorUsed(benefit: BenefitInput, yearMonth: string, prior: PriorCreditUse[]): number {
  const key = periodKey(benefit.period, yearMonth);
  return prior
    .filter(
      (row) => row.benefitId === benefit.id && periodKey(benefit.period, row.yearMonth) === key,
    )
    .reduce((sum, row) => sum + row.amountCents, 0);
}

export function buildMonthEstimate(input: EstimateInput): MonthEstimate {
  const assumptions = [
    "U.S. prices are in USD and stored as integer cents.",
    input.qualifiesStudent
      ? "Assumption: you qualify for student prices where a quote has one. This does not make a plan free."
      : "Student prices are turned off.",
    input.qualifiesMilitary
      ? "Assumption: you qualify for military subscription prices where a quote has one. Card annual-fee relief stays unconfirmed unless you mark it on that card."
      : "Military subscription prices are turned off.",
    "Annual, semiannual, and quarterly prices are charged in full on charge months. Monthly equivalents are informational only.",
    "Student and military prices do not stack. The lower eligible price is used.",
    "A shared benefit cap is spent once across eligible services in that benefit period.",
    "Statement credits and included memberships can reduce out-of-pocket. Cash back and points stay in rewards.",
    "Enrollment-required benefits are ignored until you mark them enrolled.",
    "Account-specific card offers stay unconfirmed unless you enter them.",
  ];

  const plansById = new Map(input.plans.map((plan) => [plan.id, plan]));
  const charges: ChargeLine[] = [];
  const unknownSubscriptions: UnknownItem[] = [];
  let discountCents = 0;
  let upfrontChargeCents = 0;
  let monthlyEquivalentOfUpfrontCents = 0;

  const active = input.subscriptions.filter((sub) => sub.status === "active");

  for (const sub of active) {
    const timing = isChargeMonth(sub.renewalDate, sub.billing, input.yearMonth);
    const plan = sub.planQuoteId ? plansById.get(sub.planQuoteId) : undefined;
    const price = selectPrice({
      listCents: plan?.listCents ?? null,
      studentCents: plan?.studentCents ?? null,
      militaryCents: plan?.militaryCents ?? null,
      overrideCents: sub.priceOverrideCents,
      qualifiesStudent: input.qualifiesStudent,
      qualifiesMilitary: input.qualifiesMilitary,
      verification: plan?.verification ?? "unknown",
    });
    if (!timing.charged) {
      if (price.cents == null && sub.priceOverrideCents == null) {
        unknownSubscriptions.push({
          subscriptionId: sub.id,
          serviceName: sub.serviceName,
          reason: `${timing.reason} Price is also unknown.`,
        });
      }
      continue;
    }
    if (price.cents == null) {
      unknownSubscriptions.push({
        subscriptionId: sub.id,
        serviceName: sub.serviceName,
        reason: "This is a charge month, but the price is unknown. It is not counted as $0.",
      });
      continue;
    }
    const equivalent = monthlyEquivalent(price.cents, sub.billing);
    charges.push({
      subscriptionId: sub.id,
      serviceId: sub.serviceId,
      serviceName: sub.serviceName,
      label: plan?.name ?? "Custom price",
      amountCents: price.cents,
      monthlyEquivalentCents: equivalent,
      billing: sub.billing,
      verification: price.verification,
      basis: price.basis,
      userCardId: sub.userCardId,
    });
    if (sub.billing !== "monthly") {
      upfrontChargeCents += price.cents;
      monthlyEquivalentOfUpfrontCents += equivalent;
    }
    if (
      plan &&
      sub.priceOverrideCents == null &&
      plan.listCents != null &&
      price.cents < plan.listCents
    ) {
      discountCents += plan.listCents - price.cents;
    }
  }

  const remaining = new Map(charges.map((charge) => [charge.subscriptionId, charge.amountCents]));
  const credits: CreditUse[] = [];
  const blockedBenefits: MonthEstimate["blockedBenefits"] = [];
  const rewards: RewardLine[] = [];
  const held = new Set(input.heldCardIds);

  const orderedBenefits = [...input.benefits].sort((a, b) => a.id.localeCompare(b.id));

  for (const benefit of orderedBenefits) {
    if (!held.has(benefit.userCardId)) continue;
    const gate = benefitAvailable(benefit, input.yearMonth);
    if (!gate.ok) {
      if (benefit.verification !== "unknown" || benefit.enrollmentRequired) {
        blockedBenefits.push({
          benefitId: benefit.id,
          benefitName: benefit.name,
          reason: gate.reason,
        });
      }
      continue;
    }
    const eligible = charges
      .filter((charge) => benefit.eligibleServiceIds.includes(charge.serviceId))
      .sort(
        (a, b) => (remaining.get(b.subscriptionId) ?? 0) - (remaining.get(a.subscriptionId) ?? 0),
      );
    if (eligible.length === 0) continue;

    if (benefit.kind === "included_membership") {
      const target = eligible.find((charge) => (remaining.get(charge.subscriptionId) ?? 0) > 0);
      if (!target) continue;
      const open = remaining.get(target.subscriptionId) ?? 0;
      const cap =
        benefit.amountCents == null
          ? open
          : Math.max(
              benefit.amountCents - priorUsed(benefit, input.yearMonth, input.priorCreditUses),
              0,
            );
      const applied = Math.min(open, cap);
      if (applied <= 0) continue;
      remaining.set(target.subscriptionId, open - applied);
      credits.push({
        benefitId: benefit.id,
        benefitName: benefit.name,
        kind: benefit.kind,
        subscriptionId: target.subscriptionId,
        serviceName: target.serviceName,
        amountCents: applied,
        reducesOop: true,
        verification: benefit.verification,
        note: "Included membership covers one eligible service, the largest remaining charge. It does not cover every matching service.",
      });
      continue;
    }

    if (benefit.kind === "statement_credit") {
      if (benefit.amountCents == null) {
        blockedBenefits.push({
          benefitId: benefit.id,
          benefitName: benefit.name,
          reason: "Statement-credit cap is unknown, so nothing was applied.",
        });
        continue;
      }
      let cap = benefit.amountCents - priorUsed(benefit, input.yearMonth, input.priorCreditUses);
      for (const charge of eligible) {
        if (cap <= 0) break;
        const open = remaining.get(charge.subscriptionId) ?? 0;
        const applied = Math.min(open, cap);
        if (applied <= 0) continue;
        cap -= applied;
        remaining.set(charge.subscriptionId, open - applied);
        credits.push({
          benefitId: benefit.id,
          benefitName: benefit.name,
          kind: benefit.kind,
          subscriptionId: charge.subscriptionId,
          serviceName: charge.serviceName,
          amountCents: applied,
          reducesOop: true,
          verification: benefit.verification,
          note: `Shared ${benefit.period} cap. Prior confirmed use in this period is already subtracted.`,
        });
      }
      continue;
    }

    if (benefit.kind === "cash_back" || benefit.kind === "points") {
      const usedAlready = priorUsed(benefit, input.yearMonth, input.priorCreditUses);
      let room =
        benefit.amountCents == null
          ? Number.POSITIVE_INFINITY
          : Math.max(benefit.amountCents - usedAlready, 0);
      for (const charge of eligible) {
        if (room <= 0) break;
        if (benefit.kind === "cash_back") {
          if (benefit.rateBps == null) {
            blockedBenefits.push({
              benefitId: benefit.id,
              benefitName: benefit.name,
              reason: "Cash-back rate is unknown.",
            });
            break;
          }
          const raw = Math.round((charge.amountCents * benefit.rateBps) / 10000);
          const applied = Math.min(raw, room);
          room -= applied;
          if (applied <= 0) continue;
          rewards.push({
            label: `${benefit.name} on ${charge.serviceName}`,
            cashBackCents: applied,
            points: 0,
            verification: benefit.verification,
            note: "Cash back is a reward. It is not subtracted from out-of-pocket.",
          });
        } else if (benefit.pointsPerDollarMilli != null) {
          const points = Math.round((charge.amountCents * benefit.pointsPerDollarMilli) / 100000);
          rewards.push({
            label: `${benefit.name} on ${charge.serviceName}`,
            cashBackCents: 0,
            points,
            verification: benefit.verification,
            note: "Points are a reward. They are not subtracted from out-of-pocket.",
          });
        } else {
          blockedBenefits.push({
            benefitId: benefit.id,
            benefitName: benefit.name,
            reason: "Points rate is unknown.",
          });
          break;
        }
      }
    }
  }

  const cardFees: FeeLine[] = [];
  for (const fee of input.cardFees) {
    if (!held.has(fee.userCardId)) continue;
    if (!fee.anniversary) {
      cardFees.push({
        userCardId: fee.userCardId,
        cardName: fee.cardName,
        amountCents: null,
        verification: "unknown",
        scheduled: false,
        note: "Anniversary is missing, so the annual fee is not placed in a month. Military fee relief is separate and unconfirmed unless you set it.",
      });
      continue;
    }
    const timing = isChargeMonth(fee.anniversary, "annual", input.yearMonth);
    if (!timing.charged) continue;
    if (fee.militaryRelief === "waived_user" && input.qualifiesMilitary) {
      cardFees.push({
        userCardId: fee.userCardId,
        cardName: fee.cardName,
        amountCents: 0,
        verification: "user_entered",
        scheduled: true,
        note: "You confirmed military fee relief on this card. That is account-specific and not an issuer-verified public offer.",
      });
      continue;
    }
    if (fee.feeCents == null || !usableVerification(fee.feeVerification)) {
      cardFees.push({
        userCardId: fee.userCardId,
        cardName: fee.cardName,
        amountCents: null,
        verification: "unknown",
        scheduled: true,
        note: "The annual fee is due this month, but the amount is unknown. It is not counted as $0.",
      });
      continue;
    }
    const relief =
      fee.militaryRelief === "unconfirmed"
        ? " Military fee relief is unconfirmed and was not applied."
        : "";
    cardFees.push({
      userCardId: fee.userCardId,
      cardName: fee.cardName,
      amountCents: fee.feeCents,
      verification: fee.feeVerification,
      scheduled: true,
      note: `Annual fee, separate from subscription charges.${relief}`,
    });
  }

  const grossChargeCents = charges.reduce((sum, charge) => sum + charge.amountCents, 0);
  const oopReductionCents = credits
    .filter((credit) => credit.reducesOop)
    .reduce((sum, credit) => sum + credit.amountCents, 0);
  const knownFees = cardFees.filter((fee) => fee.scheduled && fee.amountCents != null);
  const feeCents = knownFees.reduce((sum, fee) => sum + (fee.amountCents ?? 0), 0);
  const incomplete =
    unknownSubscriptions.some((item) => item.reason.includes("charge month")) ||
    cardFees.some((fee) => fee.scheduled && fee.amountCents == null);

  const overlaps = findOverlaps(active.map((sub) => sub.serviceId));
  const duplicateServiceIds = findDuplicates(active.map((sub) => sub.serviceId));
  const recommendations = buildRecommendations(input, plansById);

  return {
    yearMonth: input.yearMonth,
    charges,
    unknownSubscriptions,
    credits,
    blockedBenefits,
    rewards,
    cardFees,
    overlaps,
    duplicateServiceIds,
    grossChargeCents,
    discountCents,
    oopReductionCents,
    feeCents,
    expectedOopCents: grossChargeCents - oopReductionCents + feeCents,
    incomplete,
    upfrontChargeCents,
    monthlyEquivalentOfUpfrontCents,
    rewardCashBackCents: rewards.reduce((sum, reward) => sum + reward.cashBackCents, 0),
    rewardPoints: rewards.reduce((sum, reward) => sum + reward.points, 0),
    assumptions,
    recommendations,
  };
}

function buildRecommendations(
  input: EstimateInput,
  plansById: Map<string, PlanQuoteInput>,
): Recommendation[] {
  const recommendations: Recommendation[] = [];
  const active = input.subscriptions.filter((sub) => sub.status === "active");
  const byService = new Map<string, SubscriptionInput[]>();
  for (const sub of active) {
    const list = byService.get(sub.serviceId) ?? [];
    list.push(sub);
    byService.set(sub.serviceId, list);
  }

  for (const [serviceId, subs] of byService) {
    const quotes = input.plans.filter(
      (plan) => plan.serviceId === serviceId && usableVerification(plan.verification),
    );
    if (quotes.length === 0) continue;
    const ranked = quotes
      .map((plan) => {
        const price = selectPrice({
          listCents: plan.listCents,
          studentCents: plan.studentCents,
          militaryCents: plan.militaryCents,
          overrideCents: null,
          qualifiesStudent: input.qualifiesStudent,
          qualifiesMilitary: input.qualifiesMilitary,
          verification: plan.verification,
        });
        return {
          plan,
          price,
          equivalent: price.cents == null ? null : monthlyEquivalent(price.cents, plan.billing),
        };
      })
      .filter((row) => row.equivalent != null)
      .sort((a, b) => a.equivalent! - b.equivalent!);
    if (ranked.length === 0) continue;
    const best = ranked[0];
    const current = subs[0];
    const currentPlan = current.planQuoteId ? plansById.get(current.planQuoteId) : undefined;
    const currentPrice = selectPrice({
      listCents: currentPlan?.listCents ?? null,
      studentCents: currentPlan?.studentCents ?? null,
      militaryCents: currentPlan?.militaryCents ?? null,
      overrideCents: current.priceOverrideCents,
      qualifiesStudent: input.qualifiesStudent,
      qualifiesMilitary: input.qualifiesMilitary,
      verification: currentPlan?.verification ?? "unknown",
    });
    const currentEquivalent =
      currentPrice.cents == null ? null : monthlyEquivalent(currentPrice.cents, current.billing);
    if (current.planQuoteId === best.plan.id && current.priceOverrideCents == null) continue;
    if (currentEquivalent != null && currentEquivalent <= best.equivalent!) continue;
    const cardBenefit = input.benefits.find(
      (benefit) =>
        benefit.kind === "included_membership" &&
        input.heldCardIds.includes(benefit.userCardId) &&
        benefit.eligibleServiceIds.includes(serviceId) &&
        usableVerification(benefit.verification),
    );
    recommendations.push({
      serviceId,
      serviceName: input.serviceNames[serviceId] ?? subs[0].serviceName,
      currentLabel: currentPlan?.name ?? "Current selection",
      suggestion: `${best.plan.name} (${best.plan.billing}) has the lowest known monthly equivalent${
        cardBenefit
          ? `. ${cardBenefit.cardName} lists an included membership that may cover it if you are enrolled.`
          : "."
      }`,
      assumptions: [
        "Comparison uses monthly equivalents so an annual upfront price can be compared with a monthly plan. You still pay the annual plan upfront.",
        best.price.basis,
        best.plan.verification === "stale"
          ? "The suggested price is stale."
          : "Uses verified or entered quotes only.",
        cardBenefit?.enrollmentRequired
          ? "The included membership is not applied unless enrollment is marked."
          : "No extra discount was stacked onto the plan price.",
      ],
    });
  }
  return recommendations;
}

export function confirmedTotals(
  entries: { kind: string; amountCents: number; affectsOop: boolean; points: number | null }[],
): {
  oopCents: number;
  rewardCashBackCents: number;
  rewardPoints: number;
} {
  let oopCents = 0;
  let rewardCashBackCents = 0;
  let rewardPoints = 0;
  for (const entry of entries) {
    if (entry.kind === "cash_back") rewardCashBackCents += entry.amountCents;
    if (entry.kind === "points") rewardPoints += entry.points ?? 0;
    if (!entry.affectsOop) continue;
    if (entry.kind === "charge" || entry.kind === "card_fee") oopCents += entry.amountCents;
    if (
      entry.kind === "statement_credit" ||
      entry.kind === "included_membership" ||
      entry.kind === "adjustment"
    ) {
      oopCents -= entry.amountCents;
    }
  }
  return { oopCents, rewardCashBackCents, rewardPoints };
}

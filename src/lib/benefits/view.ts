import type { EstimateInput } from "./calc";
import type { Ledger } from "./api";

export function currentYearMonth(now = new Date()): string {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

export function ledgerToEstimate(ledger: Ledger, yearMonth: string): EstimateInput {
  const names = Object.fromEntries(ledger.services.map((service) => [service.id, service.name]));
  const heldByProduct = new Map(ledger.heldCards.map((card) => [card.cardId, card]));
  return {
    yearMonth,
    qualifiesStudent: ledger.qualifiesStudent,
    qualifiesMilitary: ledger.qualifiesMilitary,
    subscriptions: ledger.subscriptions.map((sub) => ({
      ...sub,
      serviceName: names[sub.serviceId] ?? sub.serviceId,
    })),
    plans: ledger.plans.map((plan) => ({
      id: plan.id,
      serviceId: plan.serviceId,
      name: plan.name,
      billing: plan.billing,
      listCents: plan.priceCents,
      studentCents: plan.studentPriceCents,
      militaryCents: plan.militaryPriceCents,
      verification: plan.verification,
    })),
    benefits: ledger.benefits.flatMap((benefit) => {
      const held = heldByProduct.get(benefit.cardId);
      if (!held) return [];
      return [
        {
          id: benefit.id,
          userCardId: held.id,
          cardName: ledger.cards.find((card) => card.id === benefit.cardId)?.name ?? benefit.cardId,
          name: benefit.name,
          kind: benefit.kind,
          amountCents: benefit.amountCents,
          rateBps: benefit.rateBps,
          pointsPerDollarMilli: benefit.pointsPerDollarMilli,
          period: benefit.period,
          eligibleServiceIds: benefit.eligibleServiceIds,
          enrollmentRequired: benefit.enrollmentRequired,
          enrolled: benefit.enrolled,
          expiresOn: benefit.expiresOn,
          verification: benefit.verification,
        },
      ];
    }),
    heldCardIds: ledger.heldCards.map((card) => card.id),
    cardFees: ledger.heldCards.map((card) => {
      const fee = ledger.fees.find((item) => item.cardId === card.cardId);
      return {
        userCardId: card.id,
        cardName: ledger.cards.find((item) => item.id === card.cardId)?.name ?? card.cardId,
        anniversary: card.anniversary,
        feeCents: fee?.annualFeeCents ?? null,
        feeVerification: fee?.verification ?? "unknown",
        militaryRelief: card.militaryRelief,
      };
    }),
    priorCreditUses: ledger.entries
      .filter(
        (entry) =>
          entry.yearMonth < yearMonth &&
          entry.benefitId &&
          (entry.kind === "statement_credit" || entry.kind === "included_membership"),
      )
      .map((entry) => ({
        benefitId: entry.benefitId as string,
        yearMonth: entry.yearMonth,
        amountCents: entry.amountCents,
      })),
    serviceNames: names,
  };
}

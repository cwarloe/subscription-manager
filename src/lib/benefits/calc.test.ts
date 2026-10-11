import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildMonthEstimate, confirmedTotals, selectPrice } from "./calc.ts";
import { dollarsToCents, formatCents, isChargeMonth, monthlyEquivalent, periodKey } from "./money.ts";
import type { BenefitInput, EstimateInput, PlanQuoteInput, SubscriptionInput } from "./calc.ts";

const base = (): EstimateInput => ({
  yearMonth: "2026-10",
  qualifiesStudent: true,
  qualifiesMilitary: true,
  subscriptions: [],
  plans: [],
  benefits: [],
  heldCardIds: [],
  cardFees: [],
  priorCreditUses: [],
  serviceNames: { netflix: "Netflix", hulu: "Hulu", spotify: "Spotify" },
});

function plan(partial: Partial<PlanQuoteInput> & Pick<PlanQuoteInput, "id" | "serviceId">): PlanQuoteInput {
  return {
    name: "Individual",
    billing: "monthly",
    listCents: 1599,
    studentCents: null,
    militaryCents: null,
    verification: "verified",
    ...partial,
  };
}

function sub(partial: Partial<SubscriptionInput> & Pick<SubscriptionInput, "id" | "serviceId">): SubscriptionInput {
  return {
    serviceName: partial.serviceId,
    planQuoteId: null,
    userCardId: null,
    billing: "monthly",
    renewalDate: null,
    priceOverrideCents: null,
    status: "active",
    ...partial,
  };
}

describe("money", () => {
  it("parses dollars to integer cents and rejects junk", () => {
    assert.equal(dollarsToCents("15.99"), 1599);
    assert.equal(dollarsToCents("10"), 1000);
    assert.equal(dollarsToCents(""), null);
    assert.throws(() => dollarsToCents("15.999"));
    assert.throws(() => dollarsToCents("15.9.9"));
  });

  it("does not format a missing price as zero", () => {
    assert.equal(formatCents(null), "Unknown");
    assert.equal(formatCents(0), "$0.00");
    assert.equal(formatCents(2500), "$25.00");
  });

  it("places annual charges only on the anchor month", () => {
    assert.equal(isChargeMonth("2026-11-02", "annual", "2026-10").charged, false);
    assert.equal(isChargeMonth("2026-11-02", "annual", "2026-11").charged, true);
    assert.equal(isChargeMonth("2026-11-02", "annual", "2027-11").charged, true);
    assert.equal(isChargeMonth(null, "annual", "2026-11").charged, false);
    assert.equal(monthlyEquivalent(13900, "annual"), 1158);
  });

  it("builds quarterly, semiannual, and annual period keys", () => {
    assert.equal(periodKey("quarterly", "2026-10"), "2026-Q4");
    assert.equal(periodKey("semiannual", "2026-04"), "2026-H1");
    assert.equal(periodKey("annual", "2026-10"), "2026");
    assert.equal(isChargeMonth("2026-01-15", "quarterly", "2026-04").charged, true);
    assert.equal(isChargeMonth("2026-01-15", "quarterly", "2026-03").charged, false);
    assert.equal(isChargeMonth("2026-01-15", "semiannual", "2026-07").charged, true);
  });
});

describe("selectPrice", () => {
  it("does not stack student and military prices", () => {
    const chosen = selectPrice({
      listCents: 2000,
      studentCents: 1000,
      militaryCents: 800,
      overrideCents: null,
      qualifiesStudent: true,
      qualifiesMilitary: true,
      verification: "verified",
    });
    assert.equal(chosen.cents, 800);
    assert.match(chosen.basis, /not stacked/i);
  });

  it("keeps unknown prices unknown", () => {
    const chosen = selectPrice({
      listCents: 2000,
      studentCents: null,
      militaryCents: null,
      overrideCents: null,
      qualifiesStudent: true,
      qualifiesMilitary: true,
      verification: "unknown",
    });
    assert.equal(chosen.cents, null);
  });

  it("lets an override replace a verified price", () => {
    const chosen = selectPrice({
      listCents: 2000,
      studentCents: 500,
      militaryCents: null,
      overrideCents: 1700,
      qualifiesStudent: true,
      qualifiesMilitary: false,
      verification: "verified",
    });
    assert.equal(chosen.cents, 1700);
    assert.equal(chosen.verification, "user_entered");
  });
});

describe("buildMonthEstimate", () => {
  it("counts an annual plan as an upfront charge and keeps the equivalent separate", () => {
    const estimate = buildMonthEstimate({
      ...base(),
      yearMonth: "2026-11",
      subscriptions: [
        sub({
          id: "s1",
          serviceId: "netflix",
          serviceName: "Netflix",
          planQuoteId: "p1",
          billing: "annual",
          renewalDate: "2026-11-04",
        }),
      ],
      plans: [plan({ id: "p1", serviceId: "netflix", billing: "annual", listCents: 13900 })],
    });
    assert.equal(estimate.charges[0].amountCents, 13900);
    assert.equal(estimate.upfrontChargeCents, 13900);
    assert.equal(estimate.monthlyEquivalentOfUpfrontCents, 1158);
    assert.equal(estimate.expectedOopCents, 13900);
    assert.equal(estimate.incomplete, false);
  });

  it("does not treat an unknown charge-month price as zero", () => {
    const estimate = buildMonthEstimate({
      ...base(),
      subscriptions: [sub({ id: "s1", serviceId: "netflix", serviceName: "Netflix" })],
    });
    assert.equal(estimate.charges.length, 0);
    assert.equal(estimate.expectedOopCents, 0);
    assert.equal(estimate.incomplete, true);
    assert.match(estimate.unknownSubscriptions[0].reason, /not counted as \$0/);
  });

  it("applies one shared annual credit across services and respects earlier use", () => {
    const benefit: BenefitInput = {
      id: "b1",
      userCardId: "c1",
      cardName: "Platinum",
      name: "Digital credit",
      kind: "statement_credit",
      amountCents: 2500,
      rateBps: null,
      pointsPerDollarMilli: null,
      period: "monthly",
      eligibleServiceIds: ["netflix", "hulu"],
      enrollmentRequired: false,
      enrolled: false,
      expiresOn: null,
      verification: "verified",
    };
    const estimate = buildMonthEstimate({
      ...base(),
      heldCardIds: ["c1"],
      benefits: [benefit],
      subscriptions: [
        sub({ id: "n", serviceId: "netflix", serviceName: "Netflix", planQuoteId: "pn", userCardId: "c1" }),
        sub({ id: "h", serviceId: "hulu", serviceName: "Hulu", planQuoteId: "ph", userCardId: "c1" }),
      ],
      plans: [
        plan({ id: "pn", serviceId: "netflix", listCents: 1599 }),
        plan({ id: "ph", serviceId: "hulu", listCents: 999 }),
      ],
      priorCreditUses: [{ benefitId: "b1", yearMonth: "2026-10", amountCents: 2000 }],
    });
    const applied = estimate.credits.reduce((sum, credit) => sum + credit.amountCents, 0);
    assert.equal(applied, 500);
    assert.equal(estimate.oopReductionCents, 500);
    assert.equal(estimate.expectedOopCents, 1599 + 999 - 500);
  });

  it("blocks an enrollment-required credit until enrolled", () => {
    const estimate = buildMonthEstimate({
      ...base(),
      heldCardIds: ["c1"],
      benefits: [
        {
          id: "b1",
          userCardId: "c1",
          cardName: "Platinum",
          name: "Streaming credit",
          kind: "statement_credit",
          amountCents: 2500,
          rateBps: null,
          pointsPerDollarMilli: null,
          period: "monthly",
          eligibleServiceIds: ["netflix"],
          enrollmentRequired: true,
          enrolled: false,
          expiresOn: null,
          verification: "verified",
        },
      ],
      subscriptions: [sub({ id: "n", serviceId: "netflix", serviceName: "Netflix", planQuoteId: "pn" })],
      plans: [plan({ id: "pn", serviceId: "netflix", listCents: 1599 })],
    });
    assert.equal(estimate.oopReductionCents, 0);
    assert.match(estimate.blockedBenefits[0].reason, /Enrollment/);
  });

  it("covers only one service with an included membership", () => {
    const estimate = buildMonthEstimate({
      ...base(),
      heldCardIds: ["c1"],
      benefits: [
        {
          id: "b1",
          userCardId: "c1",
          cardName: "Reserve",
          name: "Included streaming",
          kind: "included_membership",
          amountCents: null,
          rateBps: null,
          pointsPerDollarMilli: null,
          period: "annual",
          eligibleServiceIds: ["netflix", "hulu"],
          enrollmentRequired: false,
          enrolled: true,
          expiresOn: null,
          verification: "verified",
        },
      ],
      subscriptions: [
        sub({ id: "n", serviceId: "netflix", serviceName: "Netflix", planQuoteId: "pn" }),
        sub({ id: "h", serviceId: "hulu", serviceName: "Hulu", planQuoteId: "ph" }),
      ],
      plans: [
        plan({ id: "pn", serviceId: "netflix", listCents: 1599 }),
        plan({ id: "ph", serviceId: "hulu", listCents: 999 }),
      ],
    });
    assert.equal(estimate.credits.length, 1);
    assert.equal(estimate.credits[0].serviceName, "Netflix");
    assert.equal(estimate.expectedOopCents, 999);
  });

  it("keeps cash back and points out of out-of-pocket", () => {
    const estimate = buildMonthEstimate({
      ...base(),
      heldCardIds: ["c1"],
      benefits: [
        {
          id: "cash",
          userCardId: "c1",
          cardName: "Blue Cash",
          name: "Streaming cash back",
          kind: "cash_back",
          amountCents: null,
          rateBps: 600,
          pointsPerDollarMilli: null,
          period: "monthly",
          eligibleServiceIds: ["netflix"],
          enrollmentRequired: false,
          enrolled: false,
          expiresOn: null,
          verification: "stale",
        },
        {
          id: "pts",
          userCardId: "c1",
          cardName: "Blue Cash",
          name: "Streaming points",
          kind: "points",
          amountCents: null,
          rateBps: null,
          pointsPerDollarMilli: 3000,
          period: "monthly",
          eligibleServiceIds: ["netflix"],
          enrollmentRequired: false,
          enrolled: false,
          expiresOn: null,
          verification: "verified",
        },
      ],
      subscriptions: [sub({ id: "n", serviceId: "netflix", serviceName: "Netflix", planQuoteId: "pn" })],
      plans: [plan({ id: "pn", serviceId: "netflix", listCents: 1000 })],
    });
    assert.equal(estimate.expectedOopCents, 1000);
    assert.equal(estimate.rewardCashBackCents, 60);
    assert.equal(estimate.rewardPoints, 30);
    assert.equal(estimate.rewards[0].verification, "stale");
  });

  it("expires a benefit and separates a card fee from military relief", () => {
    const estimate = buildMonthEstimate({
      ...base(),
      heldCardIds: ["c1", "c2"],
      benefits: [
        {
          id: "old",
          userCardId: "c1",
          cardName: "Platinum",
          name: "Old credit",
          kind: "statement_credit",
          amountCents: 1000,
          rateBps: null,
          pointsPerDollarMilli: null,
          period: "monthly",
          eligibleServiceIds: ["spotify"],
          enrollmentRequired: false,
          enrolled: false,
          expiresOn: "2026-09-30",
          verification: "verified",
        },
      ],
      subscriptions: [sub({ id: "s", serviceId: "spotify", serviceName: "Spotify", planQuoteId: "ps" })],
      plans: [plan({ id: "ps", serviceId: "spotify", listCents: 1199 })],
      cardFees: [
        {
          userCardId: "c1",
          cardName: "The Platinum Card",
          anniversary: "2026-10-01",
          feeCents: 89500,
          feeVerification: "verified",
          militaryRelief: "unconfirmed",
        },
        {
          userCardId: "c2",
          cardName: "Gold",
          anniversary: "2026-10-20",
          feeCents: 32500,
          feeVerification: "verified",
          militaryRelief: "waived_user",
        },
      ],
    });
    assert.equal(estimate.oopReductionCents, 0);
    assert.equal(estimate.cardFees[0].amountCents, 89500);
    assert.match(estimate.cardFees[0].note, /unconfirmed/);
    assert.equal(estimate.cardFees[1].amountCents, 0);
    assert.equal(estimate.expectedOopCents, 1199 + 89500);
  });

  it("flags duplicate services and bundle overlap without inventing a discount", () => {
    const estimate = buildMonthEstimate({
      ...base(),
      subscriptions: [
        sub({ id: "a", serviceId: "youtube-premium", serviceName: "YouTube Premium", priceOverrideCents: 1399 }),
        sub({ id: "b", serviceId: "youtube-music", serviceName: "YouTube Music", priceOverrideCents: 1099 }),
        sub({ id: "c", serviceId: "netflix", serviceName: "Netflix", priceOverrideCents: 100 }),
        sub({ id: "d", serviceId: "netflix", serviceName: "Netflix", priceOverrideCents: 100 }),
      ],
    });
    assert.equal(estimate.overlaps.length, 1);
    assert.deepEqual(estimate.duplicateServiceIds, ["netflix"]);
    assert.equal(estimate.discountCents, 0);
  });

  it("recommends a lower known plan and states the equivalent-price assumption", () => {
    const estimate = buildMonthEstimate({
      ...base(),
      subscriptions: [
        sub({
          id: "n",
          serviceId: "netflix",
          serviceName: "Netflix",
          planQuoteId: "monthly",
          billing: "monthly",
        }),
      ],
      plans: [
        plan({ id: "monthly", serviceId: "netflix", name: "Monthly", billing: "monthly", listCents: 2499 }),
        plan({ id: "annual", serviceId: "netflix", name: "Annual", billing: "annual", listCents: 13900 }),
      ],
    });
    assert.equal(estimate.recommendations.length, 1);
    assert.match(estimate.recommendations[0].suggestion, /Annual/);
    assert.match(estimate.recommendations[0].assumptions[0], /upfront/);
  });
});

describe("confirmedTotals", () => {
  it("keeps rewards out of confirmed out-of-pocket", () => {
    const totals = confirmedTotals([
      { kind: "charge", amountCents: 1599, affectsOop: true, points: null },
      { kind: "statement_credit", amountCents: 2500, affectsOop: true, points: null },
      { kind: "cash_back", amountCents: 96, affectsOop: false, points: null },
      { kind: "points", amountCents: 0, affectsOop: false, points: 48 },
      { kind: "card_fee", amountCents: 69500, affectsOop: true, points: null },
    ]);
    assert.equal(totals.oopCents, 1599 - 2500 + 69500);
    assert.equal(totals.rewardCashBackCents, 96);
    assert.equal(totals.rewardPoints, 48);
  });
});

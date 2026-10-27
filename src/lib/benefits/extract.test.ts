import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  excerptSupportsAmount,
  htmlToText,
  priceNearName,
  pricingText,
  sameRegistrableHost,
  validateExtraction,
} from "./extract.ts";

describe("extraction", () => {
  it("accepts a price only when the excerpt is on the page", () => {
    const page = htmlToText("<p>Premium is $15.99 a month in the United States.</p>");
    assert.equal(excerptSupportsAmount(page, "Premium is $15.99 a month", 1599), true);
    assert.equal(excerptSupportsAmount(page, "Premium is $15.99 a month", 1099), false);
    const raw = JSON.stringify({
      plans: [
        {
          name: "Premium",
          billing_period: "monthly",
          price_cents: 1599,
          student_price_cents: 599,
          excerpt: "Premium is $15.99 a month",
        },
        {
          name: "Invented",
          billing_period: "monthly",
          price_cents: 100,
          excerpt: "only $1.00 today",
        },
      ],
      annual_fee_cents: 89500,
      annual_fee_excerpt: "annual fee is $895",
      benefits: [],
    });
    const parsed = validateExtraction(raw, page);
    assert.equal(parsed.plans.length, 1);
    assert.equal(parsed.plans[0].priceCents, 1599);
    assert.equal(parsed.plans[0].studentPriceCents, null);
    assert.equal(parsed.annualFeeCents, null);
  });

  it("decodes prices and keeps a plan only next to its own amount", () => {
    const page = htmlToText("<p>Pro is &#36;20 a month. Ultra is $200 a month.</p>");
    assert.match(page, /\$20/);
    assert.equal(priceNearName(page, "Pro", 2000), true);
    assert.equal(priceNearName(page, "Pro", 20000), false);
    assert.equal(priceNearName(page, "Ultra", 20000), true);
    const table = "standard with ads : $8.99 / month standard : $19.99 / month";
    assert.equal(priceNearName(table, "Standard", 899), false);
    assert.equal(priceNearName(table, "Standard", 1999), true);
    assert.equal(priceNearName(table, "Standard with ads", 899), true);
    assert.equal(
      priceNearName("plus do more with advanced intelligence $20 / month", "Plus", 2000),
      true,
    );
    const crowded = pricingText(
      `<style>${".x".repeat(5000)}{color:red}</style><p>Standard with ads is $7.99 a month.</p>`,
    );
    assert.match(crowded, /\$7\.99/);
    const raw = JSON.stringify({
      plans: [
        {
          name: "Ultra",
          billing_period: "monthly",
          price_cents: 2000,
          excerpt: "Pro is $20 a month",
        },
      ],
    });
    assert.equal(validateExtraction(raw, page).plans.length, 0);
  });

  it("keeps redirects on the same site", () => {
    assert.equal(
      sameRegistrableHost(
        "https://www.americanexpress.com/us/credit-cards/card/platinum/",
        "https://global.americanexpress.com/card-benefits/view-all/platinum",
      ),
      true,
    );
    assert.equal(
      sameRegistrableHost("https://www.spotify.com/us/premium/", "https://evil.example/phish"),
      false,
    );
  });
});

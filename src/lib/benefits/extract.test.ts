import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { excerptSupportsAmount, htmlToText, sameRegistrableHost, validateExtraction } from "./extract.ts";

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

import { CARDS, SERVICES } from "./catalog";
import { getSql, type Sql } from "@/lib/db";
import {
  htmlToText,
  sameRegistrableHost,
  validateExtraction,
  type ExtractedBenefit,
  type ExtractedPlan,
} from "./extract";

const SYSTEM = `You extract subscription or card facts from official page text into one JSON object.
Never invent a price, fee, rate, expiration, or eligibility rule.
If the text does not explicitly state a number, use null.
price_cents, student_price_cents, military_price_cents, amount_cents, and annual_fee_cents are integer US cents.
Every non-null cents field needs an excerpt that is a verbatim substring of the page and contains that dollar amount.
rate_bps is the cash-back percent times 100, so 3% is 300. Use null if the page does not state a percent.
points_per_dollar_milli is points per dollar times 1000, so 3x is 3000. Use null if unstated.
billing_period and period must be monthly, quarterly, semiannual, or annual.
kind must be statement_credit, included_membership, cash_back, points, or other.
Do not treat student or military offers as free unless the page says the price is zero.
Do not assume discounts stack. Put stacking limits in stacking_notes.
enrollment_required is true only if the page says the benefit must be enrolled or activated.
eligible_service_ids may only contain ids from the list you are given, and only when the page names that brand.
Ignore welcome bonuses and limited-time account offers that are not the standing price or benefit.`;

async function fetchOfficial(officialUrl: string): Promise<{ finalUrl: string; text: string }> {
  const response = await fetch(officialUrl, {
    redirect: "follow",
    signal: AbortSignal.timeout(12_000),
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "User-Agent": "SubscriptionBenefits/1.0 (personal official-page checker)",
    },
  });
  if (!response.ok) throw new Error(`Official page returned HTTP ${response.status}.`);
  if (!sameRegistrableHost(officialUrl, response.url)) {
    throw new Error("The official page redirected to a different site. Nothing was saved.");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("The official page was empty.");
  const decoder = new TextDecoder();
  let raw = "";
  let total = 0;
  while (total < 350_000) {
    const step = await reader.read();
    if (step.done) break;
    total += step.value.byteLength;
    raw += decoder.decode(step.value, { stream: true });
  }
  await reader.cancel().catch(() => undefined);
  const text = htmlToText(raw).slice(0, 12_000);
  if (text.length < 40) throw new Error("The official page had no readable pricing text.");
  return { finalUrl: response.url, text };
}

async function extractWithModel(label: string, kind: "service" | "card", pageText: string): Promise<string> {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Live extraction is off because the server has no XAI_API_KEY. Nothing was invented. Enter the price you pay, or set the key and refresh again.",
    );
  }
  const catalog = SERVICES.map((service) => `${service.id}: ${service.name}`).join("\n");
  const ask =
    kind === "service"
      ? `Extract current consumer USD plans for ${label}. Leave benefits empty and annual_fee_cents null.`
      : `Extract the standing annual fee and ongoing benefits for ${label}. Leave plans empty. Do not copy welcome-offer amounts into annual benefits.`;
  const response = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    signal: AbortSignal.timeout(45_000),
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "grok-4.5",
      temperature: 0,
      max_tokens: 1800,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM },
        {
          role: "user",
          content: `${ask}\nService ids:\n${catalog}\n\nReturn JSON with keys plans, annual_fee_cents, annual_fee_excerpt, benefits.\n\nPAGE TEXT:\n${pageText}`,
        },
      ],
    }),
  });
  if (!response.ok) {
    throw new Error(`Price extraction failed (HTTP ${response.status}). Previous data was kept and marked stale if it had been verified.`);
  }
  const body = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = body.choices?.[0]?.message?.content;
  if (!content) throw new Error("Price extraction returned an empty response. Previous data was kept.");
  return content;
}

async function markResearchStale(
  sql: Sql,
  userId: string,
  kind: "service" | "card",
  targetId: string,
  message: string,
) {
  if (kind === "service") {
    await sql`
      update plan_quotes
      set verification = case when last_success_at is null then 'unknown' else 'stale' end,
          checked_at = now(),
          failure_note = ${message}
      where user_id = ${userId} and service_id = ${targetId} and origin = 'research'
    `;
    return;
  }
  await sql`
    update benefit_quotes
    set verification = case when last_success_at is null then 'unknown' else 'stale' end,
        checked_at = now(),
        failure_note = ${message}
    where user_id = ${userId} and card_id = ${targetId} and origin = 'research'
  `;
  await sql`
    update fee_quotes
    set verification = case when last_success_at is null then 'unknown' else 'stale' end,
        checked_at = now(),
        failure_note = ${message}
    where user_id = ${userId} and card_id = ${targetId} and origin = 'research'
  `;
}

async function savePlans(
  sql: Sql,
  userId: string,
  serviceId: string,
  sourceUrl: string,
  plans: ExtractedPlan[],
): Promise<number> {
  const seen: string[] = [];
  for (const plan of plans) {
    const existing = await sql<{ id: string }>`
      select id from plan_quotes
      where user_id = ${userId} and service_id = ${serviceId} and origin = 'research'
        and lower(name) = lower(${plan.name}) and billing_period = ${plan.billing}
    `;
    const id = existing[0]?.id ?? crypto.randomUUID();
    if (existing[0]) {
      await sql`
        update plan_quotes set
          price_cents = ${plan.priceCents},
          student_price_cents = ${plan.studentPriceCents},
          military_price_cents = ${plan.militaryPriceCents},
          eligibility = ${plan.eligibility},
          terms = ${plan.terms},
          support_excerpt = ${plan.excerpt},
          verification = 'verified',
          source_url = ${sourceUrl},
          checked_at = now(),
          last_success_at = now(),
          failure_note = ''
        where id = ${id} and user_id = ${userId}
      `;
    } else {
      await sql`
        insert into plan_quotes (
          id, user_id, service_id, name, billing_period, price_cents, student_price_cents,
          military_price_cents, eligibility, terms, support_excerpt, origin, verification,
          source_url, checked_at, last_success_at, failure_note
        ) values (
          ${id}, ${userId}, ${serviceId}, ${plan.name}, ${plan.billing}, ${plan.priceCents},
          ${plan.studentPriceCents}, ${plan.militaryPriceCents}, ${plan.eligibility}, ${plan.terms},
          ${plan.excerpt}, 'research', 'verified', ${sourceUrl}, now(), now(), ''
        )
      `;
    }
    seen.push(id);
  }
  if (seen.length > 0) {
    await sql.query(
      `update plan_quotes
       set verification = case when last_success_at is null then 'unknown' else 'stale' end,
           checked_at = now(),
           failure_note = 'Not found on the latest official page.'
       where user_id = $1 and service_id = $2 and origin = 'research'
         and id not in (${seen.map((_, index) => `$${index + 3}`).join(", ")})`,
      [userId, serviceId, ...seen],
    );
  }
  return seen.length;
}

async function saveCard(
  sql: Sql,
  userId: string,
  cardId: string,
  sourceUrl: string,
  annualFeeCents: number | null,
  annualFeeExcerpt: string,
  benefits: ExtractedBenefit[],
): Promise<string> {
  if (annualFeeCents != null) {
    const existing = await sql<{ id: string; origin: string }>`
      select id, origin from fee_quotes where user_id = ${userId} and card_id = ${cardId}
    `;
    if (!existing[0]) {
      await sql`
        insert into fee_quotes (
          id, user_id, card_id, annual_fee_cents, support_excerpt, origin, verification,
          source_url, checked_at, last_success_at, failure_note
        ) values (
          ${crypto.randomUUID()}, ${userId}, ${cardId}, ${annualFeeCents}, ${annualFeeExcerpt},
          'research', 'verified', ${sourceUrl}, now(), now(), ''
        )
      `;
    } else if (existing[0].origin === "research") {
      await sql`
        update fee_quotes set
          annual_fee_cents = ${annualFeeCents},
          support_excerpt = ${annualFeeExcerpt},
          verification = 'verified',
          source_url = ${sourceUrl},
          checked_at = now(),
          last_success_at = now(),
          failure_note = ''
        where id = ${existing[0].id} and user_id = ${userId}
      `;
    }
  }
  const seen: string[] = [];
  for (const benefit of benefits) {
    const existing = await sql<{ id: string }>`
      select id from benefit_quotes
      where user_id = ${userId} and card_id = ${cardId} and origin = 'research' and lower(name) = lower(${benefit.name})
    `;
    const id = existing[0]?.id ?? crypto.randomUUID();
    const eligible = benefit.eligibleServiceIds.join(",");
    if (existing[0]) {
      await sql`
        update benefit_quotes set
          kind = ${benefit.kind},
          amount_cents = ${benefit.amountCents},
          rate_bps = ${benefit.rateBps},
          points_per_dollar_milli = ${benefit.pointsPerDollarMilli},
          period = ${benefit.period},
          eligible_service_ids = ${eligible},
          enrollment_required = ${benefit.enrollmentRequired},
          enrollment_notes = ${benefit.enrollmentNotes},
          expires_on = ${benefit.expiresOn},
          stacking_notes = ${benefit.stackingNotes},
          support_excerpt = ${benefit.excerpt},
          verification = 'verified',
          source_url = ${sourceUrl},
          checked_at = now(),
          last_success_at = now(),
          failure_note = ''
        where id = ${id} and user_id = ${userId}
      `;
    } else {
      await sql`
        insert into benefit_quotes (
          id, user_id, card_id, name, kind, amount_cents, rate_bps, points_per_dollar_milli,
          period, eligible_service_ids, enrollment_required, enrollment_notes, expires_on,
          stacking_notes, support_excerpt, origin, verification, source_url, checked_at,
          last_success_at, failure_note
        ) values (
          ${id}, ${userId}, ${cardId}, ${benefit.name}, ${benefit.kind}, ${benefit.amountCents},
          ${benefit.rateBps}, ${benefit.pointsPerDollarMilli}, ${benefit.period}, ${eligible},
          ${benefit.enrollmentRequired}, ${benefit.enrollmentNotes}, ${benefit.expiresOn},
          ${benefit.stackingNotes}, ${benefit.excerpt}, 'research', 'verified', ${sourceUrl},
          now(), now(), ''
        )
      `;
    }
    seen.push(id);
  }
  if (seen.length > 0) {
    await sql.query(
      `update benefit_quotes
       set verification = case when last_success_at is null then 'unknown' else 'stale' end,
           checked_at = now(),
           failure_note = 'Not found on the latest official page.'
       where user_id = $1 and card_id = $2 and origin = 'research'
         and id not in (${seen.map((_, index) => `$${index + 3}`).join(", ")})`,
      [userId, cardId, ...seen],
    );
  }
  const parts = [
    annualFeeCents != null ? "annual fee" : null,
    benefits.length ? `${benefits.length} benefit${benefits.length === 1 ? "" : "s"}` : null,
  ].filter(Boolean);
  return parts.join(" and ");
}

async function refreshTarget(
  sql: Sql,
  userId: string,
  kind: "service" | "card",
  targetId: string,
): Promise<{ message: string; sourceUrl: string }> {
  const service = SERVICES.find((item) => item.id === targetId);
  const card = CARDS.find((item) => item.id === targetId);
  const officialUrl = kind === "service" ? service?.officialUrl : card?.officialUrl;
  const label = kind === "service" ? service?.name : card?.name;
  if (!officialUrl || !label) throw new Error("That catalog item does not exist.");
  const page = await fetchOfficial(officialUrl);
  const raw = await extractWithModel(label, kind, page.text);
  const extracted = validateExtraction(raw, page.text);
  if (kind === "service") {
    if (extracted.plans.length === 0) {
      throw new Error("No plan price on the official page could be matched to a quote from that page.");
    }
    const count = await savePlans(sql, userId, targetId, page.finalUrl, extracted.plans);
    return { message: `Saved ${count} verified plan${count === 1 ? "" : "s"}.`, sourceUrl: page.finalUrl };
  }
  if (extracted.annualFeeCents == null && extracted.benefits.length === 0) {
    throw new Error("No annual fee or benefit on the official page could be matched to a quote from that page.");
  }
  const message = await saveCard(
    sql,
    userId,
    targetId,
    page.finalUrl,
    extracted.annualFeeCents,
    extracted.annualFeeExcerpt,
    extracted.benefits,
  );
  return { message: `Saved ${message}.`, sourceUrl: page.finalUrl };
}

export type RefreshView = {
  id: string;
  status: string;
  message: string;
  items: {
    id: string;
    targetType: string;
    targetId: string;
    label: string;
    status: string;
    message: string;
    sourceUrl: string | null;
  }[];
};

async function loadRun(sql: Sql, userId: string, runId: string): Promise<RefreshView> {
  const runs = await sql<{ id: string; status: string; message: string }>`
    select id, status, message from refresh_runs where id = ${runId} and user_id = ${userId}
  `;
  const run = runs[0];
  if (!run) throw new Error("Refresh not found.");
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
    from refresh_items
    where run_id = ${runId} and user_id = ${userId}
    order by position
  `;
  return {
    id: run.id,
    status: run.status,
    message: run.message,
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

export async function startRefresh(
  userId: string,
  scope: "all" | "service" | "card",
  targetId: string | null,
): Promise<RefreshView> {
  const sql = await getSql();
  const recent = await sql<{ id: string; status: string; age_seconds: number }>`
    select id, status, extract(epoch from (now() - started_at))::int as age_seconds
    from refresh_runs
    where user_id = ${userId}
    order by started_at desc
    limit 1
  `;
  const last = recent[0];
  if (last?.status === "running" && last.age_seconds < 15 * 60) {
    return loadRun(sql, userId, last.id);
  }
  if (last && last.age_seconds < 20) {
    throw new Error("Wait a few seconds before starting another refresh.");
  }

  const held = await sql<{ card_id: string }>`
    select card_id from user_cards where user_id = ${userId}
  `;
  const subs = await sql<{ service_id: string }>`
    select service_id from subscriptions where user_id = ${userId} and status = 'active'
  `;
  const heldIds = new Set(held.map((row) => row.card_id));
  const subIds = new Set(subs.map((row) => row.service_id));

  let targets: { type: "service" | "card"; id: string; label: string }[] = [];
  if (scope === "service") {
    const service = SERVICES.find((item) => item.id === targetId);
    if (!service) throw new Error("Unknown service.");
    targets = [{ type: "service", id: service.id, label: service.name }];
  } else if (scope === "card") {
    const card = CARDS.find((item) => item.id === targetId);
    if (!card) throw new Error("Unknown card.");
    targets = [{ type: "card", id: card.id, label: card.name }];
  } else {
    const cards = [
      ...CARDS.filter((card) => heldIds.has(card.id)),
      ...CARDS.filter((card) => !heldIds.has(card.id)),
    ];
    const services = [
      ...SERVICES.filter((service) => subIds.has(service.id)),
      ...SERVICES.filter((service) => !subIds.has(service.id)),
    ];
    targets = [
      ...services.map((service) => ({ type: "service" as const, id: service.id, label: service.name })),
      ...cards.map((card) => ({ type: "card" as const, id: card.id, label: card.name })),
    ].slice(0, 8);
  }

  const runId = crypto.randomUUID();
  const message =
    scope === "all"
      ? "Checking up to 8 official pages. Run refresh again for the rest. Each page can use one model call."
      : "Checking one official page.";
  await sql`
    insert into refresh_runs (id, user_id, status, message)
    values (${runId}, ${userId}, 'running', ${message})
  `;
  for (let index = 0; index < targets.length; index += 1) {
    const target = targets[index];
    await sql`
      insert into refresh_items (
        id, run_id, user_id, target_type, target_id, label, status, position
      ) values (
        ${crypto.randomUUID()}, ${runId}, ${userId}, ${target.type}, ${target.id}, ${target.label}, 'pending', ${index}
      )
    `;
  }
  return loadRun(sql, userId, runId);
}

export async function advanceRefresh(userId: string, runId: string): Promise<RefreshView> {
  const sql = await getSql();
  const runs = await sql<{ status: string }>`
    select status from refresh_runs where id = ${runId} and user_id = ${userId}
  `;
  if (!runs[0]) throw new Error("Refresh not found.");
  if (runs[0].status !== "running") return loadRun(sql, userId, runId);

  const pending = await sql<{ id: string; target_type: string; target_id: string }>`
    select id, target_type, target_id
    from refresh_items
    where run_id = ${runId} and user_id = ${userId} and status = 'pending'
    order by position
    limit 1
  `;
  const item = pending[0];
  if (!item) {
    await sql`
      update refresh_runs set status = 'done', finished_at = now()
      where id = ${runId} and user_id = ${userId}
    `;
    return loadRun(sql, userId, runId);
  }

  await sql`update refresh_items set status = 'running' where id = ${item.id} and user_id = ${userId}`;
  const kind = item.target_type === "card" ? "card" : "service";
  try {
    const result = await refreshTarget(sql, userId, kind, item.target_id);
    await sql`
      update refresh_items
      set status = 'ok', message = ${result.message}, source_url = ${result.sourceUrl}
      where id = ${item.id} and user_id = ${userId}
    `;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Refresh failed.";
    await sql`
      update refresh_items set status = 'failed', message = ${message.slice(0, 500)}
      where id = ${item.id} and user_id = ${userId}
    `;
    await markResearchStale(sql, userId, kind, item.target_id, message.slice(0, 500));
  }

  const left = await sql<{ n: number }>`
    select count(*)::int as n from refresh_items
    where run_id = ${runId} and user_id = ${userId} and status in ('pending', 'running')
  `;
  if ((left[0]?.n ?? 0) === 0) {
    const failed = await sql<{ n: number }>`
      select count(*)::int as n from refresh_items
      where run_id = ${runId} and user_id = ${userId} and status = 'failed'
    `;
    const ok = await sql<{ n: number }>`
      select count(*)::int as n from refresh_items
      where run_id = ${runId} and user_id = ${userId} and status = 'ok'
    `;
    const summary = `${ok[0]?.n ?? 0} saved, ${failed[0]?.n ?? 0} failed. Failed sources kept their last saved prices and were marked stale when those prices existed.`;
    await sql`
      update refresh_runs
      set status = 'done', finished_at = now(), message = ${summary}
      where id = ${runId} and user_id = ${userId}
    `;
  }
  return loadRun(sql, userId, runId);
}

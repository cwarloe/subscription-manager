import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Field, Money, StatusPill, controlClass, useLedger } from "@/components/benefits/chrome";
import { deleteSubscription, saveSubscription } from "@/lib/benefits/api";
import { BILLING_PERIODS, dollarsToCents, formatCents } from "@/lib/benefits/money";
import { selectPrice } from "@/lib/benefits/calc";

export const Route = createFileRoute("/_app/subscriptions")({ component: SubscriptionsPage });

function SubscriptionsPage() {
  const { ledger, run } = useLedger();
  const [editing, setEditing] = useState<string | "new" | null>("new");
  if (!ledger) return null;

  return (
    <div className="grid gap-4">
      <div>
        <h2 className="text-3xl">My subscriptions</h2>
        <p className="max-w-2xl text-sm text-pretty text-muted">
          Pick the service and how often you are billed. A plan name is only listed when that quote
          has a price. Otherwise enter what you pay. Leave the renewal date blank to use the 1st of
          next month.
        </p>
      </div>
      <ul className="grid gap-3">
        {ledger.subscriptions.map((sub) => {
          const service = ledger.services.find((item) => item.id === sub.serviceId);
          const plan = ledger.plans.find((item) => item.id === sub.planQuoteId);
          const card = ledger.heldCards.find((item) => item.id === sub.userCardId);
          const cardName = ledger.cards.find((item) => item.id === card?.cardId)?.name;
          const price = selectPrice({
            listCents: plan?.priceCents ?? null,
            studentCents: plan?.studentPriceCents ?? null,
            militaryCents: plan?.militaryPriceCents ?? null,
            overrideCents: sub.priceOverrideCents,
            qualifiesStudent: ledger.qualifiesStudent,
            qualifiesMilitary: ledger.qualifiesMilitary,
            verification: plan?.verification ?? "unknown",
          });
          return (
            <li key={sub.id} className="rounded-xl border border-line bg-card p-4 text-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="text-xl">{service?.name ?? sub.serviceId}</h3>
                  <p>
                    {plan && price.cents != null
                      ? `${plan.name} · ${formatCents(price.cents)} · `
                      : sub.priceOverrideCents != null
                        ? `Your price · ${formatCents(sub.priceOverrideCents)} · `
                        : ""}
                    {sub.billing} · {sub.status}
                  </p>
                  <p>
                    Pays with {cardName ?? "no card selected"} ·{" "}
                    {sub.billing === "monthly" ? "Billed every month" : `Renews ${sub.renewalDate}`}
                  </p>
                  <p>
                    Price used <Money cents={price.cents} /> · {price.basis}
                  </p>
                </div>
                <StatusPill status={price.verification} />
              </div>
              {sub.notes ? <p className="mt-1 text-muted">{sub.notes}</p> : null}
              <div className="mt-2 flex gap-3">
                <button
                  type="button"
                  className="font-semibold text-forest"
                  onClick={() => setEditing(sub.id)}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className="font-semibold text-clay"
                  onClick={() => run(() => deleteSubscription({ data: sub.id }))}
                >
                  Remove
                </button>
              </div>
              {editing === sub.id ? (
                <SubscriptionForm id={sub.id} onDone={() => setEditing(null)} />
              ) : null}
            </li>
          );
        })}
      </ul>
      {ledger.subscriptions.length === 0 ? (
        <p className="text-sm text-muted">
          No subscriptions yet. Add one to start the monthly math.
        </p>
      ) : null}
      <button
        type="button"
        className="h-11 justify-self-start rounded-lg bg-forest px-4 font-semibold text-forest-ink"
        onClick={() => setEditing("new")}
      >
        Add subscription
      </button>
      {editing === "new" ? <SubscriptionForm onDone={() => setEditing(null)} /> : null}
    </div>
  );
}

function SubscriptionForm({ id, onDone }: { id?: string; onDone: () => void }) {
  const { ledger, run } = useLedger();
  const existing = ledger?.subscriptions.find((item) => item.id === id);
  const [serviceId, setServiceId] = useState(existing?.serviceId ?? ledger?.services[0]?.id ?? "");
  const [planQuoteId, setPlanQuoteId] = useState(existing?.planQuoteId ?? "");
  const [userCardId, setUserCardId] = useState(existing?.userCardId ?? "");
  const [billing, setBilling] = useState(existing?.billing ?? "monthly");
  const [renewalDate, setRenewalDate] = useState(existing?.renewalDate ?? "");
  const [override, setOverride] = useState(
    existing?.priceOverrideCents != null ? (existing.priceOverrideCents / 100).toFixed(2) : "",
  );
  const [status, setStatus] = useState(existing?.status ?? "active");
  const [notes, setNotes] = useState(existing?.notes ?? "");
  if (!ledger) return null;
  const plans = ledger.plans.filter(
    (plan) =>
      plan.serviceId === serviceId &&
      (plan.priceCents != null ||
        plan.studentPriceCents != null ||
        plan.militaryPriceCents != null),
  );

  return (
    <form
      className="mt-3 grid gap-3 rounded-xl border border-line bg-paper p-4 md:grid-cols-2"
      onSubmit={(event) => {
        event.preventDefault();
        void run(() =>
          saveSubscription({
            data: {
              id,
              serviceId,
              planQuoteId: plans.some((plan) => plan.id === planQuoteId) ? planQuoteId : null,
              userCardId: userCardId || null,
              billing,
              renewalDate: renewalDate || null,
              priceOverrideCents: dollarsToCents(override),
              status,
              notes,
            },
          }),
        ).then(onDone);
      }}
    >
      <Field label="Service">
        <select
          className={controlClass}
          value={serviceId}
          onChange={(event) => {
            setServiceId(event.target.value);
            setPlanQuoteId("");
          }}
        >
          {ledger.services.map((service) => (
            <option key={service.id} value={service.id}>
              {service.name}
            </option>
          ))}
        </select>
      </Field>
      {plans.length > 0 ? (
        <Field label="Quote">
          <select
            className={controlClass}
            value={planQuoteId}
            onChange={(event) => setPlanQuoteId(event.target.value)}
          >
            <option value="">None — I’ll enter what I pay</option>
            {plans.map((plan) => (
              <option key={plan.id} value={plan.id}>
                {[
                  plan.name,
                  plan.billing,
                  plan.priceCents != null ? `list ${formatCents(plan.priceCents)}` : null,
                  plan.studentPriceCents != null
                    ? `student ${formatCents(plan.studentPriceCents)}`
                    : null,
                  plan.militaryPriceCents != null
                    ? `military ${formatCents(plan.militaryPriceCents)}`
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </option>
            ))}
          </select>
        </Field>
      ) : (
        <p className="text-sm text-muted md:col-span-2">
          No priced quote for this service. Enter what you pay. A plan name is not asked until a
          price is on file.
        </p>
      )}
      <Field label="Payment card">
        <select
          className={controlClass}
          value={userCardId}
          onChange={(event) => setUserCardId(event.target.value)}
        >
          <option value="">None</option>
          {ledger.heldCards.map((card) => (
            <option key={card.id} value={card.id}>
              {ledger.cards.find((item) => item.id === card.cardId)?.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Billing frequency">
        <select
          className={controlClass}
          value={billing}
          onChange={(event) => setBilling(event.target.value as typeof billing)}
        >
          {BILLING_PERIODS.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Renewal date">
        <input
          type="date"
          className={controlClass}
          value={renewalDate}
          onChange={(event) => setRenewalDate(event.target.value)}
        />
        <span className="font-normal text-muted">
          Optional. Blank saves the 1st of next month. Monthly bills do not wait for that date.
        </span>
      </Field>
      <Field label={planQuoteId ? "Price override (USD)" : "What you pay (USD)"}>
        <input
          className={controlClass}
          inputMode="decimal"
          value={override}
          onChange={(event) => setOverride(event.target.value)}
          placeholder={planQuoteId ? "Blank to use the quote" : "Unknown if blank"}
        />
      </Field>
      <Field label="Status">
        <select
          className={controlClass}
          value={status}
          onChange={(event) => setStatus(event.target.value as typeof status)}
        >
          <option value="active">active</option>
          <option value="paused">paused</option>
          <option value="canceled">canceled</option>
        </select>
      </Field>
      <Field label="Notes">
        <input
          className={controlClass}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
        />
      </Field>
      <button
        type="submit"
        className="h-11 rounded-lg bg-forest font-semibold text-forest-ink md:col-span-2"
      >
        Save subscription
      </button>
    </form>
  );
}

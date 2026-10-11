import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Field, Money, SourceLine, StatusPill, controlClass, useLedger } from "@/components/benefits/chrome";
import { holdCard, releaseCard, saveBenefit, saveFee, setEnrollment, setRelief } from "@/lib/benefits/api";
import { BENEFIT_KINDS, BILLING_PERIODS, dollarsToCents } from "@/lib/benefits/money";

export const Route = createFileRoute("/_app/cards")({ component: CardsPage });

function CardsPage() {
  const { ledger, busy, run, refreshSources } = useLedger();
  const [family, setFamily] = useState("All");
  const [editing, setEditing] = useState<string | null>(null);
  if (!ledger) return null;
  const families = ["All", ...new Set(ledger.cards.map((card) => card.familyName))];
  const visible = ledger.cards.filter((card) => family === "All" || card.familyName === family);

  return (
    <div className="grid gap-4">
      <div>
        <h2 className="text-3xl">Card benefits</h2>
        <p className="max-w-2xl text-sm text-pretty text-muted">
          Consumer cards stay separate, including The Platinum Card and Delta SkyMiles Platinum. Annual fees and military fee relief are tracked apart. Account-specific offers stay unconfirmed until you enter them.
        </p>
      </div>
      <select aria-label="Card family" className={`${controlClass} max-w-md`} value={family} onChange={(event) => setFamily(event.target.value)}>
        {families.map((item) => <option key={item}>{item}</option>)}
      </select>
      <ul className="grid gap-3">
        {visible.map((card) => {
          const held = ledger.heldCards.find((item) => item.cardId === card.id);
          const fee = ledger.fees.find((item) => item.cardId === card.id);
          const benefits = ledger.benefits.filter((item) => item.cardId === card.id);
          return (
            <li key={card.id} className="rounded-xl border border-line bg-card p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">{card.issuer} · {card.familyName}</p>
              <h3 className="text-xl">{card.name}</h3>
              <p className="text-sm text-pretty text-muted">{card.separatesFrom}</p>
              <p className="mt-1 text-xs">
                <a className="font-semibold text-forest underline-offset-2 hover:underline" href={card.officialUrl} target="_blank" rel="noreferrer">Official page</a>
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" disabled={busy} className="h-11 rounded-lg border border-line px-3 text-sm font-semibold" onClick={() => refreshSources("card", card.id)}>
                  Refresh this card
                </button>
                {held ? (
                  <button type="button" className="h-11 rounded-lg border border-line px-3 text-sm font-semibold" onClick={() => run(() => releaseCard({ data: card.id }))}>
                    I do not hold this card
                  </button>
                ) : (
                  <button type="button" className="h-11 rounded-lg bg-forest px-3 text-sm font-semibold text-forest-ink" onClick={() => run(() => holdCard({ data: { cardId: card.id, anniversary: null } }))}>
                    I hold this card
                  </button>
                )}
              </div>
              <div className="mt-3 text-sm">
                <p>
                  Annual fee <Money cents={fee?.annualFeeCents ?? null} />{" "}
                  {fee ? <StatusPill status={fee.verification} /> : <StatusPill status="unknown" />}
                </p>
                {fee ? <SourceLine url={fee.sourceUrl ?? card.officialUrl} checkedAt={fee.checkedAt} lastSuccessAt={fee.lastSuccessAt} failureNote={fee.failureNote} /> : <p className="text-xs text-muted">No fee on file.</p>}
              </div>
              {held ? (
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <Field label="Fee anniversary">
                    <input
                      type="date"
                      className={controlClass}
                      value={held.anniversary ?? ""}
                      onChange={(event) => run(() => holdCard({ data: { cardId: card.id, anniversary: event.target.value || null } }))}
                    />
                  </Field>
                  <Field label="Military fee relief">
                    <select
                      className={controlClass}
                      value={held.militaryRelief}
                      onChange={(event) => run(() => setRelief({ data: { cardId: card.id, militaryRelief: event.target.value } }))}
                    >
                      <option value="unconfirmed">Unconfirmed</option>
                      <option value="waived_user">I confirmed a waiver</option>
                      <option value="not_waived_user">I confirmed it is not waived</option>
                    </select>
                  </Field>
                  <FeeForm cardId={card.id} />
                </div>
              ) : (
                <p className="mt-2 text-sm text-muted">Mark the card as held before its credits count.</p>
              )}
              <ul className="mt-3 grid gap-2">
                {benefits.map((benefit) => (
                  <li key={benefit.id} className="rounded-lg border border-line px-3 py-2 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-semibold">{benefit.name}</p>
                      <StatusPill status={benefit.verification} />
                    </div>
                    <p>
                      {benefit.kind.replaceAll("_", " ")} · {benefit.period} · cap <Money cents={benefit.amountCents} />
                      {benefit.rateBps != null ? ` · ${(benefit.rateBps / 100).toFixed(2)}% cash back` : ""}
                      {benefit.pointsPerDollarMilli != null ? ` · ${benefit.pointsPerDollarMilli / 1000} points per dollar` : ""}
                    </p>
                    <p className="text-muted">
                      {benefit.enrollmentRequired ? "Enrollment required. " : "No enrollment flag. "}
                      {benefit.expiresOn ? `Expires ${benefit.expiresOn}. ` : ""}
                      {benefit.stackingNotes}
                    </p>
                    <SourceLine url={benefit.sourceUrl ?? card.officialUrl} checkedAt={benefit.checkedAt} lastSuccessAt={benefit.lastSuccessAt} failureNote={benefit.failureNote} />
                    {benefit.enrollmentRequired ? (
                      <label className="mt-1 flex items-center gap-2">
                        <input type="checkbox" checked={benefit.enrolled} onChange={(event) => run(() => setEnrollment({ data: { benefitId: benefit.id, enrolled: event.target.checked } }))} />
                        I have enrolled
                      </label>
                    ) : null}
                  </li>
                ))}
              </ul>
              <button type="button" className="mt-3 text-sm font-semibold text-forest" onClick={() => setEditing(editing === card.id ? null : card.id)}>
                {editing === card.id ? "Close benefit form" : "Add a benefit I confirmed"}
              </button>
              {editing === card.id ? <BenefitForm cardId={card.id} onDone={() => setEditing(null)} /> : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function FeeForm({ cardId }: { cardId: string }) {
  const { run } = useLedger();
  const [amount, setAmount] = useState("");
  return (
    <form
      className="grid gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        void run(() => saveFee({ data: { cardId, annualFeeCents: dollarsToCents(amount) } }));
      }}
    >
      <Field label="Annual fee I confirmed">
        <input className={controlClass} inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0.00 if none" />
      </Field>
      <button type="submit" className="h-11 rounded-lg border border-line text-sm font-semibold">Save fee as entered</button>
    </form>
  );
}

function BenefitForm({ cardId, onDone }: { cardId: string; onDone: () => void }) {
  const { ledger, run } = useLedger();
  const [name, setName] = useState("");
  const [benefitKind, setBenefitKind] = useState("statement_credit");
  const [period, setPeriod] = useState("monthly");
  const [amount, setAmount] = useState("");
  const [services, setServices] = useState<string[]>([]);
  const [enrollmentRequired, setEnrollmentRequired] = useState(false);
  const [expiresOn, setExpiresOn] = useState("");
  const [stackingNotes, setStackingNotes] = useState("");
  if (!ledger) return null;

  return (
    <form
      className="mt-3 grid gap-3 border-t border-line pt-3"
      onSubmit={(event) => {
        event.preventDefault();
        void run(() =>
          saveBenefit({
            data: {
              cardId,
              name,
              kind: benefitKind,
              amountCents: dollarsToCents(amount),
              rateBps: null,
              pointsPerDollarMilli: null,
              period,
              eligibleServiceIds: services,
              enrollmentRequired,
              enrollmentNotes: enrollmentRequired ? "Marked required from your entry." : "",
              expiresOn: expiresOn || null,
              stackingNotes,
            },
          }),
        ).then(onDone);
      }}
    >
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Benefit name"><input className={controlClass} required value={name} onChange={(event) => setName(event.target.value)} /></Field>
        <Field label="Type">
          <select className={controlClass} value={benefitKind} onChange={(event) => setBenefitKind(event.target.value)}>
            {BENEFIT_KINDS.map((item) => <option key={item} value={item}>{item.replaceAll("_", " ")}</option>)}
          </select>
        </Field>
        <Field label="Period">
          <select className={controlClass} value={period} onChange={(event) => setPeriod(event.target.value)}>
            {BILLING_PERIODS.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </Field>
        <Field label="Cap in dollars (blank if unknown)">
          <input className={controlClass} inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} />
        </Field>
        <Field label="Expires">
          <input type="date" className={controlClass} value={expiresOn} onChange={(event) => setExpiresOn(event.target.value)} />
        </Field>
        <Field label="Stacking notes">
          <input className={controlClass} value={stackingNotes} onChange={(event) => setStackingNotes(event.target.value)} />
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={enrollmentRequired} onChange={(event) => setEnrollmentRequired(event.target.checked)} />
        Enrollment required
      </label>
      <fieldset>
        <legend className="text-sm font-semibold">Eligible services</legend>
        <div className="mt-2 grid max-h-40 grid-cols-2 gap-1 overflow-auto text-sm">
          {ledger.services.map((service) => (
            <label key={service.id} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={services.includes(service.id)}
                onChange={(event) =>
                  setServices(event.target.checked ? [...services, service.id] : services.filter((id) => id !== service.id))
                }
              />
              {service.name}
            </label>
          ))}
        </div>
      </fieldset>
      <p className="text-xs text-muted">Saved as “You entered”. Cash-back rates and point multipliers can be filled by a successful card refresh.</p>
      <button type="submit" className="h-11 rounded-lg bg-forest font-semibold text-forest-ink">Save benefit</button>
    </form>
  );
}

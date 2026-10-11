import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState, type FormEvent } from "react";
import { Field, Money, SourceLine, StatusPill, controlClass, useLedger } from "@/components/benefits/chrome";
import { deletePlan, savePlan } from "@/lib/benefits/api";
import { BILLING_PERIODS, dollarsToCents } from "@/lib/benefits/money";

export const Route = createFileRoute("/_app/catalog")({ component: Catalog });

function Catalog() {
  const { ledger, busy, run, refreshSources } = useLedger();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const [openId, setOpenId] = useState<string | null>(null);
  if (!ledger) return null;
  const categories = ["All", ...new Set(ledger.services.map((service) => service.category))];
  const visible = ledger.services.filter((service) => {
    const haystack = `${service.name} ${service.notes}`.toLowerCase();
    const matchesQuery = haystack.includes(query.trim().toLowerCase());
    return matchesQuery && (category === "All" || service.category === category);
  });

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-3xl">Service catalog</h2>
          <p className="max-w-2xl text-sm text-pretty text-muted">
            Fifty services, with official pages and no sample prices. A price appears only after a successful source check or after you enter what you pay.
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search services"
          aria-label="Search services"
          className={`${controlClass} max-w-sm`}
        />
        <select aria-label="Category" value={category} onChange={(event) => setCategory(event.target.value)} className={`${controlClass} max-w-xs`}>
          {categories.map((item) => (
            <option key={item}>{item}</option>
          ))}
        </select>
      </div>
      <ul className="grid gap-3">
        {visible.map((service) => {
          const plans = ledger.plans.filter((plan) => plan.serviceId === service.id);
          return (
            <li key={service.id} className="rounded-xl border border-line bg-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted">{service.category}</p>
                  <h3 className="text-xl">{service.name}</h3>
                  {service.notes ? <p className="text-sm text-pretty text-muted">{service.notes}</p> : null}
                  <p className="mt-1 text-xs">
                    <a className="font-semibold text-forest underline-offset-2 hover:underline" href={service.officialUrl} target="_blank" rel="noreferrer">
                      Official page
                    </a>
                  </p>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => refreshSources("service", service.id)}
                  className="h-11 rounded-lg border border-line px-3 text-sm font-semibold"
                >
                  Refresh this service
                </button>
              </div>
              {plans.length === 0 ? (
                <p className="mt-3 text-sm text-muted">No plan price on file. Status: unknown.</p>
              ) : (
                <ul className="mt-3 grid gap-3">
                  {plans.map((plan) => (
                    <li key={plan.id} className="rounded-lg border border-line px-3 py-2 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-semibold">{plan.name} · {plan.billing}</p>
                        <StatusPill status={plan.verification} />
                      </div>
                      <p className="mt-1">
                        List <Money cents={plan.priceCents} />
                        {" · "}Student <Money cents={plan.studentPriceCents} />
                        {" · "}Military <Money cents={plan.militaryPriceCents} />
                      </p>
                      {plan.eligibility ? <p className="text-muted">Eligibility: {plan.eligibility}</p> : null}
                      {plan.terms ? <p className="text-muted">Terms: {plan.terms}</p> : null}
                      <SourceLine url={plan.sourceUrl ?? service.officialUrl} checkedAt={plan.checkedAt} lastSuccessAt={plan.lastSuccessAt} failureNote={plan.failureNote} />
                      <button type="button" className="mt-1 text-xs font-semibold text-clay" onClick={() => run(() => deletePlan({ data: plan.id }))}>
                        Remove quote
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <button type="button" className="mt-3 text-sm font-semibold text-forest" onClick={() => setOpenId(openId === service.id ? null : service.id)}>
                {openId === service.id ? "Close form" : "Enter a plan I pay for"}
              </button>
              {openId === service.id ? <PlanForm serviceId={service.id} onDone={() => setOpenId(null)} /> : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function PlanForm({ serviceId, onDone }: { serviceId: string; onDone: () => void }) {
  const { run } = useLedger();
  const [name, setName] = useState("");
  const [billing, setBilling] = useState("monthly");
  const [price, setPrice] = useState("");
  const [student, setStudent] = useState("");
  const [military, setMilitary] = useState("");
  const [eligibility, setEligibility] = useState("");
  const [terms, setTerms] = useState("");
  const [error, setError] = useState<string | null>(null);
  const periods = useMemo(() => BILLING_PERIODS, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      await run(() =>
        savePlan({
          data: {
            serviceId,
            name,
            billing,
            priceCents: dollarsToCents(price),
            studentPriceCents: dollarsToCents(student),
            militaryPriceCents: dollarsToCents(military),
            eligibility,
            terms,
          },
        }),
      );
      onDone();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save.");
    }
  }

  return (
    <form onSubmit={submit} className="mt-3 grid gap-3 border-t border-line pt-3 md:grid-cols-2">
      <Field label="Plan name"><input className={controlClass} value={name} onChange={(event) => setName(event.target.value)} required /></Field>
      <Field label="Billing">
        <select className={controlClass} value={billing} onChange={(event) => setBilling(event.target.value)}>
          {periods.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
      </Field>
      <Field label="List price (USD)"><input className={controlClass} inputMode="decimal" value={price} onChange={(event) => setPrice(event.target.value)} placeholder="Unknown if blank" /></Field>
      <Field label="Student price"><input className={controlClass} inputMode="decimal" value={student} onChange={(event) => setStudent(event.target.value)} /></Field>
      <Field label="Military price"><input className={controlClass} inputMode="decimal" value={military} onChange={(event) => setMilitary(event.target.value)} /></Field>
      <Field label="Eligibility"><input className={controlClass} value={eligibility} onChange={(event) => setEligibility(event.target.value)} /></Field>
      <Field label="Terms and stacking"><input className={controlClass} value={terms} onChange={(event) => setTerms(event.target.value)} /></Field>
      {error ? <p className="text-sm text-clay md:col-span-2">{error}</p> : null}
      <p className="text-xs text-muted md:col-span-2">Saved as “You entered”, not as an official verification.</p>
      <button type="submit" className="h-11 rounded-lg bg-forest px-4 font-semibold text-forest-ink md:col-span-2">Save plan</button>
    </form>
  );
}

import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState, type ReactNode } from "react";
import { Money, StatusPill, useLedger } from "@/components/benefits/chrome";
import { updateSettings } from "@/lib/benefits/api";
import { buildMonthEstimate } from "@/lib/benefits/calc";
import { confirmedTotals } from "@/lib/benefits/calc";
import { currentYearMonth, ledgerToEstimate } from "@/lib/benefits/view";

export const Route = createFileRoute("/_app/")({ component: Dashboard });

function Dashboard() {
  const { ledger, busy, refreshSources, run } = useLedger();
  const [yearMonth, setYearMonth] = useState(currentYearMonth);
  const estimate = useMemo(
    () => (ledger ? buildMonthEstimate(ledgerToEstimate(ledger, yearMonth)) : null),
    [ledger, yearMonth],
  );
  if (!ledger || !estimate) return null;
  const monthEntries = ledger.entries.filter((entry) => entry.yearMonth === yearMonth);
  const confirmed = confirmedTotals(monthEntries);
  const serviceName = (id: string) => ledger.services.find((service) => service.id === id)?.name ?? id;

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-3xl">This month</h2>
          <p className="max-w-2xl text-sm text-pretty text-muted">
            Expected cost uses only verified, stale, or entered prices. Unknown prices are left out and are not treated as $0.
            Rewards stay separate from out-of-pocket.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <label className="grid text-sm font-semibold">
            Month
            <input
              type="month"
              value={yearMonth}
              onChange={(event) => setYearMonth(event.target.value)}
              className="h-11 rounded-lg border border-line bg-card px-3 font-normal"
            />
          </label>
          <button
            type="button"
            disabled={busy}
            onClick={() => refreshSources("all")}
            className="h-11 self-end rounded-lg bg-forest px-4 font-semibold text-forest-ink disabled:opacity-60"
          >
            {busy ? "Refreshing…" : "Refresh official sources"}
          </button>
        </div>
      </div>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile
          label={estimate.incomplete ? "Expected out-of-pocket (partial)" : "Expected out-of-pocket"}
          value={estimate.expectedOopCents}
          note={estimate.incomplete ? "Excludes unknown prices and unscheduled fees." : "Known charges, credits, and fees."}
        />
        <Tile label="Discounts vs list" value={estimate.discountCents} note="Student or military alternate prices. Not stacked." />
        <Tile label="Credits reducing cost" value={estimate.oopReductionCents} note="Statement credits and included memberships." />
        <Tile label="Confirmed spending" value={monthEntries.length ? confirmed.oopCents : null} note="From history. Independent of later price changes." />
      </section>

      <section className="grid gap-3 rounded-xl border border-line bg-card p-4 md:grid-cols-3">
        <div>
          <p className="text-sm font-semibold">Upfront this month</p>
          <p className="text-xl tabular-nums"><Money cents={estimate.upfrontChargeCents} /></p>
          <p className="text-xs text-muted">
            Monthly equivalent of those upfront charges: <Money cents={estimate.monthlyEquivalentOfUpfrontCents} />. That equivalent is not the bill.
          </p>
        </div>
        <div>
          <p className="text-sm font-semibold">Rewards, not cash back on the bill</p>
          <p className="text-xl tabular-nums">
            <Money cents={estimate.rewardCashBackCents} />
            <span className="text-base text-muted"> · {estimate.rewardPoints} pts</span>
          </p>
          <p className="text-xs text-muted">
            Confirmed rewards this month: <Money cents={monthEntries.length ? confirmed.rewardCashBackCents : null} /> · {confirmed.rewardPoints} pts
          </p>
        </div>
        <form className="grid gap-2 text-sm">
          <p className="font-semibold">Assumptions</p>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={ledger.qualifiesStudent}
              onChange={(event) =>
                run(() => updateSettings({ data: { qualifiesStudent: event.target.checked, qualifiesMilitary: ledger.qualifiesMilitary } }))
              }
            />
            I qualify for student offers
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={ledger.qualifiesMilitary}
              onChange={(event) =>
                run(() => updateSettings({ data: { qualifiesStudent: ledger.qualifiesStudent, qualifiesMilitary: event.target.checked } }))
              }
            />
            I qualify for military subscription offers
          </label>
        </form>
      </section>

      {estimate.unknownSubscriptions.length > 0 ? (
        <section>
          <h3 className="text-xl">Unknown</h3>
          <ul className="mt-2 grid gap-2">
            {estimate.unknownSubscriptions.map((item) => (
              <li key={item.subscriptionId} className="rounded-lg border border-line bg-card px-3 py-2 text-sm">
                <span className="font-semibold">{item.serviceName}. </span>
                {item.reason}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="grid gap-4 lg:grid-cols-2">
        <List title="Charges" empty="No known charge falls in this month.">
          {estimate.charges.map((charge) => (
            <li key={charge.subscriptionId} className="flex items-start justify-between gap-3">
              <div>
                <p className="font-semibold">{charge.serviceName}</p>
                <p className="text-xs text-muted">{charge.basis} · {charge.billing}</p>
              </div>
              <div className="text-right">
                <Money cents={charge.amountCents} />
                <div><StatusPill status={charge.verification} /></div>
              </div>
            </li>
          ))}
        </List>
        <List title="Credits and fees" empty="No credit or scheduled fee.">
          {estimate.credits.map((credit, index) => (
            <li key={`${credit.benefitId}-${index}`} className="flex items-start justify-between gap-3">
              <div>
                <p className="font-semibold">{credit.benefitName}</p>
                <p className="text-xs text-muted">{credit.serviceName} · {credit.note}</p>
              </div>
              <Money cents={credit.reducesOop ? -credit.amountCents : credit.amountCents} />
            </li>
          ))}
          {estimate.cardFees.map((fee) => (
            <li key={fee.userCardId} className="flex items-start justify-between gap-3">
              <div>
                <p className="font-semibold">{fee.cardName} fee</p>
                <p className="text-xs text-muted">{fee.note}</p>
              </div>
              <Money cents={fee.amountCents} />
            </li>
          ))}
        </List>
      </section>

      {estimate.overlaps.length > 0 || estimate.duplicateServiceIds.length > 0 ? (
        <section className="rounded-xl border border-line bg-brass-soft p-4 text-sm">
          <h3 className="text-lg text-brass">Possible overlap</h3>
          <ul className="mt-2 grid gap-2">
            {estimate.duplicateServiceIds.map((id) => (
              <li key={id}>Two active subscriptions for {serviceName(id)}.</li>
            ))}
            {estimate.overlaps.map((overlap) => (
              <li key={overlap.note}>{overlap.ids.map(serviceName).join(" and ")}. {overlap.note}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <section>
        <h3 className="text-xl">Suggestions</h3>
        {estimate.recommendations.length === 0 ? (
          <p className="mt-2 text-sm text-muted">No cheaper verified or entered plan is on file. Add quotes or refresh a source.</p>
        ) : (
          <ul className="mt-2 grid gap-3">
            {estimate.recommendations.map((item) => (
              <li key={item.serviceId} className="rounded-xl border border-line bg-card p-4">
                <p className="font-semibold">{item.serviceName}</p>
                <p className="text-sm">{item.suggestion}</p>
                <ul className="mt-2 list-disc pl-5 text-xs text-muted">
                  {item.assumptions.map((assumption) => (
                    <li key={assumption}>{assumption}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Tile({ label, value, note }: { label: string; value: number | null; note: string }) {
  return (
    <article className="rounded-xl border border-line bg-card p-4">
      <p className="text-sm font-semibold text-muted">{label}</p>
      <p className="mt-1 text-2xl"><Money cents={value} /></p>
      <p className="mt-1 text-xs text-muted">{note}</p>
    </article>
  );
}

function List({ title, empty, children }: { title: string; empty: string; children: ReactNode }) {
  const emptyList = Array.isArray(children) ? children.length === 0 : !children;
  return (
    <section className="rounded-xl border border-line bg-card p-4">
      <h3 className="text-lg">{title}</h3>
      {emptyList ? <p className="mt-2 text-sm text-muted">{empty}</p> : <ul className="mt-3 grid gap-3 text-sm">{children}</ul>}
    </section>
  );
}

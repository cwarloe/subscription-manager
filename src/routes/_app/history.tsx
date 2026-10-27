import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Field, Money, controlClass, useLedger } from "@/components/benefits/chrome";
import { deleteEntry, saveEntry, snapshotMonth } from "@/lib/benefits/api";
import { confirmedTotals } from "@/lib/benefits/calc";
import { currentYearMonth, ledgerToEstimate } from "@/lib/benefits/view";
import { dollarsToCents } from "@/lib/benefits/money";
import { buildMonthEstimate } from "@/lib/benefits/calc";

export const Route = createFileRoute("/_app/history")({ component: HistoryPage });

const KINDS = [
  "charge",
  "statement_credit",
  "included_membership",
  "cash_back",
  "points",
  "card_fee",
  "adjustment",
];

function HistoryPage() {
  const { ledger, busy, run } = useLedger();
  const [yearMonth, setYearMonth] = useState(currentYearMonth());
  const [kind, setKind] = useState("charge");
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [points, setPoints] = useState("");
  const [note, setNote] = useState("");
  if (!ledger) return null;
  const months = [...new Set([yearMonth, ...ledger.entries.map((entry) => entry.yearMonth)])]
    .sort()
    .reverse();
  const estimate = buildMonthEstimate(ledgerToEstimate(ledger, yearMonth));

  return (
    <div className="grid gap-4">
      <div>
        <h2 className="text-3xl">Monthly history</h2>
        <p className="max-w-2xl text-sm text-pretty text-muted">
          Confirmed rows stay as written. Refreshing a price later does not rewrite them. A snapshot
          copies the known estimate and replaces only earlier snapshots for that month.
        </p>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Month">
          <input
            type="month"
            className={controlClass}
            value={yearMonth}
            onChange={(event) => setYearMonth(event.target.value)}
          />
        </Field>
        <button
          type="button"
          disabled={busy}
          className="h-11 rounded-lg bg-forest px-4 font-semibold text-forest-ink disabled:opacity-60"
          onClick={() => run(() => snapshotMonth({ data: { yearMonth } }))}
        >
          Save known estimate as confirmed
        </button>
      </div>
      <p className="text-sm text-muted">
        Current estimate for {yearMonth} is{" "}
        <Money cents={estimate.incomplete ? null : estimate.expectedOopCents} />
        {estimate.incomplete
          ? " (partial, so the headline stays unknown until prices are filled; the snapshot still stores each known line)."
          : "."}
      </p>
      {months.map((month) => {
        const rows = ledger.entries.filter((entry) => entry.yearMonth === month);
        if (rows.length === 0) return null;
        const totals = confirmedTotals(rows);
        return (
          <section key={month} className="rounded-xl border border-line bg-card p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-xl">{month}</h3>
              <p className="text-sm">
                Out-of-pocket <Money cents={totals.oopCents} /> · Rewards{" "}
                <Money cents={totals.rewardCashBackCents} /> · {totals.rewardPoints} pts
              </p>
            </div>
            <ul className="mt-3 grid gap-2 text-sm">
              {rows.map((entry) => (
                <li
                  key={entry.id}
                  className="flex flex-wrap items-start justify-between gap-2 border-t border-line pt-2"
                >
                  <div>
                    <p className="font-semibold">{entry.label}</p>
                    <p className="text-xs text-muted">
                      {entry.kind} · {entry.source} ·{" "}
                      {entry.affectsOop ? "changes out-of-pocket" : "reward only"}
                      {entry.note ? ` · ${entry.note}` : ""}
                    </p>
                  </div>
                  <div className="text-right">
                    <Money cents={entry.amountCents} />
                    {entry.points ? <p className="text-xs text-muted">{entry.points} pts</p> : null}
                    <button
                      type="button"
                      className="block text-xs font-semibold text-clay"
                      onClick={() => run(() => deleteEntry({ data: entry.id }))}
                    >
                      Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      <form
        className="grid gap-3 rounded-xl border border-line bg-card p-4 md:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          const parsed = dollarsToCents(amount);
          if (parsed == null) return;
          const parsedPoints = points.trim() ? Number(points) : null;
          if (parsedPoints != null && !Number.isInteger(parsedPoints)) return;
          void run(() =>
            saveEntry({
              data: {
                yearMonth,
                kind,
                label,
                amountCents: parsed,
                points: parsedPoints,
                affectsOop: kind !== "cash_back" && kind !== "points",
                note,
              },
            }),
          );
        }}
      >
        <h3 className="text-lg md:col-span-2">Add a confirmed line</h3>
        <Field label="Type">
          <select
            className={controlClass}
            value={kind}
            onChange={(event) => setKind(event.target.value)}
          >
            {KINDS.map((item) => (
              <option key={item} value={item}>
                {item.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Label">
          <input
            className={controlClass}
            required
            value={label}
            onChange={(event) => setLabel(event.target.value)}
          />
        </Field>
        <Field label="Amount (USD)">
          <input
            className={controlClass}
            required
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
        </Field>
        <Field label="Points, if any">
          <input
            className={controlClass}
            inputMode="numeric"
            value={points}
            onChange={(event) => setPoints(event.target.value)}
          />
        </Field>
        <Field label="Note">
          <input
            className={controlClass}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </Field>
        <button
          type="submit"
          className="h-11 rounded-lg bg-forest font-semibold text-forest-ink md:col-span-2"
        >
          Add to history
        </button>
      </form>
    </div>
  );
}

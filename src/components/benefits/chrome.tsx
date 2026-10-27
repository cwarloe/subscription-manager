import { Link } from "@tanstack/react-router";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { GROK_PROVIDERS, authClient, signIn } from "@/lib/auth/client";
import { UserButton } from "@/lib/auth/gates";
import {
  beginRefresh,
  getLedger,
  stepRefresh,
  type Ledger,
  type RefreshItem,
} from "@/lib/benefits/api";
import { formatCents, verificationLabel, type Verification } from "@/lib/benefits/money";

type RefreshRun = {
  id: string;
  status: string;
  message: string;
  items: RefreshItem[];
};

type LedgerContextValue = {
  ledger: Ledger | null;
  loading: boolean;
  error: string | null;
  busy: boolean;
  refreshRun: RefreshRun | null;
  apply: (next: Ledger) => void;
  reload: () => Promise<void>;
  run: (work: () => Promise<Ledger>) => Promise<void>;
  refreshSources: (scope: "all" | "service" | "card", targetId?: string) => Promise<void>;
};

const LedgerContext = createContext<LedgerContextValue | null>(null);

export function useLedger(): LedgerContextValue {
  const value = useContext(LedgerContext);
  if (!value) throw new Error("Ledger is only available inside the app.");
  return value;
}

const NAV = [
  { to: "/", label: "Dashboard" },
  { to: "/catalog", label: "Catalog" },
  { to: "/cards", label: "Cards" },
  { to: "/subscriptions", label: "Subscriptions" },
  { to: "/history", label: "History" },
] as const;

export function StatusPill({ status }: { status: Verification }) {
  const tone =
    status === "verified"
      ? "bg-forest text-forest-ink"
      : status === "stale"
        ? "bg-brass-soft text-brass"
        : status === "user_entered"
          ? "bg-card text-ink border border-line"
          : "bg-paper text-muted border border-line";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-semibold ${tone}`}
    >
      {verificationLabel(status)}
    </span>
  );
}

export function Money({ cents }: { cents: number | null | undefined }) {
  const unknown = cents == null;
  return (
    <span className={`tabular-nums ${unknown ? "text-muted" : "text-ink"}`}>
      {formatCents(cents)}
    </span>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-1 text-sm font-semibold text-ink">
      {label}
      {children}
    </label>
  );
}

export const controlClass =
  "h-11 w-full rounded-lg border border-line bg-card px-3 text-base font-normal text-ink";

export function AppFrame({ children }: { children: ReactNode }) {
  const { user, isPending } = useCurrentUserState();
  return (
    <div className="min-h-screen">
      <a
        href="#content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-10 focus:bg-card focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <header className="border-b border-line bg-card">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-forest">
              Private ledger
            </p>
            <h1 className="text-2xl text-ink">Subscription Benefits</h1>
            <p className="max-w-xl text-sm text-pretty text-muted">
              Compare what you pay with student offers, military offers, and card credits. Unknown
              prices stay unknown.
            </p>
          </div>
          {user ? <UserButton /> : <span className="text-sm text-muted">Not signed in</span>}
        </div>
      </header>
      {isPending ? (
        <main id="content" className="mx-auto max-w-6xl px-4 py-8">
          <p className="text-lg">Checking your session…</p>
          <p className="mt-2 max-w-xl text-sm text-muted">
            Saved plans, cards, and confirmed months load as soon as the session is ready.
          </p>
        </main>
      ) : user ? (
        <LedgerShell>{children}</LedgerShell>
      ) : (
        <main id="content" className="mx-auto max-w-6xl px-4 py-8">
          <SignInPanel />
        </main>
      )}
    </div>
  );
}

function LedgerShell({ children }: { children: ReactNode }) {
  const user = useCurrentUserState().user;
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshRun, setRefreshRun] = useState<RefreshRun | null>(null);

  const reload = useCallback(async () => {
    const next = await getLedger();
    setLedger(next);
    if (next.refresh?.status === "running") setRefreshRun(next.refresh);
  }, []);

  useEffect(() => {
    if (!user?.id) return;
    let cancel = false;
    setLoading(true);
    getLedger()
      .then((next) => {
        if (cancel) return;
        setLedger(next);
        if (next.refresh?.status === "running") setRefreshRun(next.refresh);
        setError(null);
      })
      .catch((reason: unknown) => {
        if (!cancel)
          setError(reason instanceof Error ? reason.message : "Could not load your ledger.");
      })
      .finally(() => {
        if (!cancel) setLoading(false);
      });
    return () => {
      cancel = true;
    };
  }, [user?.id]);

  const run = useCallback(async (work: () => Promise<Ledger>) => {
    setBusy(true);
    setError(null);
    try {
      setLedger(await work());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "That change did not save.");
    } finally {
      setBusy(false);
    }
  }, []);

  const pump = useCallback(async (runId: string) => {
    let current = await stepRefresh({ data: { runId } });
    setRefreshRun(current);
    while (current.status === "running") {
      await new Promise((resolve) => setTimeout(resolve, 300));
      current = await stepRefresh({ data: { runId } });
      setRefreshRun(current);
    }
    setLedger(await getLedger());
  }, []);

  const refreshSources = useCallback(
    async (scope: "all" | "service" | "card", targetId?: string) => {
      setBusy(true);
      setError(null);
      try {
        const started = await beginRefresh({ data: { scope, targetId: targetId ?? null } });
        setRefreshRun(started);
        if (started.status === "running") await pump(started.id);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Refresh did not start.");
      } finally {
        setBusy(false);
      }
    },
    [pump],
  );

  const value: LedgerContextValue = {
    ledger,
    loading,
    error,
    busy,
    refreshRun,
    apply: setLedger,
    reload,
    run,
    refreshSources,
  };

  return (
    <LedgerContext.Provider value={value}>
      <div className="mx-auto grid max-w-6xl gap-6 px-4 py-6">
        <nav aria-label="Sections" className="flex gap-2 overflow-x-auto">
          {NAV.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              activeOptions={{ exact: true }}
              activeProps={{ className: "bg-forest text-forest-ink" }}
              inactiveProps={{ className: "bg-card text-ink" }}
              className="inline-flex h-11 shrink-0 items-center rounded-full border border-line px-4 text-sm font-semibold"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        {error ? (
          <p role="alert" className="rounded-lg bg-clay-soft px-4 py-3 text-sm text-clay">
            {error}
          </p>
        ) : null}
        {refreshRun ? <RefreshPanel run={refreshRun} /> : null}
        <div id="content">
          {loading && !ledger ? <p className="text-muted">Loading saved records…</p> : children}
        </div>
      </div>
    </LedgerContext.Provider>
  );
}

function RefreshPanel({ run }: { run: RefreshRun }) {
  const done = run.items.filter((item) => item.status === "ok" || item.status === "failed").length;
  return (
    <section className="rounded-xl border border-line bg-card p-4" aria-live="polite">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg">Refresh</h2>
        <p className="text-sm text-muted">
          {done} of {run.items.length} checked · {run.status}
        </p>
      </div>
      <p className="mt-1 text-sm text-muted">{run.message}</p>
      <ul className="mt-3 grid gap-2">
        {run.items.map((item) => (
          <li key={item.id} className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
            <span className="font-semibold">{item.label}</span>
            <span className={item.status === "failed" ? "text-clay" : "text-muted"}>
              {item.status}
              {item.message ? ` — ${item.message}` : ""}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function SignInPanel() {
  const [mode, setMode] = useState<"in" | "up">("in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submitEmail(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setMessage(null);
    const result =
      mode === "up"
        ? await authClient.signUp.email({ email, password, name: name || email, callbackURL: "/" })
        : await authClient.signIn.email({ email, password, callbackURL: "/" });
    setPending(false);
    if (result.error) setMessage(result.error.message ?? "Sign-in failed.");
  }

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <section className="rounded-xl border border-line bg-card p-5">
        <h2 className="text-2xl">Sign in</h2>
        <p className="mt-2 text-sm text-pretty text-muted">
          This ledger is private. Your subscriptions, card selections, and confirmed spending stay
          on your account.
        </p>
        <div className="mt-4 grid gap-2">
          {GROK_PROVIDERS.map((provider) => (
            <button
              key={provider.providerId}
              type="button"
              className="h-11 rounded-lg border border-line bg-paper px-4 text-sm font-semibold"
              onClick={() => signIn(provider.providerId, { callbackURL: "/" })}
            >
              Continue with {provider.label}
            </button>
          ))}
        </div>
      </section>
      <form onSubmit={submitEmail} className="rounded-xl border border-line bg-card p-5">
        <h2 className="text-2xl">
          {mode === "up" ? "Create the owner account" : "Email and password"}
        </h2>
        <div className="mt-4 grid gap-3">
          {mode === "up" ? (
            <Field label="Name">
              <input
                className={controlClass}
                value={name}
                onChange={(event) => setName(event.target.value)}
                autoComplete="name"
              />
            </Field>
          ) : null}
          <Field label="Email">
            <input
              className={controlClass}
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
            />
          </Field>
          <Field label="Password">
            <input
              className={controlClass}
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete={mode === "up" ? "new-password" : "current-password"}
            />
          </Field>
          {message ? <p className="text-sm text-clay">{message}</p> : null}
          <button
            type="submit"
            disabled={pending}
            className="h-11 rounded-lg bg-forest px-4 font-semibold text-forest-ink disabled:opacity-60"
          >
            {pending ? "Working…" : mode === "up" ? "Create account" : "Sign in"}
          </button>
          <button
            type="button"
            className="h-11 text-sm font-semibold text-forest"
            onClick={() => setMode(mode === "up" ? "in" : "up")}
          >
            {mode === "up" ? "I already have a password" : "Create an email account"}
          </button>
        </div>
      </form>
    </div>
  );
}

export function SourceLine({
  url,
  checkedAt,
  lastSuccessAt,
  failureNote,
}: {
  url: string | null;
  checkedAt: string | null;
  lastSuccessAt: string | null;
  failureNote: string;
}) {
  return (
    <p className="text-xs text-muted">
      {url ? (
        <a
          className="font-semibold text-forest underline-offset-2 hover:underline"
          href={url}
          target="_blank"
          rel="noreferrer"
        >
          Source
        </a>
      ) : (
        "No source saved"
      )}
      {lastSuccessAt
        ? ` · Last success ${lastSuccessAt.slice(0, 16).replace("T", " ")}`
        : " · No successful check"}
      {checkedAt ? ` · Last attempt ${checkedAt.slice(0, 16).replace("T", " ")}` : ""}
      {failureNote ? ` · ${failureNote}` : ""}
    </p>
  );
}

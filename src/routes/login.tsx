import { createFileRoute } from "@tanstack/react-router";
import { AppFrame } from "@/components/benefits/chrome";

export const Route = createFileRoute("/login")({
  component: () => (
    <AppFrame>
      <p className="text-sm text-muted">Sign in to open your ledger.</p>
    </AppFrame>
  ),
});

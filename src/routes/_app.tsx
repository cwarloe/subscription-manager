import { createFileRoute, Outlet } from "@tanstack/react-router";
import { AppFrame } from "@/components/benefits/chrome";

export const Route = createFileRoute("/_app")({
  component: () => (
    <AppFrame>
      <Outlet />
    </AppFrame>
  ),
});

import { createFileRoute } from "@tanstack/react-router";
import { AuthScreen, BootScreen } from "@/components/auth-screen";
import { ClockApp } from "@/components/clock-app";
import { useCurrentUserState } from "@/lib/auth/use-current-user";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  const { user, isPending } = useCurrentUserState();
  if (isPending) return <BootScreen />;
  if (!user) return <AuthScreen />;
  return <ClockApp />;
}

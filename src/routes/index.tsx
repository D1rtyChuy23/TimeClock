import { useEffect } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { AuthScreen, BootScreen } from "@/components/auth-screen";
import { ClockApp } from "@/components/clock-app";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { rememberUser, rememberedUser } from "@/lib/offline";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  const { user, isPending, unreachable } = useCurrentUserState();
  // Remember who is signed in, so a reload with no internet opens the clock instead of sign-in.
  useEffect(() => {
    if (user) rememberUser({ id: user.id, name: user.displayName, email: user.primaryEmail });
    else if (!isPending && !unreachable) rememberUser(null);
  }, [user, isPending, unreachable]);
  if (isPending) return <BootScreen />;
  const who = user?.id ?? (unreachable ? rememberedUser()?.id : undefined);
  if (!who) return <AuthScreen />;
  return <ClockApp key={who} userId={who} />;
}

import { useEffect } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { AuthScreen, BootScreen, OfflineScreen } from "@/components/auth-screen";
import { ClockApp } from "@/components/clock-app";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { sessionState, sessionUserId } from "@/lib/clock-machine";
import { rememberUser, rememberedUser } from "@/lib/offline";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  const { user, isPending, unreachable = false } = useCurrentUserState();
  const userId = user?.id ?? null;
  // Only read when the server can't be reached; a server answer always wins.
  const rememberedId = !isPending && !userId && unreachable ? (rememberedUser()?.id ?? null) : null;
  // Session machine (clock-machine.ts): one state decides which screen shows.
  const state = sessionState({ isPending, userId, unreachable, rememberedId });

  useEffect(() => {
    // Live state for tests and agents, next to the app's own data-status etc.
    document.documentElement.dataset.session = state;
    // Remember who is signed in, so a reload with no internet opens their clock; forget on sign-out.
    if (state === "signed_in" && user) rememberUser({ id: user.id, name: user.displayName, email: user.primaryEmail });
    else if (state === "signed_out") rememberUser(null);
  }, [state, user]);

  if (state === "pending") return <BootScreen />;
  if (state === "offline_unknown") return <OfflineScreen />;
  const who = sessionUserId(state, userId, rememberedId);
  if (!who) return <AuthScreen />;
  return <ClockApp key={who} userId={who} />;
}

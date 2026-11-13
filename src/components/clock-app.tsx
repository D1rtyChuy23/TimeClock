import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from "react";
import {
  CalendarDays,
  CalendarOff,
  ChartColumn,
  ChevronLeft,
  ChevronRight,
  Clock as ClockIcon,
  CloudOff,
  Menu,
  PenLine,
  SlidersHorizontal,
  TreePalm,
  UserPlus,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { INVITE_KEY } from "@/components/auth-screen";
import { SettingsPanel } from "@/components/settings-panel";
import { UserButton } from "@/lib/auth/gates";
import {
  ADMIN_VIEWS,
  PTO_NEXT,
  canPto,
  inviteState,
  nextLoad,
  ptoActions,
  queuedOutcome,
  shiftAction,
  viewFor,
  type LoadStatus,
  type View,
} from "@/lib/clock-machine";
import { federalHolidays, federalOn } from "@/lib/federal-holidays";
import {
  isOffline,
  readQueue,
  readSnapshot,
  saveSnapshot,
  withQueued,
  writeQueue,
  type QueuedPunch,
} from "@/lib/offline";
import { english, errorCopyKey, useI18n, type CopyKey, type Lang } from "@/lib/i18n";
import {
  PTO_DAY_HOURS,
  buildPayReport,
  dayKey,
  payPeriod,
  payPeriodIndex,
  payPeriodOf,
  toCsv,
  type PayReport,
} from "@/lib/pay-period";
import { addDays, daysUntil, fmtHms, fmtHours, hoursIn, ptoUsed, selfCheck, weekStart } from "@/lib/time";
import {
  acceptInvite,
  addHoliday,
  addPunch,
  cancelPto,
  createInvite,
  decidePto,
  loadReport,
  deleteHoliday,
  deletePunch,
  forceOut,
  loadClock,
  removeInvite,
  requestPto,
  setAllowance,
  setRole,
  togglePunch,
  type ClockResult,
  type Holiday,
  type Invite,
  type OffDay,
  type Profile,
  type PtoRequest,
  type ReportData,
  type Punch,
  type Snapshot,
} from "@/lib/timeclock.functions";

function useServerNow(serverNow: string | undefined): Date {
  const base = useRef({ server: Date.now(), local: Date.now() });
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!serverNow) return;
    const server = new Date(serverNow).getTime();
    base.current = { server, local: Date.now() };
    setNow(new Date(server));
    const id = window.setInterval(() => {
      setNow(new Date(base.current.server + (Date.now() - base.current.local)));
    }, 1000);
    return () => window.clearInterval(id);
  }, [serverNow]);
  return now;
}

function locale(lang: Lang): string {
  return lang === "es" ? "es" : "en";
}

function fmtWhen(iso: string, lang: Lang): string {
  return new Date(iso).toLocaleString(locale(lang), {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function fmtTime(iso: string, lang: Lang): string {
  return new Date(iso).toLocaleTimeString(locale(lang), { hour: "numeric", minute: "2-digit" });
}

function fmtDay(day: string, lang: Lang): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1).toLocaleDateString(locale(lang), {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/** "1 day", "2 days", "1.5 days". */
function useFmtDays(): (n: number) => string {
  const { t } = useI18n();
  return (n) => {
    const r = Math.round(n * 10) / 10;
    return r === 1 ? t("dayOne") : t("daysN", { n: Number.isInteger(r) ? String(r) : r.toFixed(1) });
  };
}

function dateInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const field = "mt-1 h-12 w-full rounded-lg border border-line bg-paper px-3 text-base text-ink";
const solid =
  "inline-flex h-11 items-center justify-center rounded-lg bg-pine px-3 text-sm font-semibold text-foam disabled:opacity-60";
const ghost =
  "inline-flex h-11 items-center justify-center rounded-lg border border-line bg-card px-3 text-sm font-medium text-ink disabled:opacity-60";

/** Runs one save. Resolves true when it worked; a save already in flight makes it a no-op (false). */
type Act = (fn: () => Promise<ClockResult>, okKey: CopyKey) => Promise<boolean>;

/** Screen machine (clock-machine.ts) plus the data it shows. `snap` is set once status has been `ready`. */
type Screen = { status: LoadStatus; snap: Snapshot | null };
/** `saved`: the data this device kept from last time (offline.ts), used only if nothing is on screen yet. */
type ScreenEvent = { type: "LOADED"; snap: Snapshot } | { type: "FAILED"; saved?: Snapshot };

function screenReducer(screen: Screen, event: ScreenEvent): Screen {
  if (event.type === "FAILED" && !screen.snap && event.saved) {
    return { status: nextLoad(screen.status, "RESTORED"), snap: event.saved };
  }
  return {
    status: nextLoad(screen.status, event.type),
    snap: event.type === "LOADED" ? event.snap : screen.snap,
  };
}

/** How long a punch waits for the server before it is saved on the device instead. */
const PUNCH_WAIT_MS = 8000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = window.setTimeout(() => reject(new TypeError("network timeout")), ms);
    p.then(
      (v) => {
        window.clearTimeout(id);
        resolve(v);
      },
      (e: unknown) => {
        window.clearTimeout(id);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

export function ClockApp({ userId }: { userId: string }) {
  const { t, lang, setLang } = useI18n();
  const [{ status, snap: serverSnap }, send] = useReducer(screenReducer, { status: "booting", snap: null });
  // Punches tapped with no internet, waiting on this device (offline.ts).
  const [queue, setQueue] = useState<QueuedPunch[]>(() => readQueue(userId));
  // What the screen shows: the server's data plus the queued punches, so the button and hours stay right offline.
  const snap = useMemo(
    () => (serverSnap && queue.length ? { ...serverSnap, punches: withQueued(serverSnap.punches, userId, queue) } : serverSnap),
    [serverSnap, queue, userId],
  );
  // Server clock minus this device's clock, so a queued punch is stamped in server time.
  const offset = useRef(0);
  const [view, setView] = useState<View>("clock");
  const [menuOpen, setMenuOpen] = useState(false);
  // Shared by Calendar and Time off: picking a day on the calendar fills in the request form.
  const [ptoDay, setPtoDay] = useState(() => dateInput(new Date()));
  const [focusDay, setFocusDay] = useState(() => dateInput(new Date()));
  const [busy, setBusy] = useState(false);
  // Refs, because two taps can land before React re-renders with `busy` set.
  const saving = useRef(false);
  // Bumped by every load and save: an answer that is no longer the newest request is dropped,
  // so a slow background refresh can never paint over the result of a save.
  const latest = useRef(0);
  const now = useServerNow(snap?.serverNow);

  const flushRef = useRef<() => Promise<void>>(async () => {});
  const loaded = useCallback((data: Snapshot) => {
    offset.current = Date.parse(data.serverNow) - Date.now();
    saveSnapshot(data, offset.current);
    send({ type: "LOADED", snap: data });
  }, []);

  const reload = useCallback(
    async (opts?: { flush?: boolean }) => {
      if (saving.current) return;
      const ticket = ++latest.current;
      try {
        const data = await loadClock();
        if (ticket !== latest.current) return;
        loaded(data);
        // Back online: send anything that was punched while it was down.
        if (opts?.flush !== false) void flushRef.current();
      } catch {
        if (ticket !== latest.current) return;
        const saved = readSnapshot(userId);
        if (saved) offset.current = saved.offsetMs;
        // Saved data opens with today's time, not the time it was saved.
        const restored = saved ? { ...saved.snap, serverNow: new Date(Date.now() + saved.offsetMs).toISOString() } : undefined;
        send({ type: "FAILED", saved: restored });
      }
    },
    [loaded, userId],
  );

  /** Clock in or out. With no internet the punch is saved here and sent later. */
  const punch = async (action: "in" | "out") => {
    if (saving.current) return;
    const enqueue = () => {
      const item: QueuedPunch = {
        id: typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
        action,
        at: new Date(Date.now() + offset.current).toISOString(),
      };
      const next = [...readQueue(userId), item];
      writeQueue(userId, next);
      setQueue(next);
      toast.success(t("queuedToast"));
    };
    // Earlier punches are still waiting: this one waits behind them, so they arrive in order.
    if (readQueue(userId).length > 0) {
      enqueue();
      void flushRef.current();
      return;
    }
    saving.current = true;
    setBusy(true);
    const ticket = ++latest.current;
    let ok = false;
    try {
      const res = await withTimeout(togglePunch({ data: { targetUserId: "", action } }), PUNCH_WAIT_MS);
      if (res.ok) {
        if (ticket === latest.current) loaded(res.data);
        toast.success(t(action === "in" ? "clockedIn" : "clockedOut"));
        ok = true;
      } else {
        toast.error(t(errorCopyKey(res.error)));
      }
    } catch (e) {
      if (isOffline(e)) {
        // If the slow request did get through after all, the queued copy is dropped as already_in/out.
        enqueue();
        ok = true;
        send({ type: "FAILED" });
      } else {
        toast.error(t("errGeneric"));
      }
    } finally {
      saving.current = false;
      setBusy(false);
    }
    if (!ok) void reload();
  };

  /** Send queued punches oldest first. Stops at the first one that can't get through. */
  flushRef.current = async () => {
    if (saving.current) return;
    let pending = readQueue(userId);
    if (pending.length === 0) {
      if (queue.length) setQueue([]);
      return;
    }
    saving.current = true;
    setBusy(true);
    let sent = 0;
    try {
      while (pending.length > 0) {
        const item = pending[0];
        let res: ClockResult;
        try {
          res = await withTimeout(
            togglePunch({ data: { targetUserId: "", action: item.action, at: item.at } }),
            PUNCH_WAIT_MS,
          );
        } catch {
          break; // still offline, or signed out: try again later
        }
        const outcome = queuedOutcome(res);
        if (outcome === "keep") break;
        if (outcome === "saved") sent += 1;
        if (outcome === "rejected") {
          toast.error(t("queuedRejected", { time: fmtWhen(item.at, lang) }), { duration: 20_000 });
        }
        pending = pending.slice(1);
        writeQueue(userId, pending);
        setQueue(pending);
      }
    } finally {
      saving.current = false;
      setBusy(false);
    }
    if (sent > 0) toast.success(t("queuedSent"));
    void reload({ flush: false });
  };

  useEffect(() => {
    try {
      selfCheck();
    } catch (e) {
      console.error(e);
    }
    void reload();
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") void reload();
    }, 120_000);
    const onVis = () => {
      if (document.visibilityState === "visible") void reload();
    };
    document.addEventListener("visibilitychange", onVis);
    const onOnline = () => void reload();
    window.addEventListener("online", onOnline);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("online", onOnline);
    };
  }, [reload]);

  // While punches are waiting, check for the connection every 20 seconds.
  useEffect(() => {
    if (queue.length === 0) return;
    const id = window.setInterval(() => void reload(), 20_000);
    return () => window.clearInterval(id);
  }, [queue.length, reload]);

  const act: Act = async (fn, okKey) => {
    if (saving.current) return false;
    saving.current = true;
    setBusy(true);
    const ticket = ++latest.current;
    let ok = false;
    try {
      const res = await fn();
      if (res.ok) {
        if (ticket === latest.current) loaded(res.data);
        toast.success(t(okKey));
        ok = true;
      } else {
        toast.error(t(errorCopyKey(res.error)));
      }
    } catch (e) {
      toast.error(t(isOffline(e) ? "staleNotice" : "errGeneric"));
    } finally {
      saving.current = false;
      setBusy(false);
    }
    // A refused save usually means this screen was behind: show what is true now.
    if (!ok) void reload();
    return ok;
  };

  // Someone who arrived through an invitation link claims it once, on their first good load.
  const claimed = useRef(false);
  useEffect(() => {
    if (status !== "ready" || claimed.current) return;
    claimed.current = true;
    let token = "";
    try {
      token = window.sessionStorage.getItem(INVITE_KEY) ?? "";
      window.sessionStorage.removeItem(INVITE_KEY);
    } catch {
      /* storage unavailable: nothing to claim */
    }
    if (token) void act(() => acceptInvite({ data: { token } }), "welcomeInvite");
    // `act` is recreated every render; this runs once, when the first load lands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const onClock = snap ? snap.punches.some((p) => p.userId === snap.me.userId && !p.clockOut) : false;
  const admin = snap?.me.role === "admin";

  // Section machine (clock-machine.ts). The address keeps it as #reports etc.
  // Re-checked whenever the role is known or changes, so a demoted admin lands on the clock.
  useEffect(() => {
    if (!snap) return;
    setView((current) => viewFor(window.location.hash.slice(1) || current, admin));
    // Only the role matters here, not every new snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [admin, snap === null]);
  useEffect(() => {
    const onHash = () => setView(viewFor(window.location.hash.slice(1), admin));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [admin]);
  const go = (next: View) => {
    const to = viewFor(next, admin);
    setView(to);
    setMenuOpen(false);
    window.history.replaceState(null, "", `#${to}`);
    window.scrollTo({ top: 0 });
  };
  const badges: Partial<Record<View, number>> = snap
    ? { team: snap.pto.filter((p) => p.status === "pending").length, invite: (snap.invites ?? []).length }
    : {};

  return (
    <div
      className="min-h-screen pb-16"
      // Live state for tests and agents: wait on these instead of sleeping.
      data-status={status}
      data-busy={busy}
      data-view={view}
      data-role={snap?.me.role}
      data-shift={snap ? (onClock ? "in" : "out") : undefined}
      data-queued={queue.length}
    >
      <header className="sticky top-0 z-20 border-b-4 border-leaf bg-bar text-bar-ink">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          {snap ? (
            <button
              type="button"
              id="menu-btn"
              aria-expanded={menuOpen}
              aria-controls="menu-drawer"
              onClick={() => setMenuOpen(true)}
              className="flex h-11 min-w-0 shrink items-center gap-2 rounded-lg border border-bar-ink/30 px-3 text-sm font-semibold md:hidden"
            >
              <Menu className="size-5 shrink-0" aria-hidden="true" />
              <span className="sr-only">{t("menu")}: </span>
              <span className="truncate">{t(NAV_LABEL[view])}</span>
            </button>
          ) : null}
          <p
            className={
              "flex items-center gap-2 font-display text-2xl font-bold uppercase leading-none tracking-wide whitespace-nowrap sm:text-3xl " +
              (snap ? "hidden md:flex" : "")
            }
          >
            <BrandMark />
            {t("appName")}
          </p>
          <div className="flex shrink-0 items-center gap-2">
            {/* Phones get one switch button so the menu button keeps its label, even with large text. */}
            <button
              type="button"
              id="lang-switch"
              onClick={() => setLang(lang === "en" ? "es" : "en")}
              aria-label={lang === "en" ? "Español" : "English"}
              className="h-11 min-w-11 rounded-lg border border-bar-ink/30 px-3 text-sm font-semibold sm:hidden"
            >
              {lang === "en" ? "ES" : "EN"}
            </button>
            <div role="group" aria-label={t("language")} className="hidden overflow-hidden rounded-lg border border-bar-ink/30 sm:flex">
              {(["en", "es"] as const).map((code) => (
                <button
                  key={code}
                  type="button"
                  aria-pressed={lang === code}
                  onClick={() => setLang(code)}
                  className={
                    "h-11 min-w-11 px-3 text-sm font-semibold " +
                    (lang === code ? "bg-leaf text-leaf-ink" : "text-bar-ink/75 hover:text-bar-ink")
                  }
                >
                  {code.toUpperCase()}
                </button>
              ))}
            </div>
            <div className="account-slot">
              <UserButton labels={{ signOut: t("signOut"), signingOut: t("signingOut") }} />
            </div>
          </div>
        </div>
      </header>

      {snap && menuOpen ? (
        <MenuDrawer onClose={() => setMenuOpen(false)}>
          <SectionNav view={view} admin={admin} badges={badges} onGo={go} />
        </MenuDrawer>
      ) : null}

      <div className="mx-auto flex w-full max-w-6xl gap-6 px-4">
        {snap ? (
          <aside className="sticky top-[76px] hidden w-60 shrink-0 self-start pt-4 md:block" aria-label={t("sections")}>
            <SectionNav view={view} admin={admin} badges={badges} onGo={go} />
          </aside>
        ) : null}
        <main className="w-full min-w-0 max-w-3xl flex-1 pt-4">
          {status === "booting" ? <p className="text-muted">{t("boot")}</p> : null}
          {status === "failed" ? (
            <div className="panel p-4 sm:p-6" role="alert">
              <p>{t("loadError")}</p>
              <button type="button" className={"mt-3 " + solid} onClick={() => void reload()}>
                {t("retry")}
              </button>
            </div>
          ) : null}
          {queue.length > 0 ? (
            <div
              id="queued-notice"
              className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-paper-2 px-3 py-2"
              role="status"
            >
              <p className="flex items-center gap-2 text-sm font-medium">
                <CloudOff className="size-4 shrink-0" aria-hidden="true" />
                {queue.length === 1 ? t("queuedNotice1") : t("queuedNoticeN", { n: queue.length })}
              </p>
              <button type="button" className={ghost} disabled={busy} onClick={() => void reload()}>
                {t("sendNow")}
              </button>
            </div>
          ) : status === "stale" ? (
            <div
              className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-paper-2 px-3 py-2"
              role="status"
            >
              <p className="text-sm font-medium">{t("staleNotice")}</p>
              <button type="button" className={ghost} onClick={() => void reload()}>
                {t("retry")}
              </button>
            </div>
          ) : null}
          {snap ? (
            view === "timeoff" ? (
              <PtoPanel snap={snap} now={now} busy={busy} act={act} day={ptoDay} setDay={setPtoDay} />
            ) : view === "calendar" ? (
              <TeamCalendar
                snap={snap}
                now={now}
                busy={busy}
                act={act}
                focusDay={focusDay}
                onPick={(day) => {
                  setFocusDay(day);
                  setPtoDay(day);
                }}
                onRequest={(day) => {
                  setPtoDay(day);
                  go("timeoff");
                }}
              />
            ) : view === "settings" ? (
              <SettingsPanel />
            ) : view === "daysoff" ? (
              <DaysOffPanel snap={snap} now={now} busy={busy} act={act} />
            ) : view === "team" && admin ? (
              <TeamPanel snap={snap} now={now} busy={busy} act={act} />
            ) : view === "invite" && admin ? (
              <InvitePanel snap={snap} now={now} busy={busy} act={act} />
            ) : view === "reports" && admin ? (
              <ReportsPanel now={now} />
            ) : (
              <Mine snap={snap} now={now} busy={busy} onPunch={(action) => void punch(action)} />
            )
          ) : null}
        </main>
      </div>
    </div>
  );
}

const NAV_LABEL: Record<View, CopyKey> = {
  clock: "navClock",
  timeoff: "navTimeOff",
  settings: "navSettings",
  calendar: "navCalendar",
  daysoff: "navDaysOff",
  team: "navTeam",
  invite: "navInvite",
  reports: "navReports",
};
const NAV_ICON: Record<View, LucideIcon> = {
  clock: ClockIcon,
  timeoff: TreePalm,
  settings: SlidersHorizontal,
  calendar: CalendarDays,
  daysoff: CalendarOff,
  team: Users,
  invite: UserPlus,
  reports: ChartColumn,
};
const NAV_GROUPS: Array<{ label: CopyKey; views: View[] }> = [
  { label: "groupYou", views: ["clock", "timeoff", "settings"] },
  { label: "groupEveryone", views: ["calendar", "daysoff"] },
  { label: "groupAdmin", views: ["team", "invite", "reports"] },
];

function BrandMark() {
  return (
    <svg viewBox="0 0 32 32" className="size-8 shrink-0" aria-hidden="true">
      <rect width="32" height="32" rx="8" className="fill-leaf" />
      <circle cx="16" cy="16" r="8" fill="none" strokeWidth="2" className="stroke-leaf-ink" />
      <path d="M16 11.5V16l3 2" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="stroke-leaf-ink" />
    </svg>
  );
}

/** The side menu. The same list sits in the left column on wide screens and in the drawer on phones. */
function SectionNav({
  view,
  admin,
  badges,
  onGo,
}: {
  view: View;
  admin: boolean;
  badges: Partial<Record<View, number>>;
  onGo: (view: View) => void;
}) {
  const { t } = useI18n();
  return (
    <nav aria-label={t("sections")} className="space-y-5">
      {NAV_GROUPS.filter((g) => admin || !g.views.some((v) => ADMIN_VIEWS.has(v))).map((group) => (
        <div key={group.label}>
          <p className="px-3 pb-1 text-xs font-medium text-muted">{t(group.label)}</p>
          <ul className="space-y-1">
            {group.views.map((v) => {
              const Icon = NAV_ICON[v];
              const here = v === view;
              const n = badges[v] ?? 0;
              return (
                <li key={v}>
                  <a
                    href={`#${v}`}
                    data-nav={v}
                    aria-current={here ? "page" : undefined}
                    onClick={(e) => {
                      e.preventDefault();
                      onGo(v);
                    }}
                    className={
                      "flex h-11 items-center gap-3 rounded-lg px-3 text-sm font-semibold " +
                      (here ? "bg-leaf text-leaf-ink" : "text-ink hover:bg-paper-2")
                    }
                  >
                    <Icon className="size-5 shrink-0" aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate">{t(NAV_LABEL[v])}</span>
                    {n > 0 ? (
                      <span
                        className={
                          "rounded-full px-2 text-xs font-bold tabular-nums " +
                          (here ? "bg-leaf-ink text-leaf" : "bg-pine text-foam")
                        }
                      >
                        {n}
                      </span>
                    ) : null}
                  </a>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

/** Slide-in panel for the menu on phones. Closes on a choice, the close button, the backdrop or Escape. */
function MenuDrawer({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  const { t } = useI18n();
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    panel.current?.querySelector<HTMLElement>("[aria-current=page], a")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      opener?.focus();
    };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true" aria-label={t("sections")} id="menu-drawer">
      <button type="button" tabIndex={-1} aria-hidden="true" className="absolute inset-0 bg-ink/40" onClick={onClose} />
      <div
        ref={panel}
        className="absolute inset-y-0 left-0 w-72 max-w-[85%] overflow-y-auto border-r-4 border-leaf bg-paper px-3 pb-6 shadow-xl"
        style={{ paddingTop: "max(12px, env(safe-area-inset-top, 0px))" }}
      >
        <div className="mb-4 flex items-center justify-between gap-2 px-1">
          <p className="flex items-center gap-2 font-display text-2xl font-bold uppercase leading-none tracking-wide">
            <BrandMark />
            {t("appName")}
          </p>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("closeMenu")}
            className="grid size-11 place-items-center rounded-lg border border-line bg-card"
          >
            <X className="size-5" aria-hidden="true" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Mine({
  snap,
  now,
  busy,
  onPunch,
}: {
  snap: Snapshot;
  now: Date;
  busy: boolean;
  onPunch: (action: "in" | "out") => void;
}) {
  const { t, lang } = useI18n();
  const mine = snap.punches.filter((p) => p.userId === snap.me.userId);
  const open = mine.find((p) => !p.clockOut) ?? null;
  const today0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const week0 = weekStart(now);
  const todayH = hoursIn(mine, today0, addDays(today0, 1), now);
  const weekH = hoursIn(mine, week0, addDays(week0, 7), now);
  const myPto = snap.pto.filter((p) => p.userId === snap.me.userId);
  const used = ptoUsed(myPto, now.getFullYear());
  const daysLeft = (snap.me.ptoAllowance - used) / PTO_DAY_HOURS;
  const period = payPeriodOf(now);
  const periodPto = myPto
    .filter((p) => p.status === "approved" && p.day >= period.firstDay && p.day <= period.lastDay)
    .reduce((sum, p) => sum + p.hours, 0);
  const periodH = hoursIn(mine, period.start, period.end, now) + periodPto;
  const recent = mine.slice(0, 10);

  return (
    <div className="space-y-4">
      <HolidayBanner holidays={snap.holidays} now={now} />
      <section className="panel overflow-hidden" id="timecard">
        <div className="p-4 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
            <p className={"flex items-center gap-2 text-sm font-semibold " + (open ? "text-leaf-text" : "text-muted")}>
              <span
                className={"size-2.5 shrink-0 rounded-full " + (open ? "live-dot bg-leaf-text text-leaf-text" : "bg-muted")}
                aria-hidden="true"
              />
              {open ? t("working") : t("notWorking")}
              {open ? <span className="font-medium text-muted">{t("since", { time: fmtTime(open.clockIn, lang) })}</span> : null}
            </p>
            <p className="text-sm text-muted">
              {now.toLocaleDateString(locale(lang), { weekday: "long", month: "long", day: "numeric" })}
            </p>
          </div>
          {/* The punch clock face: the time that will be stamped. */}
          <p className="mt-3 font-display text-7xl font-bold leading-none tracking-tight tabular-nums sm:text-8xl" id="clock-face">
            {new Intl.DateTimeFormat(locale(lang), { hour: "numeric", minute: "2-digit" }).formatToParts(now).map((part, n) =>
              part.type === "dayPeriod" ? (
                <span key={n} className="ml-1 align-top text-3xl font-semibold text-muted sm:text-4xl">
                  {part.value.trim()}
                </span>
              ) : part.type === "literal" && /^\s+$/.test(part.value) ? null : (
                <span key={n}>{part.value}</span>
              ),
            )}
          </p>
          <button
            id="clock-btn"
            type="button"
            disabled={busy}
            aria-busy={busy}
            onClick={() => onPunch(shiftAction(!!open))}
            className={
              "mt-5 flex min-h-28 w-full flex-col items-center justify-center rounded-2xl px-4 py-5 " +
              "shadow-[inset_0_-6px_0_rgb(0_0_0/0.18)] transition-transform active:translate-y-0.5 active:shadow-[inset_0_-2px_0_rgb(0_0_0/0.18)] disabled:opacity-60 " +
              (open ? "bg-pine text-foam" : "bg-leaf text-leaf-ink")
            }
          >
            <span className="font-display text-5xl font-bold uppercase leading-none tracking-wide">
              {open ? t("clockOut") : t("clockIn")}
            </span>
            {open ? (
              <span className="mt-2 text-sm font-semibold tabular-nums opacity-90">
                {fmtHms(now.getTime() - new Date(open.clockIn).getTime())} · {t("elapsed")}
              </span>
            ) : null}
          </button>
        </div>
        <dl className="grid grid-cols-3 border-t border-dashed border-line">
          {(
            [
              ["today", todayH],
              ["thisWeek", weekH],
              ["payPeriod", periodH],
            ] as const
          ).map(([key, value], n) => (
            <div key={key} className={"px-2 py-3 text-center " + (n > 0 ? "border-l border-dashed border-line" : "")}>
              <dt className="text-xs font-semibold text-muted">{t(key)}</dt>
              <dd className="mt-0.5 flex flex-wrap items-baseline justify-center gap-x-1">
                <span className="font-display text-3xl font-bold tabular-nums">{fmtHours(value)}</span>
                <span className="text-xs font-medium text-muted">{t("hours")}</span>
              </dd>
            </div>
          ))}
        </dl>
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t border-dashed border-line px-4 py-3 text-sm sm:px-6">
          <p className="text-muted" id="pay-period-note">
            {t("weekNote", { from: fmtDay(period.firstDay, lang), to: fmtDay(period.lastDay, lang) })}
          </p>
          <p className="font-semibold" id="pto-days-left">
            {t("ptoLeft")}: {Math.round(daysLeft * 10) / 10}
          </p>
        </div>
      </section>

      <section className="panel p-4 sm:p-6">
        <h2 className="font-display text-[1.75rem] font-bold leading-tight">{t("shifts")}</h2>
        {recent.length === 0 ? <p className="mt-2 text-sm text-muted">{t("noShifts")}</p> : null}
        <ul className="ruled mt-2">
          {recent.map((p) => (
            <ShiftRow key={p.id} punch={p} now={now} lang={lang} />
          ))}
        </ul>
      </section>
    </div>
  );
}

function ShiftRow({ punch, now, lang }: { punch: Punch; now: Date; lang: Lang }) {
  const { t } = useI18n();
  const end = punch.clockOut ? new Date(punch.clockOut) : now;
  const hours = Math.max(0, (end.getTime() - new Date(punch.clockIn).getTime()) / 3_600_000);
  return (
    <li className="flex items-start justify-between gap-3 py-3">
      <div className="min-w-0">
        <p className="text-sm font-medium">
          {fmtWhen(punch.clockIn, lang)}
          {" – "}
          {punch.clockOut ? fmtWhen(punch.clockOut, lang) : t("openShift")}
        </p>
        {punch.manual ? (
          <p className="mt-1 flex items-center gap-1 text-xs text-muted">
            <PenLine className="size-3.5" aria-hidden="true" />
            {t("manual")}
          </p>
        ) : null}
        {punch.pending || punch.late ? (
          <p className="mt-1 flex items-center gap-1 text-xs text-muted" data-punch={punch.pending ? "pending" : "late"}>
            <CloudOff className="size-3.5" aria-hidden="true" />
            {punch.pending ? t("waitingToSend") : t("sentLate")}
          </p>
        ) : null}
      </div>
      <p className="shrink-0 font-display text-2xl tabular-nums">{fmtHours(hours)}</p>
    </li>
  );
}

/** A closure's name. Federal holidays switched on from the list are saved in English and shown translated. */
function useHolidayName(): (h: Holiday) => string {
  const { t } = useI18n();
  return (h) => {
    const fed = federalOn(h.day);
    return fed && h.name === english(`fed_${fed.key}`) ? t(`fed_${fed.key}`) : h.name;
  };
}

function HolidayBanner({ holidays, now }: { holidays: Holiday[]; now: Date }) {
  const { t } = useI18n();
  const nameOf = useHolidayName();
  const todays = holidays.filter((h) => daysUntil(h.day, now) === 0);
  if (todays.length > 0) {
    return (
      <p className="flex items-start gap-2 rounded-2xl bg-paper-2 px-4 py-3 text-sm font-semibold text-ink" role="status">
        <CalendarOff className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        {t("todayOff", { name: todays.map(nameOf).join(" · ") })}
      </p>
    );
  }
  const next = holidays
    .map((h) => ({ h, n: daysUntil(h.day, now) }))
    .filter((x) => x.n > 0)
    .sort((a, b) => a.n - b.n)[0];
  if (!next) return null;
  const name = nameOf(next.h);
  const text = next.n === 1 ? t("nextOff1", { name }) : t("nextOff", { name, n: next.n });
  return (
    <p className="flex items-start gap-2 rounded-2xl bg-paper-2 px-4 py-3 text-sm font-semibold text-ink" role="status">
      <CalendarOff className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      {text}
    </p>
  );
}

/** May the person who asked for this day off still cancel it? (Time-off machine, clock-machine.ts.) */
function canCancelOwn(status: PtoRequest["status"], day: string, now: Date): boolean {
  return canPto("cancel", status, { owner: true, admin: false, daysUntil: daysUntil(day, now) });
}

function PtoPanel({
  snap,
  now,
  busy,
  act,
  day,
  setDay,
}: {
  snap: Snapshot;
  now: Date;
  busy: boolean;
  act: Act;
  day: string;
  setDay: (day: string) => void;
}) {
  const { t, lang } = useI18n();
  const [note, setNote] = useState("");
  const fmtDays = useFmtDays();
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const rows = snap.pto
    .filter((p) => p.userId === snap.me.userId)
    .slice()
    .sort((a, b) => a.day.localeCompare(b.day) || b.id - a.id);

  return (
    <section id="pto-request" className="panel p-4 sm:p-6">
      <h2 className="font-display text-[1.75rem] font-bold leading-tight">{t("ptoTitle")}</h2>
      <p className="mt-1 text-sm text-pretty text-muted">{t("ptoLead")}</p>
      <form
        className="mt-3 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void act(() => requestPto({ data: { day, note } }), "sent").then((ok) => {
            if (ok) setNote("");
          });
        }}
      >
        <label className="block text-sm font-medium">
          {t("day")}
          <input id="pto-day" type="date" required value={day} onChange={(e) => setDay(e.target.value)} className={field} />
          <span className="mt-1 block text-xs font-normal text-muted">{t("ptoDayNote")}</span>
        </label>
        <label className="block text-sm font-medium">
          {t("note")}
          <input
            id="pto-note"
            maxLength={200}
            value={note}
            placeholder={t("notePh")}
            onChange={(e) => setNote(e.target.value)}
            className={field}
          />
        </label>
        <button type="submit" disabled={busy} className={solid + " w-full"}>
          {t("send")}
        </button>
      </form>

      <h3 className="mt-5 text-sm font-semibold text-muted">{t("myRequests")}</h3>
      <p className="mt-1 text-sm text-muted">{t("hoursBack")}</p>
      {rows.length === 0 ? <p className="mt-3 text-sm text-muted">{t("noPto")}</p> : null}
      <ul className="mt-2 divide-y divide-line">
        {rows.map((r) => {
          const cancellable = canCancelOwn(r.status, r.day, now);
          return (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {fmtDay(r.day, lang)} · {fmtDays(r.hours / PTO_DAY_HOURS)}
                </p>
                <p className="text-xs font-medium text-muted">{t(r.status)}</p>
                {r.note ? <p className="mt-1 text-sm text-pretty text-ink">{r.note}</p> : null}
              </div>
              {cancellable ? (
                confirmId === r.id ? (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className={solid}
                      disabled={busy}
                      onClick={() =>
                        void act(() => cancelPto({ data: { id: r.id } }), "removed").then(() => setConfirmId(null))
                      }
                    >
                      {t("confirmCancel")}
                    </button>
                    <button type="button" className={ghost} onClick={() => setConfirmId(null)}>
                      {t("keep")}
                    </button>
                  </div>
                ) : (
                  <button type="button" className={ghost} disabled={busy} onClick={() => setConfirmId(r.id)}>
                    {t("cancelRequest")}
                  </button>
                )
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function ymd(year: number, monthIndex: number, day: number): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${year}-${p(monthIndex + 1)}-${p(day)}`;
}

function monthCells(year: number, monthIndex: number): Array<number | null> {
  const pad = (new Date(year, monthIndex, 1).getDay() + 6) % 7;
  const count = new Date(year, monthIndex + 1, 0).getDate();
  const cells: Array<number | null> = Array.from({ length: pad }, () => null);
  for (let d = 1; d <= count; d += 1) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

function TeamCalendar({
  snap,
  now,
  busy,
  act,
  focusDay,
  onPick,
  onRequest,
}: {
  snap: Snapshot;
  now: Date;
  busy: boolean;
  act: Act;
  focusDay: string;
  onPick: (day: string) => void;
  /** "Request this day": opens Time off with the day filled in. */
  onRequest: (day: string) => void;
}) {
  const { t, lang } = useI18n();
  const [cursor, setCursor] = useState(() => new Date(now.getFullYear(), now.getMonth(), 1));
  const [confirmHoliday, setConfirmHoliday] = useState<string | null>(null);
  const [confirmPto, setConfirmPto] = useState<number | null>(null);
  const year = cursor.getFullYear();
  const monthIndex = cursor.getMonth();
  const cells = monthCells(year, monthIndex);
  const locale = lang === "es" ? "es" : "en";
  const monthLabel = cursor.toLocaleDateString(locale, { month: "long", year: "numeric" });
  const weekday = Array.from({ length: 7 }, (_, i) =>
    new Date(2026, 10, 2 + i).toLocaleDateString(locale, { weekday: "narrow" }),
  );
  const todayKey = dateInput(now);
  const admin = snap.me.role === "admin";
  const offDays = snap.offDays ?? [];
  const focusHoliday = snap.holidays.filter((h) => h.day === focusDay);
  const focusOff = offDays.filter((d) => d.day === focusDay);
  const focusPending = snap.pto.filter(
    (p) => p.userId === snap.me.userId && p.status === "pending" && p.day === focusDay,
  );
  const nameOf = useHolidayName();
  const isClosed = (day: string) => snap.holidays.some((h) => h.day === day);
  const federal = federalHolidays(year);
  // A federal holiday the shop has not been closed for: shown, but it is a normal work day.
  const focusFederal = federalOn(focusDay);
  const focusFederalOpen = focusFederal && !isClosed(focusDay) ? focusFederal : null;

  return (
    <section className="panel p-4 sm:p-6">
      <h2 className="font-display text-[1.75rem] font-bold leading-tight">{t("calendarTitle")}</h2>
      <p className="mt-1 text-sm text-pretty text-muted">{t("calLead")}</p>

      <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
        <Legend swatch="bg-pine" label={t("legendClosed")} />
        <Legend swatch="bg-leaf" label={t("legendYou")} />
        <Legend swatch="bg-muted" label={t("legendOthers")} />
        <Legend swatch="border border-pine bg-card" label={t("legendPending")} />
        <Legend swatch="rounded-sm border border-muted bg-card" label={t("legendFederal")} />
      </div>

      <div className="mt-3 flex items-center justify-between gap-2">
        <button
          type="button"
          aria-label={t("prevMonth")}
          className="grid size-11 place-items-center rounded-lg border border-line bg-paper"
          onClick={() => setCursor(new Date(year, monthIndex - 1, 1))}
        >
          <ChevronLeft className="size-5" aria-hidden="true" />
        </button>
        <p className="font-display text-[1.75rem] font-bold leading-tight">{monthLabel}</p>
        <button
          type="button"
          aria-label={t("nextMonth")}
          className="grid size-11 place-items-center rounded-lg border border-line bg-paper"
          onClick={() => setCursor(new Date(year, monthIndex + 1, 1))}
        >
          <ChevronRight className="size-5" aria-hidden="true" />
        </button>
      </div>

      <div className="mt-2 grid grid-cols-7 gap-1 text-center text-xs font-semibold uppercase text-muted">
        {weekday.map((label, i) => (
          <div key={`${label}-${i}`}>{label}</div>
        ))}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1">
        {cells.map((day, i) => {
          if (!day) return <div key={`e-${i}`} />;
          const key = ymd(year, monthIndex, day);
          const holiday = snap.holidays.some((h) => h.day === key);
          const offs = offDays.filter((d) => d.day === key);
          const mineApproved = offs.some((d) => d.userId === snap.me.userId);
          const others = offs.some((d) => d.userId !== snap.me.userId);
          const pending = snap.pto.some(
            (p) => p.userId === snap.me.userId && p.status === "pending" && p.day === key,
          );
          const selected = focusDay === key;
          return (
            <button
              key={key}
              type="button"
              aria-pressed={selected}
              onClick={() => onPick(key)}
              className={
                "flex min-h-11 flex-col items-center justify-center rounded-lg px-0.5 py-1 " +
                (selected ? "bg-paper-2 " : "bg-paper ") +
                (key === todayKey ? "ring-2 ring-pine" : "")
              }
            >
              <span className="text-sm tabular-nums leading-none">{day}</span>
              <span className="mt-1 flex h-1.5 gap-0.5">
                {holiday ? <span className="size-1.5 rounded-sm bg-pine" /> : null}
                {!holiday && federal.some((f) => f.day === key) ? (
                  <span className="size-1.5 rounded-sm border border-muted" />
                ) : null}
                {mineApproved ? <span className="size-1.5 rounded-full bg-leaf" /> : null}
                {others ? <span className="size-1.5 rounded-full bg-muted" /> : null}
                {pending ? <span className="size-1.5 rounded-full border border-pine" /> : null}
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-4 rounded-xl border border-line bg-paper p-3">
        <p className="text-xs font-semibold text-muted">{t("thisDay")}</p>
        <p className="mt-1 font-medium">{fmtDay(focusDay, lang)}</p>
        {focusHoliday.length === 0 && focusOff.length === 0 && focusPending.length === 0 && !focusFederalOpen ? (
          <p className="mt-2 text-sm text-muted">{t("nothingDay")}</p>
        ) : null}
        <ul className="mt-2 space-y-2">
          {focusHoliday.map((h) => (
            <li key={h.day} className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium">
                {t("legendClosed")} · {nameOf(h)}
              </p>
              {admin ? (
                confirmHoliday === h.day ? (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className={solid}
                      disabled={busy}
                      onClick={() =>
                        void act(() => deleteHoliday({ data: { day: h.day } }), "removed").then(() =>
                          setConfirmHoliday(null),
                        )
                      }
                    >
                      {t("yesDelete")}
                    </button>
                    <button type="button" className={ghost} onClick={() => setConfirmHoliday(null)}>
                      {t("keep")}
                    </button>
                  </div>
                ) : (
                  <button type="button" className={ghost} onClick={() => setConfirmHoliday(h.day)}>
                    {t("delete")}
                  </button>
                )
              ) : null}
            </li>
          ))}
          {focusFederalOpen ? (
            <li className="text-sm">
              {t(`fed_${focusFederalOpen.key}`)} · {t("weAreOpen")}
            </li>
          ) : null}
          {focusOff.map((d) => (
            <OffRow
              key={d.id}
              day={d}
              mine={d.userId === snap.me.userId}
              now={now}
              busy={busy}
              confirm={confirmPto === d.id}
              onAsk={() => setConfirmPto(d.id)}
              onKeep={() => setConfirmPto(null)}
              onCancel={() => void act(() => cancelPto({ data: { id: d.id } }), "removed").then(() => setConfirmPto(null))}
            />
          ))}
          {focusPending.map((p) => (
            <li key={`p-${p.id}`} className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm">
                {t("you")} · {fmtHours(p.hours)} {t("hours")} · {t("pending")}
              </p>
              <button type="button" className={ghost} disabled={busy} onClick={() => setConfirmPto(p.id)}>
                {t("cancelRequest")}
              </button>
            </li>
          ))}
        </ul>
        {confirmPto !== null && focusPending.some((p) => p.id === confirmPto) ? (
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              className={solid}
              disabled={busy}
              onClick={() =>
                void act(() => cancelPto({ data: { id: confirmPto } }), "removed").then(() => setConfirmPto(null))
              }
            >
              {t("confirmCancel")}
            </button>
            <button type="button" className={ghost} onClick={() => setConfirmPto(null)}>
              {t("keep")}
            </button>
          </div>
        ) : null}
        <button
          type="button"
          className={solid + " mt-3 w-full"}
          onClick={() => onRequest(focusDay)}
        >
          {t("requestThisDay")}
        </button>
      </div>

    </section>
  );
}

/** Every day the shop is closed, in one list, plus the federal holiday switches and the form to add a day. */
function DaysOffPanel({ snap, now, busy, act }: { snap: Snapshot; now: Date; busy: boolean; act: Act }) {
  const { t, lang } = useI18n();
  const nameOf = useHolidayName();
  const admin = snap.me.role === "admin";
  const today = dateInput(now);
  const upcoming = snap.holidays.filter((h) => h.day >= today);
  const past = snap.holidays.filter((h) => h.day < today).reverse();
  const [confirm, setConfirm] = useState<string | null>(null);
  const [year, setYear] = useState(now.getFullYear());
  const [day, setDay] = useState(today);
  const [name, setName] = useState("");
  const isClosed = (d: string) => snap.holidays.some((h) => h.day === d);
  const longDay = (d: string) =>
    new Date(d + "T12:00:00").toLocaleDateString(locale(lang), {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  const when = (d: string) => {
    const n = daysUntil(d, now);
    return n === 0 ? t("whenToday") : n === 1 ? t("whenTomorrow") : t("whenInDays", { n });
  };

  const row = (h: Holiday, upcomingRow: boolean) => (
    <li key={h.day} className="flex flex-wrap items-center justify-between gap-3 py-3" data-day-off={h.day}>
      <div className="min-w-0">
        <p className="font-medium">{nameOf(h)}</p>
        <p className="text-sm text-muted">
          {longDay(h.day)}
          {upcomingRow ? ` · ${when(h.day)}` : ""}
        </p>
      </div>
      {admin ? (
        confirm === h.day ? (
          <div className="flex gap-2">
            <button
              type="button"
              className={solid}
              disabled={busy}
              onClick={() => void act(() => deleteHoliday({ data: { day: h.day } }), "removed").then(() => setConfirm(null))}
            >
              {t("delete")}
            </button>
            <button type="button" className={ghost} onClick={() => setConfirm(null)}>
              {t("keep")}
            </button>
          </div>
        ) : (
          <button type="button" className={ghost} disabled={busy} onClick={() => setConfirm(h.day)}>
            {t("remove")}
          </button>
        )
      ) : null}
    </li>
  );

  return (
    <div className="space-y-4">
      <section className="panel p-4 sm:p-6" id="days-off">
        <h2 className="font-display text-[1.75rem] font-bold leading-tight">{t("daysOffTitle")}</h2>
        <p className="mt-1 text-sm text-pretty text-muted">{admin ? t("daysOffLeadAdmin") : t("daysOffLead")}</p>
        {upcoming.length === 0 ? <p className="mt-3 text-sm text-muted">{t("daysOffNone")}</p> : null}
        <ul className="mt-2 divide-y divide-line">{upcoming.map((h) => row(h, true))}</ul>
        {past.length > 0 ? (
          <details className="mt-3 border-t border-line pt-3">
            <summary className="cursor-pointer text-sm font-medium text-muted">{t("pastDaysOff", { n: past.length })}</summary>
            <ul className="mt-1 divide-y divide-line">{past.map((h) => row(h, false))}</ul>
          </details>
        ) : null}
      </section>

      {admin ? (
        <form
          id="add-day-off"
          className="panel space-y-3 p-4 sm:p-6"
          onSubmit={(e) => {
            e.preventDefault();
            void act(() => addHoliday({ data: { day, name } }), "saved").then((ok) => {
              if (ok) setName("");
            });
          }}
        >
          <h2 className="font-display text-[1.75rem] font-bold leading-tight">{t("addDayOffTitle")}</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm font-medium">
              {t("dayOffDate")}
              <input id="day-off-date" type="date" required value={day} onChange={(e) => setDay(e.target.value)} className={field} />
            </label>
            <label className="block text-sm font-medium">
              {t("holidayName")}
              <input
                id="holiday-name"
                required
                maxLength={60}
                value={name}
                placeholder={t("holidayPh")}
                onChange={(e) => setName(e.target.value)}
                className={field}
              />
            </label>
          </div>
          <button type="submit" disabled={busy} className={solid}>
            {t("save")}
          </button>
        </form>
      ) : null}

      <section className="panel p-4 sm:p-6" id="federal-holidays">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-display text-[1.75rem] font-bold leading-tight">{t("federalTitle", { year })}</h2>
          <div className="flex shrink-0 gap-2">
            <button type="button" aria-label={t("prevYear")} className={ghost + " w-11 px-0"} onClick={() => setYear((y) => y - 1)}>
              <ChevronLeft className="size-5" aria-hidden="true" />
            </button>
            <button type="button" aria-label={t("nextYear")} className={ghost + " w-11 px-0"} onClick={() => setYear((y) => y + 1)}>
              <ChevronRight className="size-5" aria-hidden="true" />
            </button>
          </div>
        </div>
        <p className="mt-1 text-sm text-muted">{admin ? t("federalLeadAdmin") : t("federalLead")}</p>
        <ul className="mt-2 divide-y divide-line">
          {federalHolidays(year).map((f) => {
            const closed = isClosed(f.day);
            const label = closed ? t("weAreOff") : t("weAreOpen");
            return (
              <li key={f.key} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{t(`fed_${f.key}`)}</p>
                  <p className="text-xs text-muted">{fmtDay(f.day, lang)}</p>
                </div>
                {admin ? (
                  // The switch is the federal-day machine: open <-> off. Off is an ordinary closure row.
                  <button
                    type="button"
                    role="switch"
                    aria-checked={closed}
                    aria-label={`${t(`fed_${f.key}`)}: ${label}`}
                    data-federal={f.key}
                    disabled={busy}
                    onClick={() =>
                      void act(
                        () =>
                          closed
                            ? deleteHoliday({ data: { day: f.day } })
                            : addHoliday({ data: { day: f.day, name: english(`fed_${f.key}`) } }),
                        "saved",
                      )
                    }
                    className={
                      "flex h-11 w-24 shrink-0 items-center gap-2 rounded-full border px-1.5 text-sm font-semibold disabled:opacity-60 " +
                      (closed ? "flex-row-reverse border-pine bg-pine text-foam" : "border-line bg-paper text-muted")
                    }
                  >
                    <span className={"size-7 rounded-full " + (closed ? "bg-foam" : "bg-muted")} aria-hidden="true" />
                    <span className="flex-1 text-center">{label}</span>
                  </button>
                ) : (
                  <span className={"shrink-0 text-sm font-semibold " + (closed ? "text-ink" : "text-muted")}>{label}</span>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

function Legend({ swatch, label }: { swatch: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`size-2.5 rounded-full ${swatch}`} />
      {label}
    </span>
  );
}

function OffRow({
  day,
  mine,
  now,
  busy,
  confirm,
  onAsk,
  onKeep,
  onCancel,
}: {
  day: OffDay;
  mine: boolean;
  now: Date;
  busy: boolean;
  confirm: boolean;
  onAsk: () => void;
  onKeep: () => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const name = mine ? t("you") : day.fullName || "—";
  return (
    <li className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-sm">
        {name} · {fmtHours(day.hours)} {t("hours")}
      </p>
      {mine && canCancelOwn("approved", day.day, now) ? (
        confirm ? (
          <div className="flex gap-2">
            <button type="button" className={solid} disabled={busy} onClick={onCancel}>
              {t("confirmCancel")}
            </button>
            <button type="button" className={ghost} onClick={onKeep}>
              {t("keep")}
            </button>
          </div>
        ) : (
          <button type="button" className={ghost} disabled={busy} onClick={onAsk}>
            {t("cancelRequest")}
          </button>
        )
      ) : null}
    </li>
  );
}


function TeamPanel({
  snap,
  now,
  busy,
  act,
}: {
  snap: Snapshot;
  now: Date;
  busy: boolean;
  act: Act;
}) {
  const { t } = useI18n();
  const openIds = new Set(snap.punches.filter((p) => !p.clockOut).map((p) => p.userId));
  const pending = snap.pto.filter((p) => p.status === "pending").length;
  const people = [...snap.people].sort((a, b) => {
    const ao = openIds.has(a.userId) ? 0 : 1;
    const bo = openIds.has(b.userId) ? 0 : 1;
    if (ao !== bo) return ao - bo;
    return (a.fullName || a.email).localeCompare(b.fullName || b.email);
  });

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium text-muted">
        {t("onClockCount", { n: openIds.size })}
        {" · "}
        {t("pendingCount", { n: pending })}
      </p>
      {people.length <= 1 ? <p className="text-sm text-muted">{t("emptyTeam")}</p> : null}
      {people.map((person) => (
        <PersonCard key={person.userId} person={person} snap={snap} now={now} busy={busy} act={act} />
      ))}
    </div>
  );
}

/** A `mailto:` link with the invitation written out, in English and Spanish like the emails the server sends. */
function inviteMailto(to: string, link: string): string {
  const subject = "You're invited to the Time Clock / Te invitaron al Reloj";
  const body =
    `You're invited to the team Time Clock. Open this link to create your account:\n\n${link}\n\n` +
    `Te invitaron al Reloj del equipo. Abre este enlace para crear tu cuenta:\n\n${link}\n`;
  return `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

type ReportState =
  | { status: "loading"; index: number }
  | { status: "failed"; index: number }
  | { status: "ready"; index: number; report: PayReport; data: ReportData };

/** Pay-period report for admins: hours per person, PTO at 8 hours a day, missed punches, CSV downloads. */
function ReportsPanel({ now }: { now: Date }) {
  const { t, lang } = useI18n();
  const fmtDays = useFmtDays();
  const current = payPeriodIndex(now);
  const [index, setIndex] = useState(current);
  const [state, setState] = useState<ReportState>({ status: "loading", index: current });
  const [attempt, setAttempt] = useState(0);
  // The report is recomputed each minute so an open shift keeps counting; refetched when the period changes.
  const minute = Math.floor(now.getTime() / 60_000);

  useEffect(() => {
    let live = true;
    const period = payPeriod(index);
    setState({ status: "loading", index });
    loadReport({
      data: {
        from: period.start.toISOString(),
        to: period.end.toISOString(),
        yearStart: `${period.lastDay.slice(0, 4)}-01-01`,
        lastDay: period.lastDay,
      },
    }).then(
      (res) => {
        if (!live) return;
        if (!res.ok) return setState({ status: "failed", index });
        const report = buildPayReport({ ...res.data, period, now: new Date() });
        setState({ status: "ready", index, report, data: res.data });
      },
      () => live && setState({ status: "failed", index }),
    );
    return () => {
      live = false;
    };
  }, [index, attempt]);

  const ready = state.status === "ready" && state.index === index ? state : null;
  const report = ready ? buildPayReport({ ...ready.data, period: payPeriod(index), now: new Date(minute * 60_000) }) : null;
  const period = payPeriod(index);
  const sameYear = period.firstDay.slice(0, 4) === period.lastDay.slice(0, 4);
  const longDay = (day: string, withYear = true) =>
    new Date(day + "T12:00:00").toLocaleDateString(locale(lang), {
      month: "short",
      day: "numeric",
      ...(withYear ? { year: "numeric" } : {}),
    });
  const names = new Map(report?.rows.map((r) => [r.userId, r]) ?? []);
  const sum = (k: "week1" | "week2" | "ptoDays" | "total") => report?.rows.reduce((a, r) => a + r[k], 0) ?? 0;
  const stamp = (iso: string | null) => {
    if (!iso) return t("stillOpen");
    const d = new Date(iso);
    return `${dayKey(d)} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  };

  function download(kind: "hours" | "shifts") {
    if (!report) return;
    const csv =
      kind === "hours"
        ? toCsv(
            [t("colName"), t("colEmail"), t("colWeek1"), t("colWeek2"), t("colWorked"), t("colPtoDays"), t("colPtoHours"), t("colTotal"), t("colDaysLeft"), t("colMissed")],
            report.rows.map((r) => [r.name, r.email, r.week1, r.week2, r.worked, r.ptoDays, r.ptoHours, r.total, r.ptoDaysLeft, String(r.missed)]),
          )
        : toCsv(
            [t("colName"), t("colEmail"), t("colIn"), t("colOut"), t("colHours"), t("colProblem")],
            report.shifts.map((x) => {
              const who = names.get(x.userId);
              return [who?.name ?? "", who?.email ?? "", stamp(x.clockIn), stamp(x.clockOut), x.hours, x.kind ? t(`missed_${x.kind}`) : ""];
            }),
          );
    // The byte-order mark makes Excel read accents (Spanish names) correctly.
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${kind}-${period.firstDay}_to_${period.lastDay}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast.success(t("downloaded"));
  }

  const num = "px-1.5 py-2 text-right tabular-nums sm:px-2";
  return (
    <section id="reports" data-report-status={ready ? "ready" : state.status} className="space-y-4">
      <div className="panel p-4 sm:p-6">
        <div className="flex items-center justify-between gap-2">
          <button type="button" className={ghost + " w-11 px-0"} aria-label={t("prevPeriod")} onClick={() => setIndex((i) => i - 1)}>
            <ChevronLeft className="size-5" aria-hidden="true" />
          </button>
          <div className="min-w-0 text-center">
            <p className="font-display text-2xl font-semibold leading-tight" id="report-period">
              {longDay(period.firstDay, !sameYear)} – {longDay(period.lastDay)}
            </p>
            <p className="text-sm text-muted">{index === current ? t("currentPeriod") : t("payPeriod")}</p>
          </div>
          <button
            type="button"
            className={ghost + " w-11 px-0"}
            aria-label={t("nextPeriod")}
            disabled={index >= current}
            onClick={() => setIndex((i) => Math.min(current, i + 1))}
          >
            <ChevronRight className="size-5" aria-hidden="true" />
          </button>
        </div>
        <p className="mt-3 text-sm text-pretty text-muted">{t("reportsLead")}</p>
        {index !== current ? (
          <button type="button" className={ghost + " mt-3"} onClick={() => setIndex(current)}>
            {t("currentPeriod")}
          </button>
        ) : null}
      </div>

      {!report && state.status === "failed" ? (
        <div className="panel p-4 sm:p-6" role="alert">
          <p>{t("reportFailed")}</p>
          <button type="button" className={solid + " mt-3"} onClick={() => setAttempt((n) => n + 1)}>
            {t("retry")}
          </button>
        </div>
      ) : null}
      {!report && state.status === "loading" ? <p className="text-muted">{t("reportLoading")}</p> : null}

      {report ? (
        <>
          <div className="overflow-x-auto panel">
            <table className="w-full border-collapse text-sm" id="report-table">
              <thead>
                <tr className="border-b border-line text-left text-xs text-muted">
                  <th scope="col" className="px-3 py-2 align-bottom font-semibold">{t("colName")}</th>
                  <th scope="col" className={num + " align-bottom font-semibold"}>{t("colWeek1")}</th>
                  <th scope="col" className={num + " align-bottom font-semibold"}>{t("colWeek2")}</th>
                  <th scope="col" className={num + " align-bottom font-semibold"}>{t("colPtoDays")}</th>
                  <th scope="col" className={num + " align-bottom pr-3 font-semibold text-ink"}>{t("colTotal")}</th>
                </tr>
              </thead>
              <tbody>
                {report.rows.map((r) => (
                  <tr key={r.userId} className="border-b border-line" data-report-row={r.email}>
                    <th scope="row" className="px-3 py-2 text-left font-medium">
                      {r.name}
                      {r.missed > 0 ? (
                        <span className="ml-2 rounded-full bg-paper-2 px-2 py-0.5 text-xs font-semibold text-ink">{r.missed}</span>
                      ) : null}
                      <span className="block text-xs font-normal text-muted">
                        {t("colDaysLeft")}: {Math.round(r.ptoDaysLeft * 10) / 10}
                      </span>
                    </th>
                    <td className={num}>{fmtHours(r.week1)}</td>
                    <td className={num}>{fmtHours(r.week2)}</td>
                    <td className={num}>{r.ptoDays ? Math.round(r.ptoDays * 10) / 10 : "–"}</td>
                    <td className={num + " pr-3 font-semibold"} data-total>{fmtHours(r.total)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-paper-2 font-semibold">
                  <th scope="row" className="px-3 py-2 text-left">{t("totalsRow")}</th>
                  <td className={num}>{fmtHours(sum("week1"))}</td>
                  <td className={num}>{fmtHours(sum("week2"))}</td>
                  <td className={num}>{Math.round(sum("ptoDays") * 10) / 10}</td>
                  <td className={num + " pr-3"}>{fmtHours(sum("total"))}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <button type="button" id="download-hours" className={solid} onClick={() => download("hours")}>
              {t("downloadHours")}
            </button>
            <button type="button" id="download-shifts" className={ghost} onClick={() => download("shifts")}>
              {t("downloadShifts")}
            </button>
          </div>

          <div className="panel p-4 sm:p-6" id="missed-punches">
            <h2 className="font-display text-[1.75rem] font-bold leading-tight">{t("missedTitle")}</h2>
            {report.missed.length === 0 ? (
              <p className="mt-1 text-sm text-muted">{t("missedNone")}</p>
            ) : (
              <>
                <p className="mt-1 text-sm text-muted">{t("missedLead")}</p>
                <ul className="mt-2 divide-y divide-line">
                  {report.missed.map((m) => (
                    <li key={m.punchId} className="py-3" data-missed={m.kind}>
                      <p className="text-sm font-medium">
                        {names.get(m.userId)?.name ?? "—"} · {fmtDay(dayKey(new Date(m.clockIn)), lang)}
                      </p>
                      <p className="text-sm text-muted">
                        {fmtTime(m.clockIn, lang)} – {m.clockOut ? fmtTime(m.clockOut, lang) : t("stillOpen")}
                      </p>
                      <p className="text-sm text-ink">{t(`missed_${m.kind}`)}</p>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
          <p className="text-xs text-muted">{fmtDays(1)} = {PTO_DAY_HOURS} {t("hours")}</p>
        </>
      ) : null}
    </section>
  );
}

function InvitePanel({ snap, now, busy, act }: { snap: Snapshot; now: Date; busy: boolean; act: Act }) {
  const { t } = useI18n();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"employee" | "admin">("employee");
  const invites = snap.invites ?? [];
  const linkFor = (inv: Invite) => `${window.location.origin}/?invite=${inv.token}`;
  const send = (to: string, as: Invite["role"]) =>
    act(() => createInvite({ data: { email: to, role: as } }), snap.emailReady ? "inviteSent" : "inviteCreated");

  return (
    <section id="invite" className="panel p-4 sm:p-6">
      <h2 className="font-display text-[1.75rem] font-bold leading-tight">{t("inviteTitle")}</h2>
      <p className="mt-1 text-sm text-pretty text-muted">{snap.emailReady ? t("inviteLead") : t("inviteLeadNoEmail")}</p>
      <form
        className="mt-3 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void send(email, role).then((ok) => {
            if (ok) setEmail("");
          });
        }}
      >
        <label className="block text-sm font-medium">
          {t("inviteEmail")}
          <input
            id="invite-email"
            type="email"
            required
            autoComplete="off"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={field}
          />
        </label>
        <div role="group" aria-label={t("role")} className="grid grid-cols-2 gap-2">
          {(["employee", "admin"] as const).map((r) => (
            <button
              key={r}
              type="button"
              aria-pressed={role === r}
              data-role-choice={r}
              onClick={() => setRole(r)}
              className={
                "h-11 rounded-lg text-sm font-semibold " +
                (role === r ? "bg-pine text-foam" : "border border-line bg-paper text-ink")
              }
            >
              {t(r)}
            </button>
          ))}
        </div>
        <button type="submit" disabled={busy} className={solid + " w-full"}>
          {snap.emailReady ? t("sendInvite") : t("createInvite")}
        </button>
      </form>

      {invites.length > 0 ? (
        <>
          <h3 className="mt-5 text-sm font-semibold text-muted">{t("pendingInvites")}</h3>
          <ul className="mt-1 divide-y divide-line">
            {invites.map((inv) => {
              const expired = inviteState({ acceptedAt: null, expiresAt: inv.expiresAt }, now) === "expired";
              return (
              <li key={inv.id} className="space-y-2 py-3" data-invite={inv.email}>
                <p className="truncate text-sm font-medium">
                  {inv.email}
                  <span className="ml-2 font-normal text-muted">
                    {t(inv.role)}
                    {expired ? ` · ${t("expired")}` : ""}
                  </span>
                </p>
                {/* Always on screen, so the link can be copied by hand where the clipboard is blocked. */}
                <input
                  readOnly
                  aria-label={t("copyLink")}
                  value={linkFor(inv)}
                  onFocus={(e) => e.target.select()}
                  className="h-10 w-full rounded-lg border border-line bg-paper px-2 text-xs text-muted"
                />
                <div className="flex flex-wrap gap-2">
                  {/* Opens the admin's own email app with the invitation already written. Needs no email setup. */}
                  <a className={solid} data-email-invite href={inviteMailto(inv.email, linkFor(inv))}>
                    {t("emailIt")}
                  </a>
                  <button
                    type="button"
                    className={ghost}
                    onClick={() =>
                      void navigator.clipboard.writeText(linkFor(inv)).then(
                        () => toast.success(t("linkCopied")),
                        () => undefined,
                      )
                    }
                  >
                    {t("copyLink")}
                  </button>
                  {/* Sending again makes a new link, so without email it is only offered to renew an expired one. */}
                  {snap.emailReady || expired ? (
                    <button type="button" className={ghost} disabled={busy} onClick={() => void send(inv.email, inv.role)}>
                      {t("sendAgain")}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className={ghost}
                    disabled={busy}
                    onClick={() => void act(() => removeInvite({ data: { id: inv.id } }), "removed")}
                  >
                    {t("remove")}
                  </button>
                </div>
              </li>
              );
            })}
          </ul>
        </>
      ) : null}
    </section>
  );
}

function PersonCard({
  person,
  snap,
  now,
  busy,
  act,
}: {
  person: Profile;
  snap: Snapshot;
  now: Date;
  busy: boolean;
  act: Act;
}) {
  const { t, lang } = useI18n();
  const [open, setOpen] = useState(false);
  const [allowanceInput, setAllowanceInput] = useState(String(person.ptoAllowance / PTO_DAY_HOURS));
  const fmtDays = useFmtDays();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [confirm, setConfirm] = useState<number | null>(null);
  const punches = snap.punches.filter((p) => p.userId === person.userId);
  const onClock = punches.some((p) => !p.clockOut);
  const week0 = weekStart(now);
  const thisH = hoursIn(punches, week0, addDays(week0, 7), now);
  const lastH = hoursIn(punches, addDays(week0, -7), week0, now);
  const requests = snap.pto.filter((p) => p.userId === person.userId);
  const pending = requests.filter((p) => p.status === "pending").length;
  const you = person.userId === snap.me.userId;
  const label = person.fullName || person.email || "—";

  useEffect(() => {
    setAllowanceInput(String(person.ptoAllowance / PTO_DAY_HOURS));
  }, [person.ptoAllowance]);

  return (
    <article className="panel p-4 sm:p-6">
      <button type="button" className="flex w-full items-start justify-between gap-3 text-left" onClick={() => setOpen((v) => !v)}>
        <div className="min-w-0">
          <p className="truncate font-semibold">
            {label}
            {you ? <span className="ml-2 text-sm font-medium text-muted">{t("you")}</span> : null}
          </p>
          <p className="mt-1 text-sm text-muted">
            <span className={onClock ? "font-semibold text-leaf-text" : ""}>{onClock ? t("working") : t("notWorking")}</span>
            {" · "}
            {person.role === "admin" ? t("admin") : t("employee")}
            {pending > 0 ? ` · ${t("pendingCount", { n: pending })}` : ""}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="font-display text-2xl tabular-nums leading-none">{fmtHours(thisH)}</p>
          <p className="text-xs text-muted">{t("thisWeek")}</p>
          <p className="mt-1 text-xs tabular-nums text-muted">
            {t("lastWeek")} {fmtHours(lastH)}
          </p>
        </div>
      </button>

      {open ? (
        <div className="mt-4 space-y-4 border-t border-line pt-4">
          <div className="flex flex-wrap gap-2">
            {onClock ? (
              <button
                type="button"
                className={solid}
                disabled={busy}
                onClick={() => void act(() => forceOut({ data: { userId: person.userId } }), "clockedOut")}
              >
                {t("forceOut")}
              </button>
            ) : null}
            <button
              type="button"
              className={ghost}
              disabled={busy}
              onClick={() =>
                void act(
                  () =>
                    setRole({
                      data: { userId: person.userId, role: person.role === "admin" ? "employee" : "admin" },
                    }),
                  "updated",
                )
              }
            >
              {person.role === "admin" ? t("makeEmployee") : t("makeAdmin")}
            </button>
          </div>

          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void act(
                () => setAllowance({ data: { userId: person.userId, days: Number(allowanceInput) } }),
                "saved",
              );
            }}
          >
            <label className="text-sm font-medium">
              {t("allowance")}
              <input
                type="number"
                inputMode="decimal"
                min={0}
                max={124}
                step={0.5}
                data-allowance={person.userId}
                value={allowanceInput}
                onChange={(e) => setAllowanceInput(e.target.value)}
                className={field + " w-36"}
              />
            </label>
            <button type="submit" className={solid} disabled={busy}>
              {t("save")}
            </button>
          </form>

          <div>
            <h3 className="text-sm font-semibold text-muted">{t("requests")}</h3>
            {requests.length === 0 ? <p className="mt-2 text-sm text-muted">{t("noPto")}</p> : null}
            <ul className="divide-y divide-line">
              {requests.map((r) => (
                <li key={r.id} className="py-3">
                  <p className="text-sm font-medium">
                    {fmtDay(r.day, lang)} · {fmtDays(r.hours / PTO_DAY_HOURS)} · {t(r.status)}
                  </p>
                  {r.note ? <p className="text-sm text-pretty">{r.note}</p> : null}
                  <div className="mt-2 flex gap-2">
                    {ptoActions(r.status, { owner: false, admin: true, daysUntil: 0 }).map((a) =>
                      a === "cancel" ? null : (
                        <button
                          key={a}
                          type="button"
                          data-action={a}
                          className={a === "approve" ? solid : ghost}
                          disabled={busy}
                          onClick={() => void act(() => decidePto({ data: { id: r.id, status: PTO_NEXT[a] } }), "updated")}
                        >
                          {t(a)}
                        </button>
                      ),
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-muted">{t("shiftsFor")}</h3>
            <form
              className="mt-2 space-y-2"
              onSubmit={(e) => {
                e.preventDefault();
                const clockIn = new Date(from).toISOString();
                const clockOut = new Date(to).toISOString();
                void act(() => addPunch({ data: { userId: person.userId, clockIn, clockOut } }), "saved");
              }}
            >
              <p className="text-sm font-medium">{t("addShift")}</p>
              <p className="text-sm text-muted">{t("shiftHint")}</p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <label className="text-sm font-medium">
                  {t("from")}
                  <input type="datetime-local" required value={from} onChange={(e) => setFrom(e.target.value)} className={field} />
                </label>
                <label className="text-sm font-medium">
                  {t("to")}
                  <input type="datetime-local" required value={to} onChange={(e) => setTo(e.target.value)} className={field} />
                </label>
              </div>
              <button type="submit" className={solid} disabled={busy}>
                {t("add")}
              </button>
            </form>
            <ul className="mt-2 divide-y divide-line">
              {punches.map((p) => (
                <li key={p.id} className="flex items-start justify-between gap-3 py-3">
                  <div className="min-w-0 text-sm">
                    <p>
                      {fmtWhen(p.clockIn, lang)} – {p.clockOut ? fmtWhen(p.clockOut, lang) : t("openShift")}
                    </p>
                    {p.manual ? (
                      <p className="mt-1 flex items-center gap-1 text-xs text-muted">
                        <PenLine className="size-3.5" aria-hidden="true" />
                        {t("manual")}
                      </p>
                    ) : null}
                  </div>
                  {confirm === p.id ? (
                    <div className="flex gap-2">
                      <button
                        type="button"
                        className={solid}
                        disabled={busy}
                        onClick={() =>
                          void act(() => deletePunch({ data: { id: p.id } }), "removed").then(() => setConfirm(null))
                        }
                      >
                        {t("yesDelete")}
                      </button>
                      <button type="button" className={ghost} onClick={() => setConfirm(null)}>
                        {t("keep")}
                      </button>
                    </div>
                  ) : (
                    <button type="button" className={ghost} onClick={() => setConfirm(p.id)}>
                      {t("delete")}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
    </article>
  );
}

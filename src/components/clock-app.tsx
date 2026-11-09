import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { CalendarOff, ChevronLeft, ChevronRight, PenLine } from "lucide-react";
import { toast } from "sonner";
import { UserButton } from "@/lib/auth/gates";
import { errorCopyKey, useI18n, type CopyKey, type Lang } from "@/lib/i18n";
import { addDays, daysUntil, fmtHms, fmtHours, hoursIn, ptoUsed, selfCheck, weekStart } from "@/lib/time";
import {
  addHoliday,
  addPunch,
  cancelPto,
  decidePto,
  deleteHoliday,
  deletePunch,
  forceOut,
  loadClock,
  requestPto,
  setAllowance,
  setRole,
  togglePunch,
  type ClockResult,
  type Holiday,
  type OffDay,
  type Profile,
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

function dateInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const field = "mt-1 h-12 w-full rounded-lg border border-line bg-paper px-3 text-base text-ink";
const solid =
  "inline-flex h-11 items-center justify-center rounded-lg bg-espresso px-3 text-sm font-semibold text-foam disabled:opacity-60";
const ghost =
  "inline-flex h-11 items-center justify-center rounded-lg border border-line bg-card px-3 text-sm font-medium text-ink disabled:opacity-60";

export function ClockApp() {
  const { t, lang, setLang } = useI18n();
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [tab, setTab] = useState<"mine" | "team">("mine");
  const [busy, setBusy] = useState(false);
  const now = useServerNow(snap?.serverNow);

  const reload = useCallback(async () => {
    try {
      const data = await loadClock();
      setSnap(data);
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, []);

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
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [reload]);

  async function act(fn: () => Promise<ClockResult>, okKey: CopyKey) {
    setBusy(true);
    try {
      const res = await fn();
      if (!res.ok) {
        toast.error(t(errorCopyKey(res.error)));
        return;
      }
      setSnap(res.data);
      toast.success(t(okKey));
    } catch {
      toast.error(t("errGeneric"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen pb-16">
      <header className="sticky top-0 z-20 border-b border-line bg-paper">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3">
          <p className="font-display text-3xl font-bold uppercase leading-none tracking-wide">{t("appName")}</p>
          <div className="flex items-center gap-2">
            <div role="group" aria-label={t("language")} className="flex overflow-hidden rounded-lg border border-line">
              {(["en", "es"] as const).map((code) => (
                <button
                  key={code}
                  type="button"
                  aria-pressed={lang === code}
                  onClick={() => setLang(code)}
                  className={
                    "h-11 min-w-11 px-3 text-sm font-semibold " +
                    (lang === code ? "bg-espresso text-foam" : "bg-card text-muted")
                  }
                >
                  {code.toUpperCase()}
                </button>
              ))}
            </div>
            <div className="account-slot">
              <UserButton />
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl px-4 pt-4">
        {!snap && !loadError ? <p className="text-muted">{t("boot")}</p> : null}
        {loadError ? (
          <div className="rounded-2xl border border-line bg-card p-4">
            <p>{t("loadError")}</p>
            <button type="button" className={"mt-3 " + solid} onClick={() => void reload()}>
              {t("retry")}
            </button>
          </div>
        ) : null}
        {snap ? (
          <>
            {snap.me.role === "admin" ? (
              <div className="mb-4 grid grid-cols-2 gap-2">
                <TabButton active={tab === "mine"} onClick={() => setTab("mine")}>
                  {t("mine")}
                </TabButton>
                <TabButton active={tab === "team"} onClick={() => setTab("team")}>
                  {t("team")}
                  <PendingBadge n={snap.pto.filter((p) => p.status === "pending").length} />
                </TabButton>
              </div>
            ) : null}
            {tab === "team" && snap.me.role === "admin" ? (
              <TeamPanel snap={snap} now={now} busy={busy} act={act} />
            ) : (
              <Mine snap={snap} now={now} busy={busy} act={act} />
            )}
          </>
        ) : null}
      </main>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "flex h-12 items-center justify-center gap-2 rounded-xl text-sm font-semibold " +
        (active ? "bg-espresso text-foam" : "border border-line bg-card text-ink")
      }
    >
      {children}
    </button>
  );
}

function PendingBadge({ n }: { n: number }) {
  if (n <= 0) return null;
  return (
    <span className="rounded-full bg-foam px-2 text-xs font-bold tabular-nums text-espresso">{n}</span>
  );
}

function Mine({
  snap,
  now,
  busy,
  act,
}: {
  snap: Snapshot;
  now: Date;
  busy: boolean;
  act: (fn: () => Promise<ClockResult>, okKey: CopyKey) => Promise<void>;
}) {
  const { t, lang } = useI18n();
  const mine = snap.punches.filter((p) => p.userId === snap.me.userId);
  const open = mine.find((p) => !p.clockOut) ?? null;
  const today0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const week0 = weekStart(now);
  const todayH = hoursIn(mine, today0, addDays(today0, 1), now);
  const weekH = hoursIn(mine, week0, addDays(week0, 7), now);
  const used = ptoUsed(snap.pto.filter((p) => p.userId === snap.me.userId), now.getFullYear());
  const left = snap.me.ptoAllowance - used;
  const recent = mine.slice(0, 10);
  const [ptoDay, setPtoDay] = useState(() => dateInput(now));
  const [focusDay, setFocusDay] = useState(() => dateInput(now));

  return (
    <div className="space-y-4">
      <HolidayBanner holidays={snap.holidays} now={now} />
      <section className="rounded-2xl border border-line bg-card p-4">
        <p className="text-sm font-medium text-muted">{open ? t("working") : t("notWorking")}</p>
        {open ? (
          <p className="mt-1 text-sm text-ink">{t("since", { time: fmtTime(open.clockIn, lang) })}</p>
        ) : null}
        <button
          id="clock-btn"
          type="button"
          disabled={busy}
          aria-busy={busy}
          onClick={() =>
            void act(
              () => togglePunch({ data: { targetUserId: "" } }),
              open ? "clockedOut" : "clockedIn",
            )
          }
          className={
            "mt-4 flex min-h-32 w-full flex-col items-center justify-center rounded-2xl px-4 py-6 disabled:opacity-60 " +
            (open ? "bg-on text-on-ink" : "bg-espresso text-foam")
          }
        >
          <span className="font-display text-5xl font-bold uppercase leading-none tracking-wide">
            {open ? t("clockOut") : t("clockIn")}
          </span>
          <span className="mt-3 font-display text-3xl tabular-nums tracking-widest">
            {open ? fmtHms(now.getTime() - new Date(open.clockIn).getTime()) : fmtHours(todayH)}
          </span>
          <span className="mt-1 text-xs uppercase tracking-widest opacity-80">
            {open ? t("elapsed") : t("today")}
          </span>
        </button>
      </section>

      <section className="grid grid-cols-3 gap-2">
        <Stat label={t("today")} value={fmtHours(todayH)} unit={t("hours")} />
        <Stat label={t("thisWeek")} value={fmtHours(weekH)} unit={t("hours")} />
        <Stat label={t("ptoLeft")} value={fmtHours(left)} unit={t("hours")} />
      </section>
      <p className="text-sm text-muted">{t("weekNote")}</p>
      <p className="text-sm text-muted">{t("ptoHint")}</p>

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
      />
      <PtoPanel snap={snap} now={now} busy={busy} act={act} day={ptoDay} setDay={setPtoDay} />

      <section className="rounded-2xl border border-line bg-card p-4">
        <h2 className="font-display text-2xl font-semibold uppercase tracking-wide">{t("shifts")}</h2>
        {recent.length === 0 ? <p className="mt-2 text-sm text-muted">{t("noShifts")}</p> : null}
        <ul className="mt-3 divide-y divide-line">
          {recent.map((p) => (
            <ShiftRow key={p.id} punch={p} now={now} lang={lang} />
          ))}
        </ul>
      </section>
    </div>
  );
}

function Stat({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div className="rounded-xl border border-line bg-card px-2 py-3 text-center">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 font-display text-3xl font-bold tabular-nums leading-none">{value}</p>
      <p className="mt-1 text-xs text-muted">{unit}</p>
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
      </div>
      <p className="shrink-0 font-display text-2xl tabular-nums">{fmtHours(hours)}</p>
    </li>
  );
}

function HolidayBanner({ holidays, now }: { holidays: Holiday[]; now: Date }) {
  const { t } = useI18n();
  const todays = holidays.filter((h) => daysUntil(h.day, now) === 0);
  if (todays.length > 0) {
    return (
      <p className="flex items-start gap-2 rounded-xl border border-line bg-paper-2 px-3 py-3 text-sm font-medium" role="status">
        <CalendarOff className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        {t("todayOff", { name: todays.map((h) => h.name).join(" · ") })}
      </p>
    );
  }
  const next = holidays
    .map((h) => ({ h, n: daysUntil(h.day, now) }))
    .filter((x) => x.n > 0)
    .sort((a, b) => a.n - b.n)[0];
  if (!next) return null;
  const text = next.n === 1 ? t("nextOff1", { name: next.h.name }) : t("nextOff", { name: next.h.name, n: next.n });
  return (
    <p className="flex items-start gap-2 rounded-xl border border-line bg-paper-2 px-3 py-3 text-sm font-medium" role="status">
      <CalendarOff className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      {text}
    </p>
  );
}

function canCancelOwn(status: string, day: string, now: Date): boolean {
  if (status === "pending") return true;
  return status === "approved" && daysUntil(day, now) >= 0;
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
  act: (fn: () => Promise<ClockResult>, okKey: CopyKey) => Promise<void>;
  day: string;
  setDay: (day: string) => void;
}) {
  const { t, lang } = useI18n();
  const [hours, setHours] = useState("8");
  const [note, setNote] = useState("");
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const rows = snap.pto
    .filter((p) => p.userId === snap.me.userId)
    .slice()
    .sort((a, b) => a.day.localeCompare(b.day) || b.id - a.id);

  return (
    <section id="pto-request" className="rounded-2xl border border-line bg-card p-4">
      <h2 className="font-display text-2xl font-semibold uppercase tracking-wide">{t("ptoTitle")}</h2>
      <p className="mt-1 text-sm text-pretty text-muted">{t("ptoLead")}</p>
      <form
        className="mt-3 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void act(() => requestPto({ data: { day, hours: Number(hours), note } }), "sent").then(() => setNote(""));
        }}
      >
        <div className="grid grid-cols-2 gap-2">
          <label className="text-sm font-medium">
            {t("day")}
            <input id="pto-day" type="date" required value={day} onChange={(e) => setDay(e.target.value)} className={field} />
          </label>
          <label className="text-sm font-medium">
            {t("ptoHours")}
            <input
              id="pto-hours"
              type="number"
              required
              min={0.25}
              max={24}
              step={0.25}
              value={hours}
              onChange={(e) => setHours(e.target.value)}
              className={field}
            />
          </label>
        </div>
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

      <h3 className="mt-5 text-sm font-semibold uppercase tracking-wide text-muted">{t("myRequests")}</h3>
      <p className="mt-1 text-sm text-muted">{t("hoursBack")}</p>
      {rows.length === 0 ? <p className="mt-3 text-sm text-muted">{t("noPto")}</p> : null}
      <ul className="mt-2 divide-y divide-line">
        {rows.map((r) => {
          const cancellable = canCancelOwn(r.status, r.day, now);
          return (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {fmtDay(r.day, lang)} · {fmtHours(r.hours)} {t("hours")}
                </p>
                <p className="text-xs uppercase tracking-wide text-muted">{t(r.status)}</p>
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
}: {
  snap: Snapshot;
  now: Date;
  busy: boolean;
  act: (fn: () => Promise<ClockResult>, okKey: CopyKey) => Promise<void>;
  focusDay: string;
  onPick: (day: string) => void;
}) {
  const { t, lang } = useI18n();
  const [cursor, setCursor] = useState(() => new Date(now.getFullYear(), now.getMonth(), 1));
  const [holidayName, setHolidayName] = useState("");
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

  return (
    <section className="rounded-2xl border border-line bg-card p-4">
      <h2 className="font-display text-2xl font-semibold uppercase tracking-wide">{t("calendarTitle")}</h2>
      <p className="mt-1 text-sm text-pretty text-muted">{t("calLead")}</p>

      <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
        <Legend swatch="bg-espresso" label={t("legendClosed")} />
        <Legend swatch="bg-on" label={t("legendYou")} />
        <Legend swatch="bg-muted" label={t("legendOthers")} />
        <Legend swatch="border border-espresso bg-card" label={t("legendPending")} />
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
        <p className="font-display text-2xl font-semibold uppercase tracking-wide">{monthLabel}</p>
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
                (key === todayKey ? "ring-2 ring-espresso" : "")
              }
            >
              <span className="text-sm tabular-nums leading-none">{day}</span>
              <span className="mt-1 flex h-1.5 gap-0.5">
                {holiday ? <span className="size-1.5 rounded-sm bg-espresso" /> : null}
                {mineApproved ? <span className="size-1.5 rounded-full bg-on" /> : null}
                {others ? <span className="size-1.5 rounded-full bg-muted" /> : null}
                {pending ? <span className="size-1.5 rounded-full border border-espresso" /> : null}
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-4 rounded-xl border border-line bg-paper p-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">{t("thisDay")}</p>
        <p className="mt-1 font-medium">{fmtDay(focusDay, lang)}</p>
        {focusHoliday.length === 0 && focusOff.length === 0 && focusPending.length === 0 ? (
          <p className="mt-2 text-sm text-muted">{t("nothingDay")}</p>
        ) : null}
        <ul className="mt-2 space-y-2">
          {focusHoliday.map((h) => (
            <li key={h.day} className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium">
                {t("legendClosed")} · {h.name}
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
          onClick={() => {
            onPick(focusDay);
            document.getElementById("pto-request")?.scrollIntoView({ block: "start" });
          }}
        >
          {t("requestThisDay")}
        </button>
      </div>

      {admin ? (
        <form
          className="mt-4 space-y-3 border-t border-line pt-4"
          onSubmit={(e) => {
            e.preventDefault();
            void act(() => addHoliday({ data: { day: focusDay, name: holidayName } }), "saved").then(() =>
              setHolidayName(""),
            );
          }}
        >
          <p className="text-sm font-medium">{t("addHoliday")}</p>
          <p className="text-sm text-muted">{fmtDay(focusDay, lang)}</p>
          <label className="block text-sm font-medium">
            {t("holidayName")}
            <input
              id="holiday-name"
              required
              maxLength={60}
              value={holidayName}
              placeholder={t("holidayPh")}
              onChange={(e) => setHolidayName(e.target.value)}
              className={field}
            />
          </label>
          <button type="submit" disabled={busy} className={solid}>
            {t("save")}
          </button>
        </form>
      ) : null}
    </section>
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
  act: (fn: () => Promise<ClockResult>, okKey: CopyKey) => Promise<void>;
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
  act: (fn: () => Promise<ClockResult>, okKey: CopyKey) => Promise<void>;
}) {
  const { t, lang } = useI18n();
  const [open, setOpen] = useState(false);
  const [allowanceInput, setAllowanceInput] = useState(String(person.ptoAllowance));
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
    setAllowanceInput(String(person.ptoAllowance));
  }, [person.ptoAllowance]);

  return (
    <article className="rounded-2xl border border-line bg-card p-4">
      <button type="button" className="flex w-full items-start justify-between gap-3 text-left" onClick={() => setOpen((v) => !v)}>
        <div className="min-w-0">
          <p className="truncate font-semibold">
            {label}
            {you ? <span className="ml-2 text-sm font-medium text-muted">{t("you")}</span> : null}
          </p>
          <p className="mt-1 text-sm text-muted">
            <span className={onClock ? "font-semibold text-on" : ""}>{onClock ? t("working") : t("notWorking")}</span>
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
                () => setAllowance({ data: { userId: person.userId, hours: Number(allowanceInput) } }),
                "saved",
              );
            }}
          >
            <label className="text-sm font-medium">
              {t("allowance")}
              <input
                type="number"
                min={0}
                max={999}
                step={0.5}
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
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">{t("requests")}</h3>
            {requests.length === 0 ? <p className="mt-2 text-sm text-muted">{t("noPto")}</p> : null}
            <ul className="divide-y divide-line">
              {requests.map((r) => (
                <li key={r.id} className="py-3">
                  <p className="text-sm font-medium">
                    {fmtDay(r.day, lang)} · {fmtHours(r.hours)} {t("hours")} · {t(r.status)}
                  </p>
                  {r.note ? <p className="text-sm text-pretty">{r.note}</p> : null}
                  {r.status === "pending" ? (
                    <div className="mt-2 flex gap-2">
                      <button
                        type="button"
                        className={solid}
                        disabled={busy}
                        onClick={() => void act(() => decidePto({ data: { id: r.id, status: "approved" } }), "updated")}
                      >
                        {t("approve")}
                      </button>
                      <button
                        type="button"
                        className={ghost}
                        disabled={busy}
                        onClick={() => void act(() => decidePto({ data: { id: r.id, status: "denied" } }), "updated")}
                      >
                        {t("deny")}
                      </button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">{t("shiftsFor")}</h3>
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

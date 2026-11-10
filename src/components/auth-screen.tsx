import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "@tanstack/react-router";
import { GROK_PROVIDERS, authClient, signIn } from "@/lib/auth/client";
import { authErrorCopyKey, useI18n } from "@/lib/i18n";
import { signInInfo } from "@/lib/timeclock.functions";

/** Where an invitation token waits between opening the link and finishing sign-up. */
export const INVITE_KEY = "tc-invite";

const input = "mt-1 h-12 w-full rounded-lg border border-line bg-paper px-3 text-base";
const primary = "h-12 w-full rounded-xl bg-pine text-base font-semibold text-foam disabled:opacity-60";
const link = "h-11 w-full text-sm font-medium text-muted underline-offset-2 hover:underline";

/**
 * Sign-in form machine:
 *   in <-> up            sign in / create account
 *   in  -> forgot -> sent   ask for a reset link by email
 * An invitation link opens straight on `up` with the email filled in and locked.
 */
type Mode = "in" | "up" | "forgot" | "sent";

function Shell({ children }: { children: ReactNode }) {
  const { t, lang, setLang } = useI18n();
  return (
    <div className="min-h-screen">
      <div className="border-b-4 border-leaf bg-bar text-bar-ink">
        <div className="mx-auto flex w-full max-w-md items-center justify-between gap-3 px-4 py-4">
          <p className="flex min-w-0 items-center gap-2 font-display text-3xl font-bold uppercase leading-none tracking-wide whitespace-nowrap">
            <svg viewBox="0 0 32 32" className="size-9 shrink-0" aria-hidden="true">
              <rect width="32" height="32" rx="8" className="fill-leaf" />
              <circle cx="16" cy="16" r="8" fill="none" strokeWidth="2" className="stroke-leaf-ink" />
              <path d="M16 11.5V16l3 2" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="stroke-leaf-ink" />
            </svg>
            {t("appName")}
          </p>
          <div role="group" aria-label={t("language")} className="flex shrink-0 overflow-hidden rounded-lg border border-bar-ink/30">
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
        </div>
      </div>
      <main className="mx-auto flex w-full max-w-md flex-col px-4 pt-8 pb-10">{children}</main>
    </div>
  );
}

function PasswordField({
  label,
  value,
  onChange,
  autoComplete,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: string;
}) {
  const { t } = useI18n();
  const [shown, setShown] = useState(false);
  return (
    <label className="block text-sm font-medium">
      {label}
      <span className="mt-1 flex gap-2">
        <input
          id="password"
          type={shown ? "text" : "password"}
          required
          minLength={8}
          autoComplete={autoComplete}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={input + " mt-0 min-w-0 flex-1"}
        />
        <button
          type="button"
          aria-pressed={shown}
          onClick={() => setShown((v) => !v)}
          className="h-12 shrink-0 rounded-lg border border-line bg-card px-3 text-sm font-medium"
        >
          {shown ? t("hide") : t("show")}
        </button>
      </span>
    </label>
  );
}

export function AuthScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [emailReady, setEmailReady] = useState(true);
  // "ok": arrived with a good invitation (email locked). "bad": the link is used up or expired.
  const [invite, setInvite] = useState<"none" | "ok" | "bad">("none");

  useEffect(() => {
    let token = new URLSearchParams(window.location.search).get("invite") ?? "";
    try {
      if (token) window.sessionStorage.setItem(INVITE_KEY, token);
      else token = window.sessionStorage.getItem(INVITE_KEY) ?? "";
    } catch {
      /* storage unavailable: the link still fills in the form */
    }
    let live = true;
    void signInInfo({ data: { token } })
      .then((info) => {
        if (!live) return;
        setEmailReady(info.emailReady);
        if (!info.invite) return;
        if (info.invite.open) {
          setInvite("ok");
          setEmail(info.invite.email);
          setMode("up");
        } else {
          setInvite("bad");
          try {
            window.sessionStorage.removeItem(INVITE_KEY);
          } catch {
            /* nothing to clear */
          }
        }
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  function go(next: Mode) {
    setMode(next);
    setError("");
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (mode === "forgot") {
        const result = await authClient.requestPasswordReset({ email: email.trim(), redirectTo: "/reset-password" });
        if (result.error && result.error.status >= 500) setError(t("errGeneric"));
        else setMode("sent");
        return;
      }
      const result =
        mode === "up"
          ? await authClient.signUp.email({ name: name.trim(), email: email.trim(), password, callbackURL: "/" })
          : await authClient.signIn.email({ email: email.trim(), password, callbackURL: "/" });
      if (result.error) {
        const key = authErrorCopyKey(result.error.code);
        setError(key ? t(key) : result.error.message || t("errGeneric"));
        return;
      }
      await authClient.getSession();
      if (router.state.location.pathname !== "/") await router.navigate({ to: "/" });
    } catch {
      setError(t("errGeneric"));
    } finally {
      setBusy(false);
    }
  }

  const invited = invite === "ok" && mode === "up";
  const title = { in: t("signInTitle"), up: t("signUpTitle"), forgot: t("forgotTitle"), sent: t("forgotTitle") }[mode];

  return (
    <Shell>
      <h1 className="font-display text-4xl font-bold leading-tight text-ink">{invited ? t("invitedTitle") : t("welcome")}</h1>
      <p className="mt-1 text-pretty text-muted">{invited ? t("invitedLead") : t("tagline")}</p>
      {invite === "bad" ? (
        <p className="mt-4 rounded-2xl bg-paper-2 px-4 py-3 text-sm font-semibold text-ink" role="alert">
          {t("inviteBad")}
        </p>
      ) : null}

      <form onSubmit={onSubmit} data-mode={mode} className="panel mt-6 space-y-3 p-4 sm:p-5">
        <h2 className="font-display text-[1.75rem] font-bold leading-tight">{title}</h2>

        {mode === "sent" ? (
          <p className="text-pretty text-ink" role="status">
            {t("resetSent")}
          </p>
        ) : mode === "forgot" && !emailReady ? (
          <p className="text-pretty text-ink" role="status">
            {t("resetNotSetUp")}
          </p>
        ) : (
          <>
            {mode === "forgot" ? <p className="text-sm text-pretty text-muted">{t("forgotLead")}</p> : null}
            {mode === "up" ? (
              <label className="block text-sm font-medium">
                {t("name")}
                <input id="name" required autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} className={input} />
              </label>
            ) : null}
            <label className="block text-sm font-medium">
              {t("email")}
              <input
                id="email"
                type="email"
                required
                readOnly={invited}
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={input + (invited ? " text-muted" : "")}
              />
            </label>
            {mode !== "forgot" ? (
              <>
                <PasswordField
                  label={t("password")}
                  value={password}
                  onChange={setPassword}
                  autoComplete={mode === "up" ? "new-password" : "current-password"}
                />
                {mode === "up" ? <p className="text-sm text-muted">{t("passwordHint")}</p> : null}
              </>
            ) : null}
            {error ? (
              <p className="text-sm font-medium text-ink" role="alert">
                {error}
              </p>
            ) : null}
            <button id="auth-submit" type="submit" disabled={busy} className={primary}>
              {mode === "forgot" ? t("sendReset") : title}
            </button>
          </>
        )}

        {mode === "in" ? (
          <button id="forgot-link" type="button" className={link} onClick={() => go("forgot")}>
            {t("forgot")}
          </button>
        ) : null}
        {mode === "in" || mode === "up" ? (
          <button type="button" className={link} onClick={() => go(mode === "up" ? "in" : "up")}>
            {mode === "up" ? t("haveAccount") : t("needAccount")}
          </button>
        ) : (
          <button type="button" className={link} onClick={() => go("in")}>
            {t("backToSignIn")}
          </button>
        )}
        {mode === "up" && !invited ? <p className="text-sm text-muted">{t("firstAdmin")}</p> : null}
      </form>

      {mode === "in" || mode === "up" ? (
        <div className="mt-6 space-y-2">
          <p className="text-center text-xs uppercase tracking-widest text-muted">{t("or")}</p>
          {GROK_PROVIDERS.map((p) => (
            <button
              key={p.providerId}
              type="button"
              onClick={() => {
                void signIn(p.providerId, { callbackURL: "/" });
              }}
              className="h-12 w-full rounded-xl border border-line bg-card text-sm font-semibold"
            >
              {t("continueWith", { name: p.label })}
            </button>
          ))}
        </div>
      ) : null}
    </Shell>
  );
}

/** Landing page for the link in a reset email: `/reset-password?token=…` (or `?error=INVALID_TOKEN`). */
export function ResetScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [state, setState] = useState<"form" | "saving" | "done" | "bad">("form");
  const [error, setError] = useState("");

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const value = q.get("token");
    if (!value || q.get("error")) setState("bad");
    else setToken(value);
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!token) return;
    setError("");
    setState("saving");
    try {
      const result = await authClient.resetPassword({ newPassword: password, token });
      if (!result.error) return setState("done");
      const key = authErrorCopyKey(result.error.code);
      if (key) {
        setError(t(key));
        setState("form");
      } else setState("bad");
    } catch {
      setError(t("errGeneric"));
      setState("form");
    }
  }

  return (
    <Shell>
      <form onSubmit={onSubmit} data-state={state} className="panel mt-6 space-y-3 p-4 sm:p-5">
        <h2 className="font-display text-[1.75rem] font-bold leading-tight">{t("newPasswordTitle")}</h2>
        {state === "bad" ? (
          <p className="text-pretty text-ink" role="alert">
            {t("resetBadLink")}
          </p>
        ) : state === "done" ? (
          <p className="text-pretty text-ink" role="status">
            {t("passwordSaved")}
          </p>
        ) : (
          <>
            <PasswordField label={t("newPassword")} value={password} onChange={setPassword} autoComplete="new-password" />
            <p className="text-sm text-muted">{t("passwordHint")}</p>
            {error ? (
              <p className="text-sm font-medium text-ink" role="alert">
                {error}
              </p>
            ) : null}
            <button id="auth-submit" type="submit" disabled={state === "saving" || !token} className={primary}>
              {t("savePassword")}
            </button>
          </>
        )}
        <button type="button" className={link} onClick={() => void router.navigate({ to: "/login" })}>
          {t("backToSignIn")}
        </button>
      </form>
    </Shell>
  );
}

export function BootScreen() {
  const { t } = useI18n();
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-4">
      <p className="font-display text-5xl font-bold uppercase leading-none tracking-wide">{t("appName")}</p>
      <p className="mt-3 text-muted">{t("boot")}</p>
    </main>
  );
}

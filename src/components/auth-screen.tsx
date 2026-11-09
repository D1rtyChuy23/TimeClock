import { useState, type FormEvent } from "react";
import { useRouter } from "@tanstack/react-router";
import { GROK_PROVIDERS, authClient, signIn } from "@/lib/auth/client";
import { authErrorCopyKey, useI18n } from "@/lib/i18n";

export function AuthScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const result =
        mode === "up"
          ? await authClient.signUp.email({
              name: name.trim(),
              email: email.trim(),
              password,
              callbackURL: "/",
            })
          : await authClient.signIn.email({
              email: email.trim(),
              password,
              callbackURL: "/",
            });
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

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-4 py-10">
      <p className="font-display text-5xl font-bold uppercase leading-none tracking-wide text-ink">
        {t("appName")}
      </p>
      <h1 className="mt-3 text-xl font-semibold text-ink">{t("welcome")}</h1>
      <p className="mt-1 text-pretty text-muted">{t("tagline")}</p>

      <form onSubmit={onSubmit} className="mt-8 space-y-3 rounded-2xl border border-line bg-card p-4">
        <h2 className="font-display text-2xl font-semibold uppercase tracking-wide">
          {mode === "up" ? t("signUpTitle") : t("signInTitle")}
        </h2>
        {mode === "up" ? (
          <label className="block text-sm font-medium">
            {t("name")}
            <input
              id="name"
              required
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 h-12 w-full rounded-lg border border-line bg-paper px-3 text-base"
            />
          </label>
        ) : null}
        <label className="block text-sm font-medium">
          {t("email")}
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 h-12 w-full rounded-lg border border-line bg-paper px-3 text-base"
          />
        </label>
        <label className="block text-sm font-medium">
          {t("password")}
          <input
            id="password"
            type="password"
            required
            minLength={8}
            autoComplete={mode === "up" ? "new-password" : "current-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 h-12 w-full rounded-lg border border-line bg-paper px-3 text-base"
          />
        </label>
        <p className="text-sm text-muted">{t("passwordHint")}</p>
        {error ? (
          <p className="text-sm font-medium text-ink" role="alert">
            {error}
          </p>
        ) : null}
        <button
          id="auth-submit"
          type="submit"
          disabled={busy}
          className="h-12 w-full rounded-xl bg-espresso text-base font-semibold text-foam disabled:opacity-60"
        >
          {mode === "up" ? t("signUpTitle") : t("signInTitle")}
        </button>
        <button
          type="button"
          className="h-11 w-full text-sm font-medium text-muted underline-offset-2 hover:underline"
          onClick={() => {
            setMode(mode === "up" ? "in" : "up");
            setError("");
          }}
        >
          {mode === "up" ? t("haveAccount") : t("needAccount")}
        </button>
        {mode === "up" ? <p className="text-sm text-muted">{t("firstAdmin")}</p> : null}
      </form>

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
    </main>
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

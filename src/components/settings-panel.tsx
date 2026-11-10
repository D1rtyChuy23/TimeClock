import { useEffect, useState, type ReactNode } from "react";
import { Check, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import {
  DEFAULT_APPEARANCE,
  DENSITIES,
  MODES,
  MOTIONS,
  SCHEMES,
  SCHEME_SWATCHES,
  TEXT_SIZES,
  readAppearance,
  saveAppearance,
  type Appearance,
} from "@/lib/appearance";
import { useI18n, type CopyKey, type Lang } from "@/lib/i18n";

type Option = { value: string; label: string; note?: string; extra?: ReactNode };

/** One setting as a set of large radio cards. Native radios, so arrow keys and screen readers work. */
function Choice({
  name,
  legend,
  options,
  value,
  onChange,
  columns = "sm:grid-cols-3",
  hint,
}: {
  name: string;
  legend: string;
  options: Option[];
  value: string;
  onChange: (value: string) => void;
  columns?: string;
  hint?: string;
}) {
  return (
    <section className="panel p-4 sm:p-6">
      <fieldset data-setting={name}>
        <legend className="font-display text-[1.75rem] font-bold leading-tight">{legend}</legend>
        <div className={"mt-3 grid gap-2 " + columns}>
          {options.map((o) => (
            <label key={o.value} className="relative block cursor-pointer">
              <input
                type="radio"
                name={name}
                value={o.value}
                checked={value === o.value}
                onChange={() => onChange(o.value)}
                className="peer sr-only"
              />
              <span
                className={
                  "flex h-full min-h-14 flex-col justify-center gap-1 rounded-xl border-2 border-line bg-paper px-3 py-3 pr-10 " +
                  "peer-checked:border-pine peer-checked:bg-paper-2 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-pine"
                }
              >
                {o.extra}
                <span className="font-semibold">{o.label}</span>
                {o.note ? <span className="text-sm text-muted">{o.note}</span> : null}
              </span>
              <Check
                className="invisible absolute top-3 right-3 size-5 text-pine peer-checked:visible"
                aria-hidden="true"
              />
            </label>
          ))}
        </div>
        {hint ? <p className="mt-3 text-sm text-muted">{hint}</p> : null}
      </fieldset>
    </section>
  );
}

const TEXT_SAMPLE_SIZE: Record<Appearance["text"], string> = { default: "text-2xl", large: "text-3xl", xlarge: "text-4xl" };

/** Display settings: theme, color scheme, text size, spacing, motion and language. Saved on this device. */
export function SettingsPanel() {
  const { t, lang, setLang } = useI18n();
  // Read after mount: the server render has no access to this device's saved choice.
  const [a, setA] = useState<Appearance>(DEFAULT_APPEARANCE);
  useEffect(() => setA(readAppearance()), []);
  const update = (patch: Partial<Appearance>) => {
    const next = { ...a, ...patch };
    setA(next);
    saveAppearance(next);
  };

  return (
    <div className="space-y-4" id="settings">
      <section className="panel p-4 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="font-display text-[1.75rem] font-bold leading-tight">{t("settingsTitle")}</h1>
            <p className="mt-1 max-w-prose text-sm text-pretty text-muted">{t("settingsLead")}</p>
          </div>
          <button
            type="button"
            id="reset-settings"
            onClick={() => {
              setA(DEFAULT_APPEARANCE);
              saveAppearance(DEFAULT_APPEARANCE);
              toast.success(t("settingsReset"));
            }}
            className="inline-flex h-11 shrink-0 items-center gap-2 rounded-lg border border-line bg-paper px-3 text-sm font-semibold"
          >
            <RotateCcw className="size-4" aria-hidden="true" />
            {t("resetSettings")}
          </button>
        </div>
      </section>

      <Choice
        name="scheme"
        legend={t("setScheme")}
        value={a.scheme}
        onChange={(v) => update({ scheme: v as Appearance["scheme"] })}
        options={SCHEMES.map((s) => ({
          value: s,
          label: t(`scheme_${s}` as CopyKey),
          note: t(`scheme_${s}Note` as CopyKey),
          extra: (
            <span className="mb-1 flex gap-1" aria-hidden="true">
              {SCHEME_SWATCHES[s].map((c) => (
                <span key={c} className="size-6 rounded-full ring-1 ring-black/15" style={{ backgroundColor: c }} />
              ))}
            </span>
          ),
        }))}
      />

      <Choice
        name="mode"
        legend={t("setMode")}
        value={a.mode}
        onChange={(v) => update({ mode: v as Appearance["mode"] })}
        options={MODES.map((m) => ({ value: m, label: t(`mode_${m}` as CopyKey) }))}
      />

      <Choice
        name="text"
        legend={t("setText")}
        value={a.text}
        onChange={(v) => update({ text: v as Appearance["text"] })}
        options={TEXT_SIZES.map((s) => ({
          value: s,
          label: t(`text_${s}` as CopyKey),
          extra: (
            <span className={"font-display font-bold leading-none " + TEXT_SAMPLE_SIZE[s]} aria-hidden="true">
              Aa
            </span>
          ),
        }))}
      />

      <Choice
        name="density"
        legend={t("setDensity")}
        value={a.density}
        onChange={(v) => update({ density: v as Appearance["density"] })}
        options={DENSITIES.map((d) => ({
          value: d,
          label: t(`density_${d}` as CopyKey),
          note: t(`density_${d}Note` as CopyKey),
        }))}
      />

      <Choice
        name="motion"
        legend={t("setMotion")}
        value={a.motion}
        onChange={(v) => update({ motion: v as Appearance["motion"] })}
        columns="sm:grid-cols-2"
        hint={t("motionNote")}
        options={MOTIONS.map((m) => ({ value: m, label: t(`motion_${m}` as CopyKey) }))}
      />

      <Choice
        name="language"
        legend={t("setLanguage")}
        value={lang}
        onChange={(v) => setLang(v as Lang)}
        columns="sm:grid-cols-2"
        options={[
          { value: "en", label: "English" },
          { value: "es", label: "Español" },
        ]}
      />
    </div>
  );
}

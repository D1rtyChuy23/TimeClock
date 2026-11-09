import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

const en = {
  appName: "Time Clock",
  tagline: "Clock in, hours, and days off. One button.",
  boot: "Loading…",
  clockIn: "Clock in",
  clockOut: "Clock out",
  working: "On the clock",
  notWorking: "Clocked out",
  since: "Since {time}",
  today: "Today",
  thisWeek: "This week",
  lastWeek: "Last week",
  ptoLeft: "PTO left",
  hours: "hours",
  elapsed: "Elapsed",
  shifts: "Recent shifts",
  noShifts: "No shifts yet. Clock in when your day starts.",
  openShift: "Still open",
  manual: "Entered by an admin",
  ptoTitle: "PTO request",
  ptoLead: "Ask here. An admin approves it, then it shows on the calendar for everyone.",
  day: "Date",
  ptoHours: "Hours",
  note: "Note",
  notePh: "Optional — appointment, family…",
  send: "Send request",
  cancel: "Cancel",
  pending: "Pending",
  approved: "Approved",
  denied: "Denied",
  noPto: "No requests yet.",
  ptoHint: "Left this year: allowance minus approved hours.",
  cancelRequest: "Cancel request",
  confirmCancel: "Yes, cancel",
  myRequests: "My requests",
  hoursBack: "Canceling an approved day puts those hours back.",
  calendarTitle: "Calendar",
  calLead: "Shop closures and approved time off. Pending requests stay private until an admin says yes.",
  legendClosed: "Closed",
  legendYou: "Your PTO",
  legendOthers: "Coworker off",
  legendPending: "Waiting",
  nothingDay: "Nobody is off.",
  prevMonth: "Previous month",
  nextMonth: "Next month",
  thisDay: "This day",
  requestThisDay: "Request this day",
  daysOff: "Days off",
  noHolidays: "No days off on the calendar yet.",
  nextOff: "Next day off: {name} · in {n} days",
  nextOff1: "Next day off: {name} · tomorrow",
  todayOff: "Today is {name}. We're off.",
  team: "Team",
  mine: "My time",
  onClockCount: "{n} on the clock",
  pendingCount: "{n} waiting",
  allowance: "PTO hours this year",
  save: "Save",
  approve: "Approve",
  deny: "Deny",
  delete: "Delete",
  addShift: "Add a missed shift",
  from: "Start",
  to: "End",
  add: "Add shift",
  shiftHint: "Overnight is fine. 16 hours max.",
  forceOut: "Clock out now",
  makeAdmin: "Make admin",
  makeEmployee: "Make employee",
  you: "You",
  admin: "Admin",
  employee: "Employee",
  addHoliday: "Add a day off",
  holidayName: "Name",
  holidayPh: "Thanksgiving, Christmas…",
  emptyTeam: "No one else yet. They show up here after they create an account.",
  language: "Language",
  signInTitle: "Sign in",
  signUpTitle: "Create an account",
  name: "Full name",
  email: "Email",
  password: "Password",
  passwordHint: "At least 8 characters.",
  haveAccount: "Already have an account? Sign in",
  needAccount: "New here? Create an account",
  continueWith: "Continue with {name}",
  or: "or",
  welcome: "Your team clock",
  firstAdmin: "The first account becomes the admin.",
  errGeneric: "Something went wrong. Try again.",
  errNotAllowed: "You can't do that.",
  errTooLong: "A shift can't be longer than 16 hours.",
  errBadRange: "The end has to be after the start.",
  errFuture: "That time is still in the future.",
  errBadHours: "Enter hours between 0 and 24.",
  errBadDay: "Pick a real date.",
  errBadNote: "Keep the note under 200 characters.",
  errBadName: "Add a name, up to 60 characters.",
  errLastAdmin: "The team needs at least one admin.",
  errDuplicate: "That day is already on the list.",
  errNotOpen: "They're already clocked out.",
  errNotFound: "That isn't there anymore.",
  errAlreadyIn: "You were already clocked in.",
  errAlreadyOut: "You were already clocked out.",
  errChanged: "Someone already changed that. Here is the latest.",
  errBadLogin: "That email or password is wrong.",
  errEmailTaken: "That email already has an account. Sign in instead.",
  errPasswordShort: "The password needs at least 8 characters.",
  staleNotice: "No connection. This may be out of date.",
  reopen: "Undo",
  signOut: "Sign out",
  signingOut: "Signing out…",
  saved: "Saved",
  clockedIn: "Clocked in",
  clockedOut: "Clocked out",
  sent: "Request sent",
  removed: "Removed",
  updated: "Updated",
  yesDelete: "Delete",
  keep: "Keep",
  weekNote: "Weeks run Monday through Sunday.",
  shiftsFor: "Shifts · last 90 days",
  requests: "Requests",
  retry: "Try again",
  loadError: "Couldn't load the clock.",
  earlier: "Recent days off",
  status: "Status",
};

const es: Record<keyof typeof en, string> = {
  appName: "Reloj",
  tagline: "Entrada, horas y días libres. Un botón.",
  boot: "Cargando…",
  clockIn: "Entrar",
  clockOut: "Salir",
  working: "En el reloj",
  notWorking: "Fuera",
  since: "Desde las {time}",
  today: "Hoy",
  thisWeek: "Esta semana",
  lastWeek: "Semana pasada",
  ptoLeft: "PTO restante",
  hours: "horas",
  elapsed: "Transcurrido",
  shifts: "Turnos recientes",
  noShifts: "Aún no hay turnos. Entra cuando empiece tu día.",
  openShift: "Sigue abierto",
  manual: "Lo capturó un administrador",
  ptoTitle: "Solicitud de PTO",
  ptoLead: "Pídelo aquí. Un administrador lo aprueba y luego aparece en el calendario de todos.",
  day: "Fecha",
  ptoHours: "Horas",
  note: "Nota",
  notePh: "Opcional — cita, familia…",
  send: "Enviar solicitud",
  cancel: "Cancelar",
  pending: "Pendiente",
  approved: "Aprobado",
  denied: "Negado",
  noPto: "Aún no hay solicitudes.",
  ptoHint: "Lo que queda este año: la asignación menos las horas aprobadas.",
  cancelRequest: "Cancelar solicitud",
  confirmCancel: "Sí, cancelar",
  myRequests: "Mis solicitudes",
  hoursBack: "Si cancelas un día ya aprobado, esas horas regresan.",
  calendarTitle: "Calendario",
  calLead: "Días cerrados y tiempo libre aprobado. Lo pendiente se queda en privado hasta que un administrador diga que sí.",
  legendClosed: "Cerrado",
  legendYou: "Tu PTO",
  legendOthers: "Compañero libre",
  legendPending: "En espera",
  nothingDay: "Nadie está libre.",
  prevMonth: "Mes anterior",
  nextMonth: "Mes siguiente",
  thisDay: "Este día",
  requestThisDay: "Pedir este día",
  daysOff: "Días libres",
  noHolidays: "Todavía no hay días libres en el calendario.",
  nextOff: "Próximo día libre: {name} · en {n} días",
  nextOff1: "Próximo día libre: {name} · mañana",
  todayOff: "Hoy es {name}. No trabajamos.",
  team: "Equipo",
  mine: "Mi tiempo",
  onClockCount: "{n} en el reloj",
  pendingCount: "{n} en espera",
  allowance: "Horas de PTO este año",
  save: "Guardar",
  approve: "Aprobar",
  deny: "Negar",
  delete: "Borrar",
  addShift: "Agregar un turno que faltó",
  from: "Inicio",
  to: "Fin",
  add: "Agregar turno",
  shiftHint: "Puede cruzar la medianoche. Máximo 16 horas.",
  forceOut: "Sacar del reloj",
  makeAdmin: "Hacer administrador",
  makeEmployee: "Quitar administrador",
  you: "Tú",
  admin: "Admin",
  employee: "Empleado",
  addHoliday: "Agregar un día libre",
  holidayName: "Nombre",
  holidayPh: "Acción de Gracias, Navidad…",
  emptyTeam: "Todavía no hay nadie más. Aparecen aquí cuando crean su cuenta.",
  language: "Idioma",
  signInTitle: "Entrar",
  signUpTitle: "Crear cuenta",
  name: "Nombre completo",
  email: "Correo",
  password: "Contraseña",
  passwordHint: "Mínimo 8 caracteres.",
  haveAccount: "¿Ya tienes cuenta? Entra",
  needAccount: "¿Eres nuevo? Crea una cuenta",
  continueWith: "Continuar con {name}",
  or: "o",
  welcome: "El reloj del equipo",
  firstAdmin: "La primera cuenta queda como administrador.",
  errGeneric: "Algo salió mal. Inténtalo de nuevo.",
  errNotAllowed: "No puedes hacer eso.",
  errTooLong: "Un turno no puede pasar de 16 horas.",
  errBadRange: "La hora de salida tiene que ser después de la entrada.",
  errFuture: "Esa hora todavía no llega.",
  errBadHours: "Las horas tienen que estar entre 0 y 24.",
  errBadDay: "Elige una fecha real.",
  errBadNote: "La nota no puede pasar de 200 caracteres.",
  errBadName: "Escribe un nombre, máximo 60 caracteres.",
  errLastAdmin: "El equipo necesita al menos un administrador.",
  errDuplicate: "Ese día ya está en la lista.",
  errNotOpen: "Esa persona ya salió.",
  errNotFound: "Eso ya no está.",
  saved: "Guardado",
  clockedIn: "Entrada registrada",
  clockedOut: "Salida registrada",
  sent: "Solicitud enviada",
  removed: "Eliminado",
  updated: "Actualizado",
  yesDelete: "Borrar",
  keep: "Dejar",
  weekNote: "La semana va de lunes a domingo.",
  shiftsFor: "Turnos · últimos 90 días",
  requests: "Solicitudes",
  retry: "Reintentar",
  loadError: "No se pudo cargar el reloj.",
  errAlreadyIn: "Ya habías entrado.",
  errAlreadyOut: "Ya habías salido.",
  errChanged: "Alguien ya cambió eso. Aquí está lo más reciente.",
  errBadLogin: "El correo o la contraseña no son correctos.",
  errEmailTaken: "Ese correo ya tiene una cuenta. Inicia sesión.",
  errPasswordShort: "La contraseña necesita al menos 8 caracteres.",
  staleNotice: "Sin conexión. Esto puede no estar al día.",
  reopen: "Deshacer",
  signOut: "Cerrar sesión",
  signingOut: "Cerrando sesión…",
  earlier: "Días libres recientes",
  status: "Estado",
};

export type Lang = "en" | "es";
export type CopyKey = keyof typeof en;

type I18nValue = {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: CopyKey, vars?: Record<string, string | number>) => string;
};

const I18nContext = createContext<I18nValue | null>(null);

function readLang(): Lang {
  try {
    const saved = localStorage.getItem("tc-lang");
    if (saved === "en" || saved === "es") return saved;
    return navigator.language.toLowerCase().startsWith("es") ? "es" : "en";
  } catch {
    return "es";
  }
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>("es");

  useEffect(() => {
    const next = readLang();
    setLangState(next);
    document.documentElement.lang = next;
    try {
      localStorage.setItem("tc-lang", next);
    } catch {
      /* ignore */
    }
  }, []);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    document.documentElement.lang = next;
    try {
      localStorage.setItem("tc-lang", next);
    } catch {
      /* ignore */
    }
  }, []);

  const t = useCallback(
    (key: CopyKey, vars?: Record<string, string | number>) => {
      let s: string = lang === "es" ? es[key] : en[key];
      if (vars) {
        for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
      }
      return s;
    },
    [lang],
  );

  return <I18nContext.Provider value={{ lang, setLang, t }}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("LanguageProvider missing");
  return ctx;
}

const ERROR_KEYS: Record<string, CopyKey> = {
  not_allowed: "errNotAllowed",
  not_found: "errNotFound",
  too_long: "errTooLong",
  bad_range: "errBadRange",
  future: "errFuture",
  bad_hours: "errBadHours",
  bad_day: "errBadDay",
  bad_note: "errBadNote",
  bad_name: "errBadName",
  last_admin: "errLastAdmin",
  duplicate: "errDuplicate",
  not_open: "errNotOpen",
  already_in: "errAlreadyIn",
  already_out: "errAlreadyOut",
  changed: "errChanged",
  error: "errGeneric",
};

export function errorCopyKey(code: string): CopyKey {
  return ERROR_KEYS[code] ?? "errGeneric";
}

/** Better Auth error code -> copy, so sign-in problems are explained in the person's language. */
export function authErrorCopyKey(code: string | undefined): CopyKey | null {
  if (!code) return null;
  if (code === "INVALID_EMAIL_OR_PASSWORD") return "errBadLogin";
  if (code.startsWith("USER_ALREADY_EXISTS")) return "errEmailTaken";
  if (code === "PASSWORD_TOO_SHORT") return "errPasswordShort";
  return null;
}

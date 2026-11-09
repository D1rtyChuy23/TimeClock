/**
 * Outgoing email (server-only). Sends through Resend's HTTP API, so there is no
 * extra dependency. Set two environment variables where the app is deployed:
 *
 *   RESEND_API_KEY   an API key from resend.com
 *   EMAIL_FROM       e.g. "Time Clock <clock@yourdomain.com>" (a sender Resend has verified)
 *
 * Until both are set nothing is emailed: invitations still work by copying the
 * link, and the sign-in screen says password reset by email is not set up.
 */
import { env } from "@/lib/env.server";

export function emailConfigured(): boolean {
  return Boolean(env("RESEND_API_KEY") && env("EMAIL_FROM"));
}

export type Email = { to: string; subject: string; text: string; html: string };

/** Resolves true when the provider accepted the message. Never throws. */
export async function sendEmail(mail: Email): Promise<boolean> {
  const key = env("RESEND_API_KEY");
  const from = env("EMAIL_FROM");
  if (!key || !from) {
    // Local development: show the message (and its link) in the server log instead.
    if (process.env.NODE_ENV !== "production") console.info("[email] not configured, would send:", mail.to, mail.subject, "\n" + mail.text);
    return false;
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [mail.to], subject: mail.subject, text: mail.text, html: mail.html }),
    });
    if (!res.ok) console.error("[email] send failed", res.status, await res.text());
    return res.ok;
  } catch (e) {
    console.error("[email] send failed", e);
    return false;
  }
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

/** One message in English and Spanish: we do not know which the reader prefers. */
function bilingual(to: string, subject: string, en: string, es: string, button: string, link: string): Email {
  const text = `${en}\n\n${link}\n\n———\n\n${es}\n\n${link}\n`;
  const block = (body: string) => `<p style="font-size:16px;line-height:1.5;margin:0 0 16px">${escapeHtml(body)}</p>`;
  const html =
    `<div style="font-family:Arial,Helvetica,sans-serif;color:#2b1d14;max-width:480px">` +
    block(en) +
    `<p style="margin:0 0 24px"><a href="${escapeHtml(link)}" style="display:inline-block;background:#3f2a1d;color:#ffffff;` +
    `text-decoration:none;font-weight:bold;padding:14px 22px;border-radius:10px">${escapeHtml(button)}</a></p>` +
    `<hr style="border:0;border-top:1px solid #dddddd;margin:0 0 16px">` +
    block(es) +
    `<p style="font-size:13px;color:#666666;word-break:break-all;margin:0">${escapeHtml(link)}</p></div>`;
  return { to, subject, text, html };
}

export function inviteEmail(to: string, inviter: string, link: string, days: number): Email {
  const who = inviter || "Your admin";
  const quien = inviter || "Tu administrador";
  return bilingual(
    to,
    "You're invited to the Time Clock / Te invitaron al Reloj",
    `${who} invited you to the team Time Clock. Open the link to create your account. It works for ${days} days.`,
    `${quien} te invitó al Reloj del equipo. Abre el enlace para crear tu cuenta. Funciona durante ${days} días.`,
    "Create my account / Crear mi cuenta",
    link,
  );
}

export function resetEmail(to: string, link: string): Email {
  return bilingual(
    to,
    "Reset your Time Clock password / Restablece tu contraseña del Reloj",
    "Someone asked to reset the password for this Time Clock account. Open the link to choose a new one. If it wasn't you, ignore this email and nothing changes.",
    "Alguien pidió restablecer la contraseña de esta cuenta del Reloj. Abre el enlace para elegir una nueva. Si no fuiste tú, ignora este correo y nada cambia.",
    "Choose a new password / Elegir contraseña nueva",
    link,
  );
}

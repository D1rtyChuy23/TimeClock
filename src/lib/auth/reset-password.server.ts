/**
 * Password reset by email (server-only). Spread into Better Auth's
 * `emailAndPassword` options in `./server`. Better Auth creates the one-time
 * token and the link; this only delivers it.
 */
import type { BetterAuthOptions } from "better-auth";

export const resetPasswordOptions: Partial<NonNullable<BetterAuthOptions["emailAndPassword"]>> = {
  resetPasswordTokenExpiresIn: 60 * 60, // seconds
  // Changing the password ends every other session. A device already signed in notices
  // within a few minutes, when its cached session cookie (see `session.cookieCache`) runs out.
  revokeSessionsOnPasswordReset: true,
  sendResetPassword: async ({ user, url }) => {
    const { resetEmail, sendEmail } = await import("@/lib/email.server");
    // Not awaited by design: answering in the same time whether or not the
    // address has an account keeps the form from revealing who is registered.
    void sendEmail(resetEmail(user.email, url));
  },
};

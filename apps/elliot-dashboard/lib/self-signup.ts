// Can anyone open an agency account from the sign-in page?
//
// Off unless NEXT_PUBLIC_SELF_SIGNUP_ENABLED is exactly "true". Agencies are
// set up by the Elliot administrator (control panel -> New agency), so by
// default the sign-in page has no "Create a business" tab and
// /api/tenants/signup refuses. An open sign-up would let anyone on the
// internet create an agency and run Elliot on our account.
export function selfSignupEnabled(): boolean {
  return process.env.NEXT_PUBLIC_SELF_SIGNUP_ENABLED === "true";
}

/** Sign-up links a brand-new account only: created in the last few minutes. */
export const NEW_ACCOUNT_WINDOW_MS = 15 * 60 * 1000;
export function isNewAccount(createdAt: string | null | undefined, now: number = Date.now()): boolean {
  if (!createdAt) return false;
  const t = new Date(createdAt).getTime();
  return Number.isFinite(t) && now - t >= 0 && now - t <= NEW_ACCOUNT_WINDOW_MS;
}

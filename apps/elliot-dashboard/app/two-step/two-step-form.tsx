"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Setup = { factorId: string; qr: string; secret: string };

// Supabase MFA (TOTP). "enroll": create the authenticator entry, show its QR
// code, confirm the first code. "verify": enter the current code.
export default function TwoStepForm({ mode, email }: { mode: "enroll" | "verify"; email: string }) {
  const supabase = createClient();
  const [setup, setSetup] = useState<Setup | null>(null);
  const [factorId, setFactorId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showSecret, setShowSecret] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.auth.mfa.listFactors();
      if (error) return !cancelled && setError(error.message);
      if (mode === "verify") {
        const f = data?.totp?.[0];
        if (!f) return !cancelled && setError("No authenticator app found. Reload the page to set one up.");
        return !cancelled && setFactorId(f.id);
      }
      // A set-up that was started but never confirmed would block a new one.
      for (const f of data?.all ?? []) {
        if (f.factor_type === "totp" && f.status !== "verified") await supabase.auth.mfa.unenroll({ factorId: f.id });
      }
      const res = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: "Elliot control panel" });
      if (cancelled) return;
      if (res.error || !res.data) return setError(res.error?.message || "Couldn't start the set-up.");
      // Supabase gives the QR code as a raw SVG data URL; encode it so every browser shows it.
      const raw = res.data.totp.qr_code;
      const m = /^data:image\/svg\+xml;utf-8,([\s\S]*)$/.exec(raw);
      const qr = m ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(m[1])}` : raw;
      setSetup({ factorId: res.data.id, qr, secret: res.data.totp.secret });
      setFactorId(res.data.id);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!factorId) return;
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: code.replace(/\s+/g, "") });
    if (error) {
      setBusy(false);
      setError(/invalid|expired/i.test(error.message) ? "That code didn't work. Enter the current 6-digit code from the app." : error.message);
      return;
    }
    window.location.href = "/platform";
  }

  return (
    <form onSubmit={submit}>
      <h1 className="m-0 text-[18px] font-semibold text-ink">{mode === "enroll" ? "Set up two-step sign-in" : "Two-step sign-in"}</h1>
      <p className="m-0 mt-1 mb-4 text-[13px] text-gray-500">
        {mode === "enroll"
          ? "The control panel can open agencies' accounts, so it needs a code from your phone as well as your password. You do this once."
          : `Enter the 6-digit code from your authenticator app for ${email}.`}
      </p>

      {mode === "enroll" && (
        <ol className="m-0 mb-4 list-decimal pl-5 text-[13px] text-gray-700">
          <li>Install an authenticator app (Google Authenticator, Microsoft Authenticator or 1Password).</li>
          <li>In the app, add an account and scan this code.</li>
          <li>Enter the 6-digit code the app shows.</li>
        </ol>
      )}

      {mode === "enroll" && (
        <div className="mb-4 flex flex-col items-center gap-2">
          {setup ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={setup.qr} alt="QR code for your authenticator app" width={180} height={180} className="rounded-lg border border-gray-200 bg-glass p-2" />
          ) : (
            !error && <div className="h-[180px] w-[180px] animate-pulse rounded-lg bg-gray-100" aria-label="Loading" />
          )}
          {setup && (
            <button type="button" onClick={() => setShowSecret((v) => !v)} className="cursor-pointer border-0 bg-transparent text-[12.5px] text-gray-500 underline">
              {showSecret ? "Hide the key" : "Can't scan? Type a key instead"}
            </button>
          )}
          {setup && showSecret && <code className="break-all rounded bg-gray-50 px-2 py-1 text-[12.5px]">{setup.secret}</code>}
        </div>
      )}

      <label className="mb-1 block text-[12.5px] font-medium text-gray-700" htmlFor="two-step-code">
        Code from the app
      </label>
      <input
        id="two-step-code"
        className="h-10 w-full px-3 text-center font-mono text-[18px] tracking-[0.3em]"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={7}
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, ""))}
        placeholder="123456"
        autoFocus
      />
      {error && <p className="m-0 mt-2 text-[12.5px] text-alert">{error}</p>}
      <button
        type="submit"
        disabled={busy || !factorId || code.replace(/\s+/g, "").length !== 6}
        className="mt-4 inline-flex h-10 w-full cursor-pointer items-center justify-center rounded-full border-0 gold-fill px-4 text-[14px] font-semibold text-navy shadow-gold hover:brightness-[1.04] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? "Checking…" : mode === "enroll" ? "Turn on and continue" : "Continue"}
      </button>
    </form>
  );
}

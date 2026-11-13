"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { ElliotLogo } from "@/app/_ui/elliot-logo";

export default function ForgotPasswordPage() {
  const supabase = createClient();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });

    setLoading(false);
    // Always show the same success state regardless of whether the email
    // exists -- don't let this form be used to enumerate registered emails.
    if (error) {
      setError(error.message);
      return;
    }
    setSent(true);
  }

  return (
    <div className="sky flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-[380px]">
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <ElliotLogo />
        </div>
      <div className="card p-7">
        <h1 className="m-0 mb-2 text-[20px] font-semibold text-ink">Reset your password</h1>

        {sent ? (
          <p className="m-0 text-[14px] leading-relaxed text-gray-600">
            If an account exists for <strong>{email}</strong>, we&apos;ve sent a link to reset the password.
          </p>
        ) : (
          <form onSubmit={handleSubmit}>
            <p className="mb-4 mt-0 text-[13px] text-gray-500">
              Enter the email on your account and we&apos;ll send you a reset link.
            </p>
            <label className="mb-1 block text-[13px] font-medium text-gray-700">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="mb-4 h-10 w-full px-3"
            />

            {error && <p className="mb-3 mt-0 text-[13px] text-alert" role="alert">{error}</p>}

            <button
              type="submit"
              disabled={loading}
              className="inline-flex h-10 w-full cursor-pointer items-center justify-center rounded-full border-0 gold-fill text-[14px] font-semibold text-navy shadow-gold hover:brightness-[1.04] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? "Sending..." : "Send reset link"}
            </button>
          </form>
        )}

        <p className="mb-0 mt-4 text-center">
          <Link href="/login" className="text-[13px] text-gray-500 hover:text-ink">
            Back to sign in
          </Link>
        </p>
      </div>
      </div>
    </div>
  );
}

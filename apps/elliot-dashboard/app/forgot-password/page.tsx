"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

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
    <div style={{ display: "flex", minHeight: "100vh", alignItems: "center", justifyContent: "center" }}>
      <div style={{ width: 340, padding: 32, background: "white", borderRadius: 12, boxShadow: "0 1px 4px rgba(0,0,0,0.08)" }}>
        <h1 style={{ fontSize: 20, marginBottom: 8 }}>Reset your password</h1>

        {sent ? (
          <p style={{ fontSize: 14, color: "#555", lineHeight: 1.5 }}>
            If an account exists for <strong>{email}</strong>, we&apos;ve sent a link to reset the password.
          </p>
        ) : (
          <form onSubmit={handleSubmit}>
            <p style={{ fontSize: 13, color: "#666", marginBottom: 16 }}>
              Enter the email on your account and we&apos;ll send you a reset link.
            </p>
            <label style={{ display: "block", fontSize: 13, marginBottom: 4 }}>Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              style={{ width: "100%", padding: 8, marginBottom: 16, border: "1px solid #ddd", borderRadius: 6 }}
            />

            {error && <p style={{ color: "crimson", fontSize: 13, marginBottom: 12 }}>{error}</p>}

            <button
              type="submit"
              disabled={loading}
              style={{ width: "100%", padding: 10, background: "#111", color: "white", border: "none", borderRadius: 6, cursor: "pointer" }}
            >
              {loading ? "Sending..." : "Send reset link"}
            </button>
          </form>
        )}

        <p style={{ textAlign: "center", marginTop: 16 }}>
          <Link href="/login" style={{ fontSize: 13, color: "#666" }}>
            Back to sign in
          </Link>
        </p>
      </div>
    </div>
  );
}

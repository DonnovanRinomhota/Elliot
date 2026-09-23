"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// Supabase's browser client has detectSessionInUrl on by default, so when
// the user arrives here from the emailed recovery link it automatically
// exchanges the URL's recovery token for a temporary session -- no manual
// token handling needed here. We just wait for that session to show up
// before letting them submit a new password.
export default function ResetPasswordPage() {
  const router = useRouter();
  const supabase = createClient();

  const [ready, setReady] = useState(false);
  const [invalidLink, setInvalidLink] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        if (!cancelled) setReady(true);
      }
    });

    // Also check directly in case the event already fired before this
    // component mounted (can happen depending on load timing).
    supabase.auth.getSession().then(({ data }) => {
      if (!cancelled && data.session) setReady(true);
    });

    // If neither the event nor an existing session shows up shortly, the
    // link was likely invalid or expired.
    const timeout = setTimeout(() => {
      if (!cancelled) {
        setReady((current) => {
          if (!current) setInvalidLink(true);
          return current;
        });
      }
    }, 4000);

    return () => {
      cancelled = true;
      subscription.unsubscribe();
      clearTimeout(timeout);
    };
  }, [supabase]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }

    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);

    if (error) {
      setError(error.message);
      return;
    }
    setDone(true);
  }

  return (
    <div style={{ display: "flex", minHeight: "100vh", alignItems: "center", justifyContent: "center" }}>
      <div style={{ width: 340, padding: 32, background: "white", borderRadius: 12, boxShadow: "0 1px 4px rgba(0,0,0,0.08)" }}>
        <h1 style={{ fontSize: 20, marginBottom: 16 }}>Set a new password</h1>

        {invalidLink && !ready && (
          <p style={{ fontSize: 14, color: "#555" }}>
            This reset link is invalid or has expired. Request a new one from the{" "}
            <a href="/forgot-password" style={{ color: "#111" }}>
              forgot password
            </a>{" "}
            page.
          </p>
        )}

        {!invalidLink && !ready && <p style={{ fontSize: 13, color: "#888" }}>Verifying link...</p>}

        {ready && !done && (
          <form onSubmit={handleSubmit}>
            <label style={{ display: "block", fontSize: 13, marginBottom: 4 }}>New password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              style={{ width: "100%", padding: 8, marginBottom: 16, border: "1px solid #ddd", borderRadius: 6 }}
            />

            <label style={{ display: "block", fontSize: 13, marginBottom: 4 }}>Confirm new password</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              minLength={8}
              style={{ width: "100%", padding: 8, marginBottom: 16, border: "1px solid #ddd", borderRadius: 6 }}
            />

            {error && <p style={{ color: "crimson", fontSize: 13, marginBottom: 12 }}>{error}</p>}

            <button
              type="submit"
              disabled={loading}
              style={{ width: "100%", padding: 10, background: "#111", color: "white", border: "none", borderRadius: 6, cursor: "pointer" }}
            >
              {loading ? "Saving..." : "Save new password"}
            </button>
          </form>
        )}

        {done && (
          <>
            <p style={{ fontSize: 14, color: "#555", marginBottom: 16 }}>
              Your password has been updated.
            </p>
            <button
              onClick={() => {
                router.push("/dashboard/approvals");
                router.refresh();
              }}
              style={{ width: "100%", padding: 10, background: "#111", color: "white", border: "none", borderRadius: 6, cursor: "pointer" }}
            >
              Go to dashboard
            </button>
          </>
        )}
      </div>
    </div>
  );
}

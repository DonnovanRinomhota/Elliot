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
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-[380px]">
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <span aria-hidden="true" className="flex h-8 w-8 items-center justify-center rounded-md bg-ink text-[14px] font-semibold text-white">
            E
          </span>
          <span className="text-[16px] font-semibold text-ink">Elliot</span>
        </div>
      <div className="rounded-lg border border-gray-200 bg-white p-7">
        <h1 className="m-0 mb-4 text-[20px] font-semibold text-ink">Set a new password</h1>

        {invalidLink && !ready && (
          <p className="m-0 text-[14px] leading-relaxed text-gray-600">
            This reset link is invalid or has expired. Request a new one from the{" "}
            <a href="/forgot-password" className="text-ink underline">
              forgot password
            </a>{" "}
            page.
          </p>
        )}

        {!invalidLink && !ready && <p className="m-0 text-[13px] text-gray-500">Verifying link...</p>}

        {ready && !done && (
          <form onSubmit={handleSubmit}>
            <label className="mb-1 block text-[13px] font-medium text-gray-700">New password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              className="mb-4 h-10 w-full px-3"
            />

            <label className="mb-1 block text-[13px] font-medium text-gray-700">Confirm new password</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              minLength={8}
              className="mb-4 h-10 w-full px-3"
            />

            {error && <p className="mb-3 mt-0 text-[13px] text-alert" role="alert">{error}</p>}

            <button
              type="submit"
              disabled={loading}
              className="inline-flex h-10 w-full cursor-pointer items-center justify-center rounded-md border-0 bg-ink text-[14px] font-medium text-white hover:bg-ink-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? "Saving..." : "Save new password"}
            </button>
          </form>
        )}

        {done && (
          <>
            <p className="mb-4 mt-0 text-[14px] leading-relaxed text-gray-600">
              Your password has been updated.
            </p>
            <button
              onClick={() => {
                router.push("/dashboard/approvals");
                router.refresh();
              }}
              className="inline-flex h-10 w-full cursor-pointer items-center justify-center rounded-md border-0 bg-ink text-[14px] font-medium text-white hover:bg-ink-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Go to dashboard
            </button>
          </>
        )}
      </div>
      </div>
    </div>
  );
}

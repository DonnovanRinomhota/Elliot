"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import PasswordInput from "../_ui/password-input";
import { ElliotLogo } from "@/app/_ui/elliot-logo";

type Mode = "sign-in" | "create-business";

export default function LoginPage() {
  const router = useRouter();
  const supabase = createClient();
  const [mode, setMode] = useState<Mode>("sign-in");

  // shared
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // create-business only
  const [tenantName, setTenantName] = useState("");
  const [fullName, setFullName] = useState("");
  const [confirmationSent, setConfirmationSent] = useState(false);

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const { error } = await supabase.auth.signInWithPassword({ email, password });

    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    router.push("/");
    router.refresh();
  }

  async function handleCreateBusiness(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!tenantName.trim() || !fullName.trim()) {
      setError("Business name and your name are required.");
      return;
    }

    setLoading(true);

    // 1. Create the auth user. With "Confirm email" enabled in Supabase
    //    (Authentication -> Providers -> Email), this sends the confirmation
    //    email automatically -- nothing else in this app needs to send it.
    const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName.trim() } },
    });

    if (signUpError) {
      setLoading(false);
      setError(signUpError.message);
      return;
    }

    const authUserId = signUpData.user?.id;
    if (!authUserId) {
      setLoading(false);
      setError("Something went wrong creating your account. Please try again.");
      return;
    }

    // 2. Provision the tenant + link this user to it as its first admin.
    //    Works even before the user confirms their email -- the auth user
    //    id already exists, confirmation only gates sign-in.
    const res = await fetch("/api/tenants/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantName: tenantName.trim(), authUserId, email }),
    });
    const data = await res.json();

    setLoading(false);
    if (!data.success) {
      setError(data.error ?? "Could not set up your business. Please try again.");
      return;
    }

    setConfirmationSent(true);
  }

  if (confirmationSent) {
    return (
      <AuthShell>
        <h1 className="m-0 mb-3 text-[20px] font-semibold text-ink">Check your email</h1>
        <p className="m-0 text-[14px] leading-relaxed text-gray-600">
          We sent a confirmation link to <strong>{email}</strong>. Click it, then come back and sign in.
        </p>
        <button
          onClick={() => {
            setConfirmationSent(false);
            setMode("sign-in");
            setPassword("");
          }}
          className="mt-5 inline-flex h-10 w-full cursor-pointer items-center justify-center rounded-full border-0 bg-ink text-[14px] font-medium text-white hover:bg-ink-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Back to sign in
        </button>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <div role="tablist" aria-label="Sign in or create a business" className="mb-6 grid grid-cols-2 gap-1 rounded-md bg-gray-100 p-1">
        <TabButton active={mode === "sign-in"} onClick={() => { setMode("sign-in"); setError(null); }}>
          Sign in
        </TabButton>
        <TabButton active={mode === "create-business"} onClick={() => { setMode("create-business"); setError(null); }}>
          Create a business
        </TabButton>
      </div>

      {mode === "sign-in" ? (
        <form onSubmit={handleSignIn}>
          <Field label="Email">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="h-10 w-full px-3"
            />
          </Field>
          <Field label="Password">
            <PasswordInput
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="h-10 w-full px-3"
            />
          </Field>

          {error && <p className="mb-3 mt-0 text-[13px] text-alert" role="alert">{error}</p>}

          <button type="submit" disabled={loading} className="inline-flex h-10 w-full cursor-pointer items-center justify-center rounded-full border-0 bg-ink text-[14px] font-medium text-white hover:bg-ink-800 disabled:cursor-not-allowed disabled:opacity-60">
            {loading ? "Signing in…" : "Sign in"}
          </button>

          <p className="mb-0 mt-4 text-center">
            <Link href="/forgot-password" className="text-[13px] text-gray-500 hover:text-ink">
              Forgot password?
            </Link>
          </p>
        </form>
      ) : (
        <form onSubmit={handleCreateBusiness}>
          <Field label="Business name">
            <input value={tenantName} onChange={(e) => setTenantName(e.target.value)} required className="h-10 w-full px-3" />
          </Field>
          <Field label="Your name">
            <input value={fullName} onChange={(e) => setFullName(e.target.value)} required className="h-10 w-full px-3" />
          </Field>
          <Field label="Email">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="h-10 w-full px-3"
            />
          </Field>
          <Field label="Password">
            <PasswordInput
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              className="h-10 w-full px-3"
            />
          </Field>

          {error && <p className="mb-3 mt-0 text-[13px] text-alert" role="alert">{error}</p>}

          <button type="submit" disabled={loading} className="inline-flex h-10 w-full cursor-pointer items-center justify-center rounded-full border-0 bg-ink text-[14px] font-medium text-white hover:bg-ink-800 disabled:cursor-not-allowed disabled:opacity-60">
            {loading ? "Creating…" : "Create business"}
          </button>
        </form>
      )}
    </AuthShell>
  );
}

function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-[380px]">
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <ElliotLogo size={34} className="text-ink" />
        </div>
        <div className="card p-7">{children}</div>
        <p className="mt-6 text-center text-[12.5px] text-gray-400">Your AI front office for leads, viewings and client messages.</p>
      </div>
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`h-9 cursor-pointer rounded border-0 text-[13px] font-medium ${active ? "bg-white text-ink shadow-sm" : "bg-transparent text-gray-500 hover:text-ink"}`}
    >
      {children}
    </button>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="mb-4 block">
      <span className="mb-1 block text-[13px] font-medium text-gray-700">{label}</span>
      {children}
    </label>
  );
}

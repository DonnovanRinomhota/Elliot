"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

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
    router.push("/dashboard/approvals");
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
        <h1 style={{ fontSize: 20, marginBottom: 12 }}>Check your email</h1>
        <p style={{ fontSize: 14, color: "#555", lineHeight: 1.5 }}>
          We sent a confirmation link to <strong>{email}</strong>. Click it, then come back and sign in.
        </p>
        <button
          onClick={() => {
            setConfirmationSent(false);
            setMode("sign-in");
            setPassword("");
          }}
          style={{
            marginTop: 20,
            width: "100%",
            padding: 10,
            background: "#111",
            color: "white",
            border: "none",
            borderRadius: 6,
            cursor: "pointer",
          }}
        >
          Back to sign in
        </button>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <div style={{ display: "flex", marginBottom: 24, border: "1px solid #ddd", borderRadius: 8, overflow: "hidden" }}>
        <TabButton active={mode === "sign-in"} onClick={() => { setMode("sign-in"); setError(null); }}>
          Sign In
        </TabButton>
        <TabButton active={mode === "create-business"} onClick={() => { setMode("create-business"); setError(null); }}>
          Create Business
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
              style={inputStyle}
            />
          </Field>
          <Field label="Password">
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              style={inputStyle}
            />
          </Field>

          {error && <p style={errorStyle}>{error}</p>}

          <button type="submit" disabled={loading} style={submitStyle}>
            {loading ? "Signing in..." : "Sign In"}
          </button>

          <p style={{ textAlign: "center", marginTop: 16 }}>
            <Link href="/forgot-password" style={{ fontSize: 13, color: "#666" }}>
              Forgot password?
            </Link>
          </p>
        </form>
      ) : (
        <form onSubmit={handleCreateBusiness}>
          <Field label="Business name">
            <input value={tenantName} onChange={(e) => setTenantName(e.target.value)} required style={inputStyle} />
          </Field>
          <Field label="Your name">
            <input value={fullName} onChange={(e) => setFullName(e.target.value)} required style={inputStyle} />
          </Field>
          <Field label="Email">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              style={inputStyle}
            />
          </Field>
          <Field label="Password">
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              style={inputStyle}
            />
          </Field>

          {error && <p style={errorStyle}>{error}</p>}

          <button type="submit" disabled={loading} style={submitStyle}>
            {loading ? "Creating..." : "Create Business"}
          </button>
        </form>
      )}
    </AuthShell>
  );
}

function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", minHeight: "100vh", alignItems: "center", justifyContent: "center" }}>
      <div style={{ width: 340, padding: 32, background: "white", borderRadius: 12, boxShadow: "0 1px 4px rgba(0,0,0,0.08)" }}>
        <h1 style={{ fontSize: 20, marginBottom: 24 }}>Elliot Dashboard</h1>
        {children}
      </div>
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        flex: 1,
        padding: "10px 0",
        border: "none",
        background: active ? "#111" : "white",
        color: active ? "white" : "#333",
        cursor: "pointer",
        fontSize: 13,
        fontWeight: 500,
      }}
    >
      {children}
    </button>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ display: "block", fontSize: 13, marginBottom: 4 }}>{label}</label>
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: 8,
  border: "1px solid #ddd",
  borderRadius: 6,
};

const errorStyle: React.CSSProperties = {
  color: "crimson",
  fontSize: 13,
  marginBottom: 12,
};

const submitStyle: React.CSSProperties = {
  width: "100%",
  padding: 10,
  background: "#111",
  color: "white",
  border: "none",
  borderRadius: 6,
  cursor: "pointer",
};

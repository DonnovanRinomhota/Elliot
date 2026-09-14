import "./globals.css";

// The true Next.js root layout -- wraps EVERY route including /login.
// Deliberately minimal: no auth check, no nav. Those live in
// app/(app)/layout.tsx instead, which only wraps the authenticated
// routes (the (app) route group doesn't affect URLs -- / is still /,
// /dashboard/leads is still /dashboard/leads).
//
// This split exists because putting the auth-redirect check here
// directly caused an infinite redirect loop: /login is also a route
// under app/, so it would ALSO be redirected to /login by this same
// layout, forever. Confirmed live via a real dev server before fixing.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, -apple-system, sans-serif", background: "#fafafa" }}>
        {children}
      </body>
    </html>
  );
}

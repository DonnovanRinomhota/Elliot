import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Elliot Dashboard",
  description: "Review and approve Elliot's pending actions",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", background: "#f7f7f8" }}>
        {children}
      </body>
    </html>
  );
}

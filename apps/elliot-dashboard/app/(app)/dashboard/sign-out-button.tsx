"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function SignOutButton() {
  const router = useRouter();
  const supabase = createClient();

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <button
      onClick={handleSignOut}
      style={{ padding: "8px 0", fontSize: 13, color: "#999", background: "none", border: "none", cursor: "pointer", textAlign: "left" }}
    >
      Sign out
    </button>
  );
}

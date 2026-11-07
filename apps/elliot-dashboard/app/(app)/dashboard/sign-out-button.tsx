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
      type="button"
      onClick={handleSignOut}
      className="h-8 flex-shrink-0 cursor-pointer whitespace-nowrap rounded-full border-0 bg-transparent px-2.5 text-left text-[13px] text-gray-500 hover:bg-gray-50 hover:text-ink"
    >
      Sign out
    </button>
  );
}

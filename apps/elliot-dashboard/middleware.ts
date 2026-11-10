import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isAdminEmail } from "@/lib/admin";

const PUBLIC_AUTH_ROUTES = ["/login", "/forgot-password", "/reset-password"];

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request: { headers: request.headers } });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          response.cookies.set({ name, value, ...options });
        },
        remove(name: string, options: CookieOptions) {
          response.cookies.set({ name, value: "", ...options });
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isDashboardRoute = path.startsWith("/dashboard") || path.startsWith("/platform") || path.startsWith("/two-step");
  const isLoginRoute = request.nextUrl.pathname.startsWith("/login");

  if (isDashboardRoute && !user) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  // Only /login bounces a signed-in user away. /reset-password stays
  // reachable even when signed in -- someone can land there from an emailed
  // recovery link while already having an active session.
  if (isLoginRoute && user) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  // 0040: while a platform admin is inside an agency's dashboard (with the
  // agency's permission), each part they open is recorded for the agency to
  // see in Settings. The database decides whether a view is active and keeps
  // one entry per part per 30 minutes; for everyone else this does nothing.
  const isPrefetch = request.headers.get("next-router-prefetch") === "1" || request.headers.get("purpose") === "prefetch";
  if (user && isAdminEmail(user.email) && !isPrefetch && (path === "/" || path.startsWith("/dashboard"))) {
    await supabase.rpc("log_support_visit", { p_path: path });
  }

  return response;
}

// NOTE: Next.js statically analyzes `matcher` at build time -- it must be a
// literal array, not built from PUBLIC_AUTH_ROUTES via spread/map (that
// silently falls back to matching every route instead of erroring, so this
// is worth getting right rather than "cleaning up" later).
export const config = {
  matcher: ["/", "/dashboard/:path*", "/platform/:path*", "/platform", "/two-step", "/login", "/forgot-password", "/reset-password"],
};

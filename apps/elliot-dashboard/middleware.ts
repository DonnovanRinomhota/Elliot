import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

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

  const isDashboardRoute = request.nextUrl.pathname.startsWith("/dashboard");
  const isLoginRoute = request.nextUrl.pathname.startsWith("/login");

  if (isDashboardRoute && !user) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  // Only /login bounces a signed-in user away. /reset-password stays
  // reachable even when signed in -- someone can land there from an emailed
  // recovery link while already having an active session.
  if (isLoginRoute && user) {
    return NextResponse.redirect(new URL("/dashboard/approvals", request.url));
  }

  return response;
}

// NOTE: Next.js statically analyzes `matcher` at build time -- it must be a
// literal array, not built from PUBLIC_AUTH_ROUTES via spread/map (that
// silently falls back to matching every route instead of erroring, so this
// is worth getting right rather than "cleaning up" later).
export const config = {
  matcher: ["/dashboard/:path*", "/login", "/forgot-password", "/reset-password"],
};

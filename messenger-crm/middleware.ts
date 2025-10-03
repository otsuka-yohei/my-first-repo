import { NextResponse } from "next/server"

import { auth } from "@/auth"

const PUBLIC_API_PATHS = ["/api/health", "/api/auth"]

export default auth((req) => {
  const { nextUrl } = req

  if (PUBLIC_API_PATHS.some((path) => nextUrl.pathname.startsWith(path))) {
    return NextResponse.next()
  }

  const isPublicPage = ["/login"].includes(nextUrl.pathname)

  if (!req.auth && !isPublicPage) {
    const loginUrl = new URL("/login", nextUrl.origin)
    if (nextUrl.pathname !== "/login") {
      loginUrl.searchParams.set("callbackUrl", nextUrl.pathname + nextUrl.search)
    }
    return NextResponse.redirect(loginUrl)
  }

  return NextResponse.next()
})

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
}

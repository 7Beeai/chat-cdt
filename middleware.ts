import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

const PUBLIC_PATHS = [
  '/login',
  '/api/meta/webhook',
  '/api/health',
  '/manifest.webmanifest',
  '/sw.js',
  '/icon-192.png',
  '/icon-512.png',
  '/badge.png',
  '/favicon.ico',
]

function isPublic(pathname: string) {
  if (PUBLIC_PATHS.includes(pathname)) return true
  if (pathname.startsWith('/_next')) return true
  // Worker do encoder Ogg/Opus (gravação de áudio) — lib vendorada, sem dado
  // sensível. Liberar evita que o fetch do Worker caia no redirect pro /login.
  if (pathname.startsWith('/opus/')) return true
  if (pathname.startsWith('/api/meta/')) return true
  // Endpoints internos (push/notify, media/backfill, cron/*) têm auth via
  // CRON_SECRET header — não pelo cookie do usuário. Deixa passar.
  if (pathname.startsWith('/api/internal/')) return true
  if (pathname.startsWith('/api/cron/')) return true
  return false
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // Always allow public routes/assets through with a fresh response so the
  // Supabase SSR client can refresh cookies on protected pages.
  let response = NextResponse.next({ request: req })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return req.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => req.cookies.set(name, value))
          response = NextResponse.next({ request: req })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (isPublic(pathname)) return response

  if (!user) {
    const url = req.nextUrl.clone()
    url.pathname = '/login'
    url.searchParams.set('next', pathname)
    return NextResponse.redirect(url)
  }

  if (pathname === '/') {
    const url = req.nextUrl.clone()
    url.pathname = '/inbox'
    return NextResponse.redirect(url)
  }

  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|webp|ico)$).*)'],
}

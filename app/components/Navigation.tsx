"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import AuthStatus from "./AuthStatus";

export default function Navigation() {
  const pathname = usePathname();
  const isHome = pathname === "/";

  return (
    <nav className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto max-w-7xl px-6">
        <div className="flex h-16 items-center justify-between">
          {/* Logo/Brand */}
          <Link href="/" className="flex items-center gap-3 transition-opacity hover:opacity-80">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg gradient-field text-primary-foreground font-bold text-lg shadow-md">
              🏈
            </div>
            <div className="hidden sm:block">
              <h1 className="text-lg font-bold tracking-tight">NFL Playoff Draft</h1>
              <p className="text-xs text-muted-foreground">Fantasy Playoffs</p>
            </div>
          </Link>

          {/* Navigation Links */}
          <div className="flex items-center gap-4">
            {!isHome && (
              <Link
                href="/"
                className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                Home
              </Link>
            )}
            <AuthStatus />
          </div>
        </div>
      </div>
    </nav>
  );
}

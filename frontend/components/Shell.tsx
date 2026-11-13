"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/", label: "Videos" },
  { href: "/new", label: "New" },
  { href: "/settings", label: "Settings" },
  { href: "/system", label: "System" },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="mx-auto min-h-screen max-w-6xl px-3 pb-24 pt-4 sm:px-4 sm:pb-16 sm:pt-6">
      <header className="mb-6 border-b border-line pb-4 sm:mb-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
          <div className="min-w-0">
            <p className="font-display text-2xl font-bold tracking-tight text-foam sm:text-3xl">
              Shorts Studio
            </p>
            <p className="mt-1 text-xs text-mist sm:text-sm">
              Long video in. Vertical shorts out.
            </p>
          </div>
          {/* Desktop nav */}
          <nav className="hidden flex-wrap gap-1 sm:flex">
            {links.map((l) => {
              const active =
                pathname === l.href || (l.href !== "/" && pathname.startsWith(l.href));
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  className={`rounded-md px-3 py-2 text-sm no-underline ${
                    active
                      ? "bg-accent/15 text-accent"
                      : "text-mist hover:bg-panel hover:text-foam"
                  }`}
                >
                  {l.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </header>

      {children}

      {/* Mobile bottom nav */}
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-ink/95 backdrop-blur sm:hidden">
        <ul className="mx-auto grid max-w-6xl grid-cols-4">
          {links.map((l) => {
            const active =
              pathname === l.href || (l.href !== "/" && pathname.startsWith(l.href));
            return (
              <li key={l.href}>
                <Link
                  href={l.href}
                  className={`flex flex-col items-center justify-center gap-0.5 py-3 text-xs no-underline ${
                    active ? "text-accent" : "text-mist"
                  }`}
                >
                  <span
                    className={`h-1 w-6 rounded-full ${active ? "bg-accent" : "bg-transparent"}`}
                  />
                  {l.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}

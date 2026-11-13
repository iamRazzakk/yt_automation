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
  const bare = pathname === "/login";

  if (bare) {
    return <>{children}</>;
  }

  return (
    <div className="mx-auto max-w-6xl px-4 pb-16 pt-6">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4 border-b border-line pb-4">
        <div>
          <p className="font-display text-3xl font-bold tracking-tight text-foam">
            Shorts Studio
          </p>
          <p className="mt-1 text-sm text-mist">Long video in. Vertical shorts out.</p>
        </div>
        <nav className="flex flex-wrap gap-1">
          {links.map((l) => {
            const active = pathname === l.href || (l.href !== "/" && pathname.startsWith(l.href));
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
      </header>
      {children}
    </div>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Login removed — send everyone to the dashboard. */
export default function LoginPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/");
  }, [router]);
  return <p className="p-6 text-mist">Redirecting…</p>;
}

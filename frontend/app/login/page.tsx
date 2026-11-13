"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { api } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await api.login(password);
      router.replace("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-md border border-line bg-panel/80 p-8 shadow-[0_20px_60px_rgba(0,0,0,0.35)] backdrop-blur"
      >
        <h1 className="font-display text-4xl font-bold">Shorts Studio</h1>
        <p className="mt-2 text-sm text-mist">Owner login</p>
        <label className="mt-8 block text-sm text-mist">
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-2 w-full border border-line bg-ink px-3 py-2 text-foam"
            autoFocus
            required
          />
        </label>
        {error && <p className="mt-3 text-sm text-danger">{error}</p>}
        <button
          type="submit"
          disabled={loading}
          className="mt-6 w-full bg-accent px-4 py-2.5 font-medium text-ink disabled:opacity-60"
        >
          {loading ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}

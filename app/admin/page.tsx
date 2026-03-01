"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";

interface UserRow {
  id: string;
  email: string;
  name: string | null;
  createdAt: string | null;
  sessionCount: number;
  totalMinutes: number;
  lastActiveAt: string | null;
}

export default function AdminPage() {
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [search, setSearch] = useState("");
  const [banning, setBanning] = useState<string | null>(null);
  const [confirmBan, setConfirmBan] = useState<UserRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/admin/users");
    if (res.status === 403) { setForbidden(true); setLoading(false); return; }
    if (res.ok) setUsers(await res.json());
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function banUser(user: UserRow) {
    setBanning(user.id);
    try {
      const res = await fetch(`/api/admin/users/${user.id}`, { method: "DELETE" });
      if (res.ok) {
        setUsers((prev) => prev?.filter((u) => u.id !== user.id) ?? null);
      } else {
        const data = await res.json().catch(() => ({}));
        alert(data.error ?? "Failed to ban user");
      }
    } finally {
      setBanning(null);
      setConfirmBan(null);
    }
  }

  const filtered = (users ?? []).filter(
    (u) =>
      u.email.toLowerCase().includes(search.toLowerCase()) ||
      (u.name ?? "").toLowerCase().includes(search.toLowerCase())
  );

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-950 flex items-center justify-center">
        <p className="text-gray-400 animate-pulse">Loading…</p>
      </main>
    );
  }

  if (forbidden) {
    return (
      <main className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-center space-y-3">
          <p className="text-3xl">🚫</p>
          <p className="text-white font-semibold">Access denied</p>
          <p className="text-gray-400 text-sm">This page is restricted to the developer account.</p>
          <Link href="/dashboard" className="text-sm text-gray-500 underline">← Dashboard</Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-950 text-white">
      <div className="mx-auto max-w-6xl px-6 py-10">

        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-4 mb-8">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="rounded-md bg-red-600 px-2 py-0.5 text-xs font-bold tracking-wide uppercase">
                Dev
              </span>
              <h1 className="text-xl font-bold">Developer Panel</h1>
            </div>
            <p className="text-sm text-gray-400">
              {users?.length ?? 0} registered account{users?.length !== 1 ? "s" : ""}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={load}
              className="rounded-lg border border-gray-700 px-4 py-2 text-sm hover:bg-gray-800 transition"
            >
              Refresh
            </button>
            <Link
              href="/dashboard"
              className="rounded-lg border border-gray-700 px-4 py-2 text-sm hover:bg-gray-800 transition"
            >
              ← Dashboard
            </Link>
          </div>
        </div>

        {/* Search */}
        <input
          type="text"
          placeholder="Search by email or name…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full mb-5 rounded-lg border border-gray-700 bg-gray-900 px-4 py-2.5 text-sm placeholder-gray-500 focus:outline-none focus:border-gray-500"
        />

        {/* Stats bar */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          {[
            { label: "Total Accounts", value: users?.length ?? 0 },
            {
              label: "Total Sessions",
              value: users?.reduce((s, u) => s + u.sessionCount, 0) ?? 0,
            },
            {
              label: "Total Study Time",
              value: (() => {
                const mins = users?.reduce((s, u) => s + u.totalMinutes, 0) ?? 0;
                return mins >= 60
                  ? `${Math.floor(mins / 60)}h ${mins % 60}m`
                  : `${mins}m`;
              })(),
            },
          ].map((stat) => (
            <div
              key={stat.label}
              className="rounded-xl border border-gray-800 bg-gray-900 p-4 text-center"
            >
              <p className="text-xl font-bold">{stat.value}</p>
              <p className="text-xs text-gray-500 mt-1">{stat.label}</p>
            </div>
          ))}
        </div>

        {/* User table */}
        <div className="rounded-xl border border-gray-800 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-900 border-b border-gray-800">
              <tr>
                {["User", "Joined", "Sessions", "Study Time", "Last Active", ""].map((h) => (
                  <th
                    key={h}
                    className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wide"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                    {search ? "No users match your search." : "No users yet."}
                  </td>
                </tr>
              )}
              {filtered.map((user) => (
                <tr key={user.id} className="bg-gray-950 hover:bg-gray-900 transition">
                  <td className="px-4 py-3">
                    <p className="font-medium">{user.name ?? <span className="text-gray-500">No name</span>}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{user.email}</p>
                  </td>
                  <td className="px-4 py-3 text-gray-400">
                    {user.createdAt
                      ? new Date(user.createdAt).toLocaleDateString(undefined, {
                          month: "short", day: "numeric", year: "numeric",
                        })
                      : "—"}
                  </td>
                  <td className="px-4 py-3 text-gray-300">{user.sessionCount}</td>
                  <td className="px-4 py-3 text-gray-300">
                    {user.totalMinutes >= 60
                      ? `${Math.floor(user.totalMinutes / 60)}h ${user.totalMinutes % 60}m`
                      : `${user.totalMinutes}m`}
                  </td>
                  <td className="px-4 py-3 text-gray-400">
                    {user.lastActiveAt
                      ? new Date(user.lastActiveAt).toLocaleDateString(undefined, {
                          month: "short", day: "numeric",
                        })
                      : "Never"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => setConfirmBan(user)}
                      disabled={banning === user.id}
                      className="rounded-md border border-red-800 px-3 py-1 text-xs text-red-400 hover:bg-red-900/30 transition disabled:opacity-40"
                    >
                      Ban
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="mt-4 text-xs text-gray-600 text-center">
          Banning a user permanently deletes their account and all associated data.
        </p>
      </div>

      {/* Confirm ban modal */}
      {confirmBan && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl bg-gray-900 border border-gray-700 p-6 shadow-2xl">
            <h2 className="text-base font-semibold mb-1">Ban this user?</h2>
            <p className="text-sm text-gray-400 mb-1">
              <span className="text-white font-medium">{confirmBan.email}</span>
            </p>
            <p className="text-sm text-gray-500 mb-5">
              This will permanently delete their account and all sessions, notes, and quiz data. This cannot be undone.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setConfirmBan(null)}
                className="flex-1 rounded-lg border border-gray-700 px-4 py-2 text-sm hover:bg-gray-800 transition"
              >
                Cancel
              </button>
              <button
                onClick={() => banUser(confirmBan)}
                disabled={banning === confirmBan.id}
                className="flex-1 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium hover:bg-red-700 transition disabled:opacity-50"
              >
                {banning === confirmBan.id ? "Banning…" : "Yes, ban them"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

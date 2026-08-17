"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { StaffRole } from "@/types/database";
import { createStaffAccountAction, deleteStaffAccountAction } from "./actions";

const ROLES: StaffRole[] = ["admin", "sales", "stock", "accountance", "marketing"];

export default function UsersClient({
  staff,
  currentUserId,
}: {
  staff: { id: string; fullName: string; role: string; email: string | null; createdAt: string }[];
  currentUserId: string;
}) {
  const router = useRouter();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<StaffRole>("sales");
  const [password, setPassword] = useState("");
  const [created, setCreated] = useState<{ email: string; password: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function createAccount() {
    setError(null);
    setCreated(null);
    if (!fullName.trim() || !email.trim()) {
      setError("Enter a name and email");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    startTransition(async () => {
      try {
        await createStaffAccountAction({ fullName, email, role, password });
        setCreated({ email, password });
        setFullName("");
        setEmail("");
        setRole("sales");
        setPassword("");
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to create account");
      }
    });
  }

  function copyCredentials() {
    if (!created) return;
    navigator.clipboard.writeText(`Email: ${created.email}\nPassword: ${created.password}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function deleteAccount(id: string, name: string) {
    if (!window.confirm(`Delete ${name}'s account? This can't be undone.`)) return;
    setDeleteError(null);
    setDeletingId(id);
    startTransition(async () => {
      try {
        await deleteStaffAccountAction(id);
        router.refresh();
      } catch (e) {
        setDeleteError(e instanceof Error ? e.message : "Failed to delete account");
      } finally {
        setDeletingId(null);
      }
    });
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-8">
      <header>
        <h1 className="font-display text-2xl font-bold">Staff Accounts</h1>
        <p className="mt-1 text-muted-foreground">
          Create an account with a role and password, then share the login with them.
        </p>
      </header>

      <section className="rounded-2xl border border-border bg-card p-6">
        <h2 className="font-display font-bold">Add staff account</h2>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-bold tracking-widest text-muted-foreground uppercase">
              Full name
            </label>
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="rounded-lg border border-border bg-transparent px-3 py-2 text-sm outline-none focus:border-brand"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-bold tracking-widest text-muted-foreground uppercase">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="rounded-lg border border-border bg-transparent px-3 py-2 text-sm outline-none focus:border-brand"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-bold tracking-widest text-muted-foreground uppercase">
              Password
            </label>
            <input
              type="text"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="8+ characters"
              className="rounded-lg border border-border bg-transparent px-3 py-2 text-sm outline-none focus:border-brand"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-bold tracking-widest text-muted-foreground uppercase">
              Role
            </label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as StaffRole)}
              className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground capitalize outline-none focus:border-brand"
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
          <button
            disabled={isPending}
            onClick={createAccount}
            className="rounded-full bg-brand px-5 py-2 text-sm font-medium text-black disabled:opacity-40"
          >
            {isPending ? "Creating…" : "Create account"}
          </button>
        </div>

        {error && <p className="mt-3 text-sm text-red-500">{error}</p>}

        {created && (
          <div className="mt-4 rounded-lg border border-brand/40 bg-brand/10 p-4">
            <p className="text-sm font-medium">
              Account created — they can log in now with what you set.
            </p>
            <div className="mt-2 flex items-center gap-2">
              <code className="flex-1 overflow-x-auto rounded bg-muted px-2 py-1.5 text-xs whitespace-nowrap">
                {created.email} / {created.password}
              </code>
              <button
                onClick={copyCredentials}
                className="shrink-0 rounded-full border border-border px-3 py-1.5 text-xs"
              >
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Send this to them however you normally would (Telegram, in person, etc).
            </p>
          </div>
        )}
      </section>

      <section className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="border-b border-border px-6 py-4">
          <h2 className="font-display font-bold">All staff</h2>
        </div>
        {deleteError && <p className="px-6 pt-4 text-sm text-red-500">{deleteError}</p>}
        <table className="w-full text-sm">
          <thead className="bg-muted text-xs font-bold tracking-widest text-muted-foreground uppercase">
            <tr>
              <th className="px-6 py-3 text-left">Name</th>
              <th className="px-3 py-3 text-left">Email</th>
              <th className="px-3 py-3 text-left">Role</th>
              <th className="px-3 py-3 text-right">Created</th>
              <th className="px-6 py-3 text-right">&nbsp;</th>
            </tr>
          </thead>
          <tbody>
            {staff.map((s) => (
              <tr key={s.id} className="border-t border-border">
                <td className="px-6 py-3">{s.fullName}</td>
                <td className="px-3 py-3 text-muted-foreground">{s.email ?? "—"}</td>
                <td className="px-3 py-3 capitalize">{s.role}</td>
                <td className="px-3 py-3 text-right text-muted-foreground">
                  {new Date(s.createdAt).toLocaleDateString()}
                </td>
                <td className="px-6 py-3 text-right">
                  {s.id !== currentUserId && (
                    <button
                      disabled={deletingId === s.id}
                      onClick={() => deleteAccount(s.id, s.fullName)}
                      className="text-xs text-muted-foreground hover:text-red-500 disabled:opacity-40"
                    >
                      {deletingId === s.id ? "Deleting…" : "Delete"}
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {staff.length === 0 && (
              <tr>
                <td colSpan={5} className="px-6 py-8 text-center text-muted-foreground">
                  No staff accounts yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}

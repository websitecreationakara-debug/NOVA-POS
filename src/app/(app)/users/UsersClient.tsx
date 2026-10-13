"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2, TriangleAlert, Wand2 } from "lucide-react";
import { staffRoleLabel, type StaffRole } from "@/types/database";
import {
  createStaffAccountAction,
  deleteStaffAccountAction,
  removeStaffAvatarAction,
  updateStaffRoleAction,
  uploadStaffAvatarAction,
} from "./actions";

const AVATAR_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
const AVATAR_MAX_BYTES = 2 * 1024 * 1024;

const ROLES: StaffRole[] = ["admin", "sales", "stock", "accountance", "marketing"];

// A random 12-character password from letters and digits, leaving out look-alikes
// (0/O, 1/l/I) since it gets read out or typed from a message. Always has at least
// one lowercase letter, one uppercase letter and one digit.
function generatePassword(length = 12): string {
  const lower = "abcdefghijkmnopqrstuvwxyz";
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const digits = "23456789";
  const all = lower + upper + digits;
  const pick = (set: string, n: number) => set[n % set.length];
  const bytes = crypto.getRandomValues(new Uint32Array(length));
  const chars = Array.from(bytes, (n) => pick(all, n));
  // Force one of each kind into fixed spots, then shuffle so they aren't predictable.
  chars[0] = pick(lower, bytes[0]);
  chars[1] = pick(upper, bytes[1]);
  chars[2] = pick(digits, bytes[2]);
  const order = crypto.getRandomValues(new Uint32Array(length));
  return chars
    .map((c, i) => ({ c, k: order[i] }))
    .sort((a, b) => a.k - b.k)
    .map((x) => x.c)
    .join("");
}

// Up to two letters for the avatar next to a staff name ("Vichet Vorng" -> "VV").
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const letters = parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + parts[parts.length - 1][0];
  return letters.toUpperCase();
}

export default function UsersClient({
  staff,
  currentUserId,
}: {
  staff: {
    id: string;
    fullName: string;
    role: string;
    email: string | null;
    avatarUrl: string | null;
    createdAt: string;
  }[];
  currentUserId: string;
}) {
  const router = useRouter();
  const [avatarBusyId, setAvatarBusyId] = useState<string | null>(null);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; name: string } | null>(null);
  // Fades/scales the dialog in on open rather than snapping to full opacity --
  // same as DeleteOrderDialog. Reset for each open, not a one-time mount
  // effect, since this one dialog is reused for every row.
  const [dialogVisible, setDialogVisible] = useState(false);
  useEffect(() => {
    if (!confirmDelete) return;
    const raf = requestAnimationFrame(() => setDialogVisible(true));
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setConfirmDelete(null);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [confirmDelete]);
  const [savingRoleId, setSavingRoleId] = useState<string | null>(null);
  const [roleError, setRoleError] = useState<string | null>(null);
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

  function changeRole(id: string, newRole: StaffRole) {
    setRoleError(null);
    setSavingRoleId(id);
    startTransition(async () => {
      try {
        await updateStaffRoleAction(id, newRole);
        router.refresh();
      } catch (e) {
        setRoleError(e instanceof Error ? e.message : "Failed to change role");
      } finally {
        setSavingRoleId(null);
      }
    });
  }

  function changeAvatar(id: string, file: File | null) {
    if (!file) return;
    setAvatarError(null);
    if (!AVATAR_TYPES.includes(file.type)) {
      setAvatarError("Photo must be a PNG, JPG, WEBP or GIF");
      return;
    }
    if (file.size > AVATAR_MAX_BYTES) {
      setAvatarError("Photo must be under 2MB");
      return;
    }
    setAvatarBusyId(id);
    const formData = new FormData();
    formData.set("userId", id);
    formData.set("file", file);
    startTransition(async () => {
      try {
        await uploadStaffAvatarAction(formData);
        router.refresh();
      } catch (e) {
        setAvatarError(e instanceof Error ? e.message : "Upload failed");
      } finally {
        setAvatarBusyId(null);
      }
    });
  }

  function removeAvatar(id: string) {
    setAvatarError(null);
    setAvatarBusyId(id);
    startTransition(async () => {
      try {
        await removeStaffAvatarAction(id);
        router.refresh();
      } catch (e) {
        setAvatarError(e instanceof Error ? e.message : "Failed to remove photo");
      } finally {
        setAvatarBusyId(null);
      }
    });
  }

  function confirmDeleteAccount() {
    if (!confirmDelete) return;
    const { id } = confirmDelete;
    setDeleteError(null);
    setDeletingId(id);
    setConfirmDelete(null);
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
    <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-8">
      <header>
        <h1 className="font-display text-2xl font-bold">Staff Accounts</h1>
        <p className="mt-1 text-muted-foreground">
          Create an account with a role and password, then share the login with them.
        </p>
      </header>

      <section className="rounded-2xl border border-border bg-card p-4 sm:p-6">
        <h2 className="font-display font-bold">Add staff account</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-bold tracking-widest text-muted-foreground uppercase">
              Full name
            </label>
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="w-full rounded-lg border border-border bg-transparent px-3 py-2 text-sm outline-none focus:border-brand"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-bold tracking-widest text-muted-foreground uppercase">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-border bg-transparent px-3 py-2 text-sm outline-none focus:border-brand"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold tracking-widest text-muted-foreground uppercase">
                Password
              </label>
              <button
                type="button"
                onClick={() => setPassword(generatePassword())}
                className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium text-brand hover:bg-brand/10"
              >
                <Wand2 className="size-3" />
                Generate
              </button>
            </div>
            <input
              type="text"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-border bg-transparent px-3 py-2 text-sm outline-none focus:border-brand"
            />
            <p
              className={`text-xs ${
                password.length === 0
                  ? "text-muted-foreground"
                  : password.length < 8
                    ? "text-red-500"
                    : "text-emerald-600 dark:text-emerald-400"
              }`}
            >
              At least 8 characters
              {password.length > 0 && ` (${password.length})`}
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-bold tracking-widest text-muted-foreground uppercase">
              Role
            </label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as StaffRole)}
              className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-brand"
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {staffRoleLabel(r)}
                </option>
              ))}
            </select>
          </div>
          <div className="flex sm:col-span-2 sm:justify-end">
            <button
              disabled={isPending}
              onClick={createAccount}
              className="w-full rounded-full bg-brand px-5 py-2 text-sm font-medium text-white disabled:opacity-40 sm:w-auto"
            >
              {isPending ? "Creating…" : "Create account"}
            </button>
          </div>
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
        <div className="border-b border-border px-4 py-4 sm:px-6">
          <h2 className="font-display font-bold">All staff</h2>
        </div>
        {deleteError && <p className="px-4 pt-4 text-sm text-red-500 sm:px-6">{deleteError}</p>}
        {roleError && <p className="px-4 pt-4 text-sm text-red-500 sm:px-6">{roleError}</p>}
        {avatarError && <p className="px-4 pt-4 text-sm text-red-500 sm:px-6">{avatarError}</p>}
        <div className="overflow-x-auto">
        {/* On a phone each person is a small card (name, full email, role + date);
            from md up it's the normal table. */}
        <table className="block w-full text-sm md:table">
          <thead className="hidden bg-muted text-xs font-bold tracking-widest text-muted-foreground uppercase md:table-header-group">
            <tr>
              <th className="px-6 py-3 text-left">Name</th>
              <th className="px-3 py-3 text-left">Email</th>
              <th className="px-3 py-3 text-left">Role</th>
              <th className="px-3 py-3 text-right">Created</th>
              <th className="px-6 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="block md:table-row-group">
            {staff.map((s) => (
              <tr
                key={s.id}
                className="relative grid grid-cols-2 items-center gap-x-3 gap-y-1 border-t border-border px-4 py-3 transition-colors md:table-row md:px-0 md:py-0 md:even:bg-muted/30 md:hover:bg-muted/50"
              >
                <td className="col-span-2 p-0 pr-10 font-medium md:px-6 md:py-3 md:pr-6 md:font-normal">
                  <span className="flex items-center gap-3">
                    {/* The avatar and the "photo" links below share one hidden file input. */}
                    <input
                      id={`avatar-${s.id}`}
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/gif"
                      className="hidden"
                      disabled={avatarBusyId === s.id}
                      onChange={(e) => {
                        const file = e.target.files?.[0] ?? null;
                        e.target.value = "";
                        changeAvatar(s.id, file);
                      }}
                    />
                    <label
                      htmlFor={`avatar-${s.id}`}
                      title={s.avatarUrl ? "Change photo" : "Add photo"}
                      className={`grid size-10 shrink-0 cursor-pointer place-items-center overflow-hidden rounded-full bg-brand/15 text-xs font-bold text-brand ${
                        avatarBusyId === s.id ? "opacity-50" : "hover:ring-2 hover:ring-brand/40"
                      }`}
                    >
                      {s.avatarUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={s.avatarUrl} alt="" className="size-full object-cover" />
                      ) : (
                        initials(s.fullName)
                      )}
                    </label>
                    <span className="min-w-0">
                      <span className="block truncate">{s.fullName}</span>
                      <span className="flex gap-2 text-xs font-normal text-muted-foreground">
                        {avatarBusyId === s.id ? (
                          <span>Saving…</span>
                        ) : (
                          <>
                            <label htmlFor={`avatar-${s.id}`} className="cursor-pointer hover:text-foreground hover:underline">
                              {s.avatarUrl ? "Change photo" : "Add photo"}
                            </label>
                            {s.avatarUrl && (
                              <button
                                type="button"
                                onClick={() => removeAvatar(s.id)}
                                className="hover:text-red-600 hover:underline"
                              >
                                Remove
                              </button>
                            )}
                          </>
                        )}
                      </span>
                    </span>
                  </span>
                </td>
                <td className="col-span-2 p-0 text-xs break-all text-muted-foreground md:px-3 md:py-3 md:text-sm md:break-normal">
                  {s.email ?? "—"}
                </td>
                <td className="mt-1 p-0 md:mt-0 md:px-3 md:py-3">
                  {s.id === currentUserId ? (
                    staffRoleLabel(s.role)
                  ) : (
                    <select
                      value={s.role}
                      disabled={savingRoleId === s.id}
                      onChange={(e) => changeRole(s.id, e.target.value as StaffRole)}
                      className="rounded-lg border border-border bg-card px-2 py-1 text-sm text-foreground outline-none focus:border-brand disabled:opacity-50"
                    >
                      {!ROLES.includes(s.role as StaffRole) && (
                        <option value={s.role}>{staffRoleLabel(s.role)}</option>
                      )}
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {staffRoleLabel(r)}
                        </option>
                      ))}
                    </select>
                  )}
                </td>
                <td className="mt-1 p-0 text-right text-xs text-muted-foreground md:mt-0 md:px-3 md:py-3 md:text-sm">
                  {new Date(s.createdAt).toLocaleDateString()}
                </td>
                <td className="absolute top-3 right-3 p-0 md:static md:px-6 md:py-3 md:text-right">
                  {s.id !== currentUserId && (
                    <button
                      type="button"
                      title="Delete"
                      disabled={deletingId === s.id}
                      onClick={() => {
                        setDialogVisible(false);
                        setConfirmDelete({ id: s.id, name: s.fullName });
                      }}
                      className="rounded p-1.5 text-muted-foreground hover:bg-red-100 hover:text-red-600 disabled:opacity-40 dark:hover:bg-red-900/40"
                    >
                      {deletingId === s.id ? (
                        <span className="text-xs">Deleting…</span>
                      ) : (
                        <Trash2 className="size-4" />
                      )}
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {staff.length === 0 && (
              <tr className="block md:table-row">
                <td colSpan={5} className="block px-4 py-8 text-center text-muted-foreground md:table-cell md:px-6">
                  No staff accounts yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
      </section>

      {confirmDelete && (
        <div
          className={`fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 transition-opacity duration-150 ${
            dialogVisible ? "opacity-100" : "opacity-0"
          }`}
          onClick={() => {
            if (deletingId === null) setConfirmDelete(null);
          }}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-staff-title"
            aria-describedby="delete-staff-description"
            className={`w-full max-w-sm rounded-2xl border border-border bg-card p-6 text-center shadow-2xl transition-all duration-150 ${
              dialogVisible ? "scale-100 opacity-100" : "scale-95 opacity-0"
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-red-600 dark:bg-red-950 dark:text-red-400">
              <TriangleAlert className="h-6 w-6" />
            </div>
            <h2 id="delete-staff-title" className="mt-4 text-base font-semibold text-foreground">
              Delete {confirmDelete.name}&apos;s account?
            </h2>
            <p id="delete-staff-description" className="mt-1.5 text-sm text-muted-foreground">
              They&apos;ll lose access immediately. This can&apos;t be undone.
            </p>
            <div className="mt-6 flex justify-center gap-2">
              <button
                type="button"
                disabled={deletingId !== null}
                onClick={() => setConfirmDelete(null)}
                className="flex-1 rounded-full border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-muted disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deletingId !== null}
                onClick={confirmDeleteAccount}
                className="flex-1 rounded-full bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50"
              >
                {deletingId !== null ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

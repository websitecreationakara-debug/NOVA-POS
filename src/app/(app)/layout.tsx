import Sidebar from "@/components/Sidebar";
import TopBar from "@/components/TopBar";
import { getSessionUser } from "@/lib/supabase/auth-server";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Middleware already guarantees a valid session with a role for every
  // route under this group -- if getSessionUser() ever returns null here,
  // something's wrong with the cookie/session sync, not a normal "logged
  // out" state, so it's fine to just render with an empty fallback rather
  // than redirect again.
  const user = await getSessionUser();

  return (
    <div className="flex h-full">
      <Sidebar role={user?.role ?? ""} />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <TopBar fullName={user?.fullName ?? ""} role={user?.role ?? ""} />
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

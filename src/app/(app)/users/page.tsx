import { listStaffAction } from "./actions";
import { getSessionUser } from "@/lib/supabase/auth-server";
import UsersClient from "./UsersClient";

export default async function UsersPage() {
  const [staff, user] = await Promise.all([listStaffAction(), getSessionUser()]);
  return <UsersClient staff={staff} currentUserId={user?.id ?? ""} />;
}

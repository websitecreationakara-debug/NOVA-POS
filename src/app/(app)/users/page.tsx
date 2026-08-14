import { listStaffAction } from "./actions";
import UsersClient from "./UsersClient";

export default async function UsersPage() {
  const staff = await listStaffAction();
  return <UsersClient staff={staff} />;
}

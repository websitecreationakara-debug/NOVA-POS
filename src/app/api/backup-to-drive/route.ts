import { NextResponse, type NextRequest } from "next/server";
import { buildBackupZip, uploadBackupToDrive } from "@/lib/driveBackup";

export const dynamic = "force-dynamic";

// Called on a schedule (see .github/workflows/backup-to-drive.yml): zips every
// order + order line and saves it to the shared Google Drive folder. Like the
// other /api routes it authenticates itself with a bearer secret rather than a
// login session -- see the matcher in src/proxy.ts.
export async function POST(request: NextRequest) {
  const secret = process.env.BACKUP_CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const backup = await buildBackupZip();
    const file = await uploadBackupToDrive(backup.filename, backup.zip);
    return NextResponse.json({
      ok: true,
      file: file.name,
      driveFileId: file.id,
      bytes: file.size,
      orders: backup.orderCount,
      items: backup.itemCount,
      includesCustomers: backup.includesCustomers,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Backup failed" },
      { status: 500 }
    );
  }
}

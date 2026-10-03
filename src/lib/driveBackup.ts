import { fetchOrdersBackupData } from "@/lib/ordersBackupData";
import { buildOrdersCsv, buildOrdersSheet } from "@/lib/ordersCsv";
import { ppToday } from "@/lib/phnomPenhTime";
import { buildXlsx, zip } from "@/lib/xlsxWriter";

// The automatic Google Drive backup: one .zip holding the Orders workbook (.xlsx)
// and the flat .csv -- the same two files as the in-app Backup buttons -- with
// customer names, phones, emails and addresses left out unless
// BACKUP_INCLUDE_CUSTOMER=true (the Drive folder is shared with other people).
export async function buildBackupZip(): Promise<{
  filename: string;
  zip: Buffer;
  orderCount: number;
  itemCount: number;
  includesCustomers: boolean;
}> {
  const includesCustomers = process.env.BACKUP_INCLUDE_CUSTOMER === "true";
  const { orders, items } = await fetchOrdersBackupData();
  if (!includesCustomers) {
    for (const o of orders) {
      o.customer_name = null;
      o.customer_phone = null;
      o.customer_email = null;
      o.customers = null;
    }
  }

  const stem = `nova-pos-orders-backup-${ppToday()}${includesCustomers ? "" : "-no-customer"}`;
  const { columns, rows } = buildOrdersSheet(orders, items);
  const archive = zip([
    { name: `${stem}.xlsx`, data: buildXlsx("Orders", columns, rows) },
    { name: `${stem}.csv`, data: buildOrdersCsv(orders, items) },
  ]);
  return {
    filename: `${stem}.zip`,
    zip: archive,
    orderCount: orders.length,
    itemCount: items.length,
    includesCustomers,
  };
}

// Hands the zip to the Google Apps Script web app that saves it into the Drive
// folder (see scripts/google-drive-backup.gs). The script runs as the Drive
// owner, so the file is theirs and counts against their storage -- a service
// account can't do that for a personal Drive. The shared secret is the only lock
// on the web app's URL.
export async function uploadBackupToDrive(filename: string, archive: Buffer): Promise<{ id: string; name: string; size: number }> {
  const url = process.env.GOOGLE_DRIVE_BACKUP_URL;
  const secret = process.env.GOOGLE_DRIVE_BACKUP_SECRET;
  if (!url || !secret) {
    throw new Error("GOOGLE_DRIVE_BACKUP_URL or GOOGLE_DRIVE_BACKUP_SECRET is not set");
  }
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ secret, filename, base64: archive.toString("base64") }),
    redirect: "follow",
  });
  const text = await res.text();
  let payload: { ok?: boolean; error?: string; id?: string; name?: string; size?: number };
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(`Drive script returned a non-JSON response (HTTP ${res.status})`);
  }
  if (!res.ok || !payload.ok) throw new Error(payload.error ?? `Drive script failed (HTTP ${res.status})`);
  return { id: payload.id ?? "", name: payload.name ?? filename, size: payload.size ?? archive.length };
}

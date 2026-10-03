/**
 * Google Apps Script that saves NOVA-POS's automatic order backup into a Drive
 * folder. NOVA-POS (POST /api/backup-to-drive) sends it a .zip; this saves the
 * zip in the folder as YOU, so the file is yours and uses your Drive storage.
 *
 * ONE-TIME SETUP
 *  1. Open https://script.google.com -> New project. Paste this whole file
 *     into Code.gs (replace what is there) and Save.
 *  2. Project Settings (gear) -> Script properties -> Add property:
 *       BACKUP_SECRET = a long random string (e.g. 40+ characters)
 *     Keep it: the same value goes into NOVA-POS as GOOGLE_DRIVE_BACKUP_SECRET.
 *  3. Pick the function `authorize` in the toolbar and press Run. Approve the
 *     Google permission prompt (it needs access to Drive). The log should print
 *     the folder's name. You must have EDIT access to the folder.
 *  4. Deploy -> New deployment -> type "Web app":
 *       Execute as: Me      Who has access: Anyone
 *     Copy the Web app URL (https://script.google.com/macros/s/.../exec). That
 *     is NOVA-POS's GOOGLE_DRIVE_BACKUP_URL. "Anyone" only lets a caller reach
 *     the script; without the secret it does nothing.
 *  5. After editing this script later: Deploy -> Manage deployments -> edit ->
 *     New version (the URL stays the same).
 */

// The "NOVA POS" Drive folder the backups are saved into.
const FOLDER_ID = '1hPCfx4BzrXUWgXa_GUZjpqYRC7Fv6xCP';
// Backup zips this script keeps; older ones go to the Drive trash (recoverable
// for 30 days). Only files named nova-pos-orders-backup-*.zip are ever touched.
const KEEP_LATEST = 60;

function doPost(e) {
  try {
    const secret = PropertiesService.getScriptProperties().getProperty('BACKUP_SECRET');
    const body = JSON.parse(e.postData.contents);
    if (!secret || body.secret !== secret) return reply({ ok: false, error: 'Unauthorized' });
    if (!body.filename || !body.base64) return reply({ ok: false, error: 'Missing filename or file' });
    if (!/^nova-pos-orders-backup-[\w.-]+\.zip$/.test(body.filename)) {
      return reply({ ok: false, error: 'Unexpected file name' });
    }

    const folder = DriveApp.getFolderById(FOLDER_ID);
    const blob = Utilities.newBlob(Utilities.base64Decode(body.base64), 'application/zip', body.filename);
    const file = folder.createFile(blob);
    prune(folder);
    return reply({ ok: true, id: file.getId(), name: file.getName(), size: file.getSize() });
  } catch (err) {
    return reply({ ok: false, error: String(err) });
  }
}

// Newest first by creation time; everything past KEEP_LATEST is trashed.
function prune(folder) {
  const backups = [];
  const files = folder.getFiles();
  while (files.hasNext()) {
    const f = files.next();
    const name = f.getName();
    if (name.indexOf('nova-pos-orders-backup-') === 0 && /\.zip$/.test(name)) backups.push(f);
  }
  backups.sort(function (a, b) {
    return b.getDateCreated().getTime() - a.getDateCreated().getTime();
  });
  backups.slice(KEEP_LATEST).forEach(function (f) {
    f.setTrashed(true);
  });
}

function reply(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// Run once from the editor to grant Drive access and check the folder is reachable.
function authorize() {
  Logger.log('Folder: ' + DriveApp.getFolderById(FOLDER_ID).getName());
}

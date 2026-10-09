// Client-side CSV -> customer rows for the Marketing page's "Import CSV".
// Parsing/normalizing happens in the browser so the preview can show what's
// wrong with the file before anything is sent; the server action re-validates
// everything anyway (it never trusts the client's rows).

export type CustomerImportRow = {
  /** 1-based row number in the file (header = row 1), for error messages. */
  row: number;
  phone: string;
  name: string;
  secondPhone: string;
  email: string;
  photoUrl: string;
  address: string;
  /** YYYY-MM-DD or "" */
  customerSince: string;
  firstName: string;
  lastName: string;
  pageUid: string;
  source: string;
  label: string;
  capital: string;
  state: string;
  /** YYYY-MM-DD or "" */
  dob: string;
  yob: number | null;
  /** Free text: a number ("31") or a range ("25-34", "55+"). */
  age: string;
  gender: string;
  nationality: string;
  followUp: string;
};

export type CustomerImportError = { row: number; message: string };

// Header text (lowercased, non-alphanumerics stripped) -> field.
const HEADER_ALIASES: Record<string, keyof Omit<CustomerImportRow, "row">> = {
  phone: "phone",
  phonenumber: "phone",
  mobile: "phone",
  tel: "phone",
  secondphone: "secondPhone",
  "2ndphonenumber": "secondPhone",
  "2ndphone": "secondPhone",
  phone2: "secondPhone",
  customername: "name",
  name: "name",
  fullname: "name",
  email: "email",
  emailaddress: "email",
  photo: "photoUrl",
  photourl: "photoUrl",
  image: "photoUrl",
  address: "address",
  customersince: "customerSince",
  since: "customerSince",
  firstname: "firstName",
  lastname: "lastName",
  pageuid: "pageUid",
  psid: "pageUid",
  uid: "pageUid",
  source: "source",
  label: "label",
  capital: "capital",
  state: "state",
  province: "state",
  stateprovince: "state",
  dob: "dob",
  dateofbirth: "dob",
  birthday: "dob",
  yob: "yob",
  yearofbirth: "yob",
  age: "age",
  gender: "gender",
  sex: "gender",
  nationality: "nationality",
  followup: "followUp",
};

/** True when a column heading is one of the customer fields (any spelling in HEADER_ALIASES). */
export function isKnownCustomerHeader(h: string): boolean {
  return !!HEADER_ALIASES[h.normalize("NFKC").toLowerCase().replace(/[^a-z0-9]/g, "")];
}

export const CUSTOMER_CSV_HEADERS = [
  "Phone Number",
  "Customer Name",
  "2nd Phone Number",
  "Email",
  "Photo",
  "Address",
  "Customer Since",
  "First Name",
  "Last Name",
  "PSID",
  "Source",
  "Label",
  "Capital",
  "State",
  "DOB",
  "YOB",
  "Age",
  "Gender",
  "Nationality",
  "Follow-Up",
];

/**
 * Bytes -> text, whatever encoding the spreadsheet app saved. UTF-8 (with or
 * without BOM) covers Khmer, Chinese, Thai, etc. as-is; Excel's "Unicode Text"
 * is UTF-16; only a file that isn't valid UTF-8 falls back to Windows-1252.
 */
export function decodeCsvBytes(buf: ArrayBuffer): string {
  const b = new Uint8Array(buf);
  const decode = (label: string, start = 0) =>
    new TextDecoder(label).decode(b.subarray(start));
  if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) return decode("utf-8", 3);
  if (b[0] === 0xff && b[1] === 0xfe) return decode("utf-16le", 2);
  if (b[0] === 0xfe && b[1] === 0xff) return decode("utf-16be", 2);
  // UTF-16 without a BOM: mostly-ASCII text has a zero byte every other byte.
  const n = Math.min(b.length, 400);
  let nulEven = 0;
  let nulOdd = 0;
  for (let i = 0; i < n; i++) {
    if (b[i] !== 0) continue;
    if (i % 2) nulOdd++;
    else nulEven++;
  }
  if (nulOdd > n / 8 && nulEven === 0) return decode("utf-16le");
  if (nulEven > n / 8 && nulOdd === 0) return decode("utf-16be");
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(b);
  } catch {
    return decode("windows-1252");
  }
}

/** Any Unicode decimal digit (Khmer ០១២, Arabic-Indic, Thai, fullwidth…) -> ASCII 0-9. */
export function toAsciiDigits(s: string): string {
  return s.replace(/\p{Nd}/gu, (ch) => {
    if (ch >= "0" && ch <= "9") return ch;
    const cp = ch.codePointAt(0)!;
    let start = cp;
    while (/\p{Nd}/u.test(String.fromCodePoint(start - 1))) start--;
    return String((cp - start) % 10);
  });
}

// Excel turns a long number saved in a number column into 8.55979E+11 and
// throws the remaining digits away -- the real phone number can't be recovered.
const SCIENTIFIC = /^\d(?:\.\d+)?e[+-]?\d+$/i;
export function isDamagedNumber(s: string): boolean {
  return SCIENTIFIC.test(s.trim());
}

/**
 * Phone text -> digits only (+ leading +): non-ASCII digits converted, spaces /
 * dashes / zero-width characters removed. "85596 9999 394", "០៩៦៩៩៩៩៣៩៤" and
 * "855969559690/087589718" all work; the last gives the first number as the
 * phone and the second as `extra`.
 */
function cleanPhone(raw: string): { phone: string; extra: string; damaged: boolean } {
  const v = toAsciiDigits(raw.normalize("NFC")).replace(/[\u200B-\u200D\uFEFF\u00A0]/g, "").trim();
  if (isDamagedNumber(v)) return { phone: "", extra: "", damaged: true };
  const parts = v
    .split(/[/,;|]+/)
    .map((p) => p.replace(/[\s\-.()]/g, ""))
    .filter(Boolean);
  return { phone: parts[0] ?? "", extra: parts[1] ?? "", damaged: false };
}

/** RFC 4180-ish: quoted fields, "" escapes, CRLF/LF, BOM, and comma/semicolon/tab delimiters. */
export function parseCsv(input: string): string[][] {
  const text = input.replace(/^\uFEFF/, "");
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = [",", ";", "\t"]
    .map((d) => ({ d, n: firstLine.split(d).length }))
    .sort((a, b) => b.n - a.n)[0].d;

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function isRealDate(y: number, m: number, d: number) {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/**
 * "" for blank, null when it can't be read as a date, else YYYY-MM-DD.
 * Accepts YYYY-MM-DD / YYYY/MM/DD, and A/B/YYYY (also - or .): day-first if A
 * can only be a day (>12), otherwise month-first (US style, like the app's
 * own mm/dd/yyyy date pickers).
 */
export function normalizeDate(value: string): string | null {
  const v = toAsciiDigits(value).trim();
  if (!v) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  let m = v.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T].*)?$/);
  if (m) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    return isRealDate(y, mo, d) ? `${y}-${pad(mo)}-${pad(d)}` : null;
  }
  m = v.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})(?:[ T].*)?$/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const y = Number(m[3]);
    const [mo, d] = a > 12 ? [b, a] : [a, b];
    return isRealDate(y, mo, d) ? `${y}-${pad(mo)}-${pad(d)}` : null;
  }
  return null;
}

function normalizeInt(value: string, min: number, max: number): number | null | "invalid" {
  const v = toAsciiDigits(value).trim();
  if (!v) return null;
  if (!/^\d+$/.test(v)) return "invalid";
  const n = Number(v);
  return n >= min && n <= max ? n : "invalid";
}

export type ParsedCustomerCsv = {
  rows: CustomerImportRow[];
  /** Rows dropped before sending (no name, duplicate phone in the file). */
  errors: CustomerImportError[];
  /** Non-fatal: bad dates/numbers that were left blank. */
  warnings: CustomerImportError[];
  /** File-level problem (no recognizable columns, empty file). */
  fatal: string | null;
  recognizedColumns: string[];
  /** Headers in the file that don't match any customer field (ignored). */
  ignoredColumns: string[];
  /** Rows skipped because Excel had turned the phone into 8.55979E+11. */
  damagedPhones: number;
};

export function parseCustomerCsv(text: string): ParsedCustomerCsv {
  return parseCustomerTable(parseCsv(text));
}

/** Rows already split into cells (first row = headings) -- from a CSV or a PDF table. */
export function parseCustomerTable(table: string[][]): ParsedCustomerCsv {
  const empty = (fatal: string): ParsedCustomerCsv => ({
    rows: [],
    errors: [],
    warnings: [],
    fatal,
    recognizedColumns: [],
    ignoredColumns: [],
    damagedPhones: 0,
  });

  if (table.length < 2) return empty("The file has no customer rows.");

  const header = table[0].map(
    (h) => HEADER_ALIASES[h.normalize("NFKC").toLowerCase().replace(/[^a-z0-9]/g, "")]
  );
  const recognizedColumns = table[0].filter((_, i) => header[i]);
  const ignoredColumns = table[0].filter((h, i) => !header[i] && h.trim());
  if (!header.includes("name") && !header.includes("firstName") && !header.includes("lastName")) {
    return empty(
      'No "Customer Name" (or First Name / Last Name) column found in the first row of the file.'
    );
  }

  const rows: CustomerImportRow[] = [];
  const errors: CustomerImportError[] = [];
  const warnings: CustomerImportError[] = [];
  const seenPhones = new Map<string, number>();
  let damagedPhones = 0;

  for (let r = 1; r < table.length; r++) {
    const cells = table[r];
    if (cells.every((c) => !c.trim())) continue;
    const rowNo = r + 1;

    const get = (key: keyof Omit<CustomerImportRow, "row">) => {
      const idx = header.indexOf(key);
      // NFC so the same Khmer/Vietnamese/etc. text always compares and stores
      // one way; NULs can't be stored in Postgres text.
      return idx >= 0 ? (cells[idx] ?? "").replace(/\u0000/g, "").normalize("NFC").trim() : "";
    };

    const firstName = get("firstName");
    const lastName = get("lastName");

    // Phones first -- they decide the name fallback and duplicate handling below.
    const cleaned = cleanPhone(get("phone"));
    let phone = cleaned.phone;
    if (cleaned.damaged) {
      // Excel destroyed the digits; keep the customer, just without a (fake) phone.
      damagedPhones++;
      warnings.push({
        row: rowNo,
        message: `Phone "${get("phone")}" was damaged by Excel — imported without a phone number`,
      });
    }
    const second = cleanPhone(get("secondPhone"));
    if (second.damaged) {
      warnings.push({ row: rowNo, message: `2nd phone "${get("secondPhone")}" was damaged by Excel — left blank` });
    }
    let secondPhone = second.phone || cleaned.extra;

    // Every row with anything in it becomes a customer. A phone number can only
    // belong to one customer, so a later row reusing one is still imported --
    // without that phone, the number kept as its 2nd phone when that is free.
    if (phone) {
      const firstSeen = seenPhones.get(phone);
      if (firstSeen !== undefined) {
        warnings.push({
          row: rowNo,
          message: `Same phone number as row ${firstSeen} — imported as a separate customer without it${
            secondPhone ? "" : " (kept as 2nd phone)"
          }`,
        });
        if (!secondPhone) secondPhone = phone;
        phone = "";
      } else {
        seenPhones.set(phone, rowNo);
      }
    }

    // No name: fall back to whatever identifies the row, so it can be found and renamed later.
    let name = get("name") || `${firstName} ${lastName}`.trim();
    if (!name) {
      name = phone || secondPhone || get("email") || get("pageUid") || get("address").split("\n")[0] || "Unnamed customer";
      warnings.push({ row: rowNo, message: `No name — using "${name}" as the name` });
    }

    const customerSince = normalizeDate(get("customerSince"));
    if (customerSince === null) {
      warnings.push({ row: rowNo, message: `Customer Since "${get("customerSince")}" isn't a valid date — left blank` });
    }
    const dob = normalizeDate(get("dob"));
    if (dob === null) {
      warnings.push({ row: rowNo, message: `DOB "${get("dob")}" isn't a valid date — left blank` });
    }
    const yob = normalizeInt(get("yob"), 1900, 2100);
    if (yob === "invalid") {
      warnings.push({ row: rowNo, message: `YOB "${get("yob")}" isn't a valid year — left blank` });
    }

    // Same Excel scientific-notation damage as phones -- a UID isn't worth keeping half-lost.
    let pageUid = get("pageUid");
    if (isDamagedNumber(pageUid)) {
      warnings.push({ row: rowNo, message: `PSID "${pageUid}" was damaged by Excel — left blank` });
      pageUid = "";
    }

    rows.push({
      row: rowNo,
      phone,
      name,
      secondPhone,
      email: get("email"),
      photoUrl: get("photoUrl"),
      address: get("address"),
      customerSince: customerSince ?? "",
      firstName,
      lastName,
      pageUid,
      source: get("source"),
      label: get("label"),
      capital: get("capital"),
      state: get("state"),
      dob: dob ?? "",
      yob: yob === "invalid" ? null : yob,
      age: toAsciiDigits(get("age")),
      gender: get("gender"),
      nationality: get("nationality"),
      followUp: get("followUp"),
    });
  }

  return { rows, errors, warnings, fatal: null, recognizedColumns, ignoredColumns, damagedPhones };
}

export function customerCsvTemplate(): string {
  const example = [
    "012345678",
    "Sok Dara",
    "",
    "dara@example.com",
    "",
    "Phnom Penh",
    "2026-01-15",
    "Dara",
    "Sok",
    "",
    "Facebook",
    "VIP",
    "Phnom Penh",
    "Phnom Penh",
    "1995-04-20",
    "1995",
    "31",
    "Male",
    "Cambodian",
    "",
  ];
  return `${CUSTOMER_CSV_HEADERS.join(",")}\n${example.join(",")}\n`;
}

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
  "Page UID",
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

/** RFC 4180-ish: quoted fields, "" escapes, CRLF/LF, BOM, and comma/semicolon/tab delimiters. */
export function parseCsv(input: string): string[][] {
  const text = input.replace(/^﻿/, "");
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
  const v = value.trim();
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
  const v = value.trim();
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
};

export function parseCustomerCsv(text: string): ParsedCustomerCsv {
  const empty = (fatal: string): ParsedCustomerCsv => ({
    rows: [],
    errors: [],
    warnings: [],
    fatal,
    recognizedColumns: [],
    ignoredColumns: [],
  });

  const table = parseCsv(text);
  if (table.length < 2) return empty("The file has no customer rows.");

  const header = table[0].map((h) => HEADER_ALIASES[h.toLowerCase().replace(/[^a-z0-9]/g, "")]);
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

  for (let r = 1; r < table.length; r++) {
    const cells = table[r];
    if (cells.every((c) => !c.trim())) continue;
    const rowNo = r + 1;

    const get = (key: keyof Omit<CustomerImportRow, "row">) => {
      const idx = header.indexOf(key);
      return idx >= 0 ? (cells[idx] ?? "").trim() : "";
    };

    const firstName = get("firstName");
    const lastName = get("lastName");
    const name = get("name") || `${firstName} ${lastName}`.trim();
    if (!name) {
      errors.push({ row: rowNo, message: "Missing customer name" });
      continue;
    }

    const phone = get("phone");
    if (phone) {
      const firstSeen = seenPhones.get(phone);
      if (firstSeen !== undefined) {
        errors.push({ row: rowNo, message: `Same phone number as row ${firstSeen} — skipped` });
        continue;
      }
      seenPhones.set(phone, rowNo);
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

    rows.push({
      row: rowNo,
      phone,
      name,
      secondPhone: get("secondPhone"),
      email: get("email"),
      photoUrl: get("photoUrl"),
      address: get("address"),
      customerSince: customerSince ?? "",
      firstName,
      lastName,
      pageUid: get("pageUid"),
      source: get("source"),
      label: get("label"),
      capital: get("capital"),
      state: get("state"),
      dob: dob ?? "",
      yob: yob === "invalid" ? null : yob,
      age: get("age"),
      gender: get("gender"),
      nationality: get("nationality"),
      followUp: get("followUp"),
    });
  }

  return { rows, errors, warnings, fatal: null, recognizedColumns, ignoredColumns };
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

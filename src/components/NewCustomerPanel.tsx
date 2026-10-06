"use client";

import { useEffect, useState, useTransition } from "react";
import { ChevronDown, X } from "lucide-react";
import { createCustomerAction, type CustomerSuggestion } from "@/app/(app)/sales/actions";
import {
  CUSTOMER_AGES,
  CUSTOMER_GENDERS,
  CUSTOMER_NATIONALITIES,
  PROVINCES,
  districtsFor,
} from "@/lib/cambodiaPlaces";
import { COUNTRY_PREFIX, toFullPhone } from "@/lib/phone";

const fieldClass =
  "w-full rounded-lg border border-border bg-transparent px-3 py-2.5 text-sm outline-none focus:border-foreground/60";

function Label({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <div className="mb-1.5 text-xs text-muted-foreground">
      {children}
      {required && <span className="text-red-500">*</span>}
    </div>
  );
}

// A row of buttons where one is picked (Age / Gender / Nationality). Picking the
// chosen one again clears it, for the optional groups.
function Choice({
  options,
  value,
  onChange,
  columns,
  clearable,
}: {
  options: string[];
  value: string;
  onChange: (v: string) => void;
  columns: string;
  clearable?: boolean;
}) {
  return (
    <div className={`grid gap-2 ${columns}`}>
      {options.map((o) => {
        const active = value === o;
        return (
          <button
            key={o}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(active && clearable ? "" : o)}
            className={`rounded-lg border px-2 py-2.5 text-sm transition-colors ${
              active
                ? "border-brand bg-brand text-white"
                : "border-border bg-muted/50 text-foreground hover:bg-muted"
            }`}
          >
            {o}
          </button>
        );
      })}
    </div>
  );
}

// "Add or search": type to narrow the list, pick one, or keep what was typed.
function PlaceBox({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  const [open, setOpen] = useState(false);
  const q = value.trim().toLowerCase();
  const shown = options.filter((o) => o.toLowerCase().includes(q));
  const exact = options.some((o) => o.toLowerCase() === q);
  return (
    <div className="relative">
      <input
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        placeholder="Add or search"
        autoComplete="off"
        className={`${fieldClass} pr-9`}
      />
      <ChevronDown className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground" />
      {open && (shown.length > 0 || (q && !exact)) && (
        <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-border bg-card py-1 text-sm shadow-lg">
          {shown.map((o) => (
            <li key={o}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange(o);
                  setOpen(false);
                }}
                className="w-full px-3 py-2 text-left hover:bg-muted"
              >
                {o}
              </button>
            </li>
          ))}
          {q && !exact && (
            <li>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setOpen(false)}
                className="w-full px-3 py-2 text-left text-brand hover:bg-muted"
              >
                Add “{value.trim()}”
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

// The "New" customer form, a panel on the right side of the Sales screen.
// Saves the customer with their whole profile at once; the cashier then carries
// on with that customer already selected.
export default function NewCustomerPanel({
  initialPhone,
  initialName,
  initialAddress,
  onClose,
  onCreated,
}: {
  initialPhone: string;
  initialName: string;
  initialAddress: string;
  onClose: () => void;
  onCreated: (customer: CustomerSuggestion, existed: boolean) => void;
}) {
  const [phone, setPhone] = useState(initialPhone);
  const [name, setName] = useState(initialName);
  const [address, setAddress] = useState(initialAddress);
  const [age, setAge] = useState("");
  const [gender, setGender] = useState("");
  const [nationality, setNationality] = useState("KH");
  const [province, setProvince] = useState("");
  const [district, setDistrict] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function save() {
    setError(null);
    if (!phone) return setError("Phone number is required");
    if (!name.trim()) return setError("Customer name is required");
    if (!province.trim()) return setError("Province is required");
    if (!age) return setError("Pick an age range");
    if (!gender) return setError("Pick a gender");
    startTransition(async () => {
      try {
        const { customer, existed } = await createCustomerAction({
          phone,
          name,
          address,
          age,
          gender,
          nationality,
          province,
          district,
        });
        onCreated(customer, existed);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't save the customer");
      }
    });
  }

  return (
    <>
      <div className="fixed inset-0 z-[60] bg-black/40" onClick={onClose} aria-hidden />
      <aside
        role="dialog"
        aria-label="New customer"
        className="fixed inset-y-0 right-0 z-[61] flex w-full max-w-md flex-col bg-card text-foreground shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-lg font-semibold">New customer</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="size-5" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <div>
            <Label required>Phone number</Label>
            <div className="flex items-center rounded-lg border border-border focus-within:border-foreground/60">
              {(phone === "" || phone.startsWith(COUNTRY_PREFIX)) && (
                <span className="border-r border-border px-3 py-2.5 text-sm text-muted-foreground select-none">
                  {COUNTRY_PREFIX}
                </span>
              )}
              <input
                type="tel"
                autoComplete="off"
                value={phone.startsWith(COUNTRY_PREFIX) ? phone.slice(COUNTRY_PREFIX.length) : phone}
                onChange={(e) => setPhone(toFullPhone(e.target.value))}
                placeholder="Phone number"
                className="w-full min-w-0 bg-transparent px-3 py-2.5 text-sm outline-none"
              />
            </div>
          </div>

          <div>
            <Label required>Customer name</Label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Customer name"
              autoComplete="off"
              className={fieldClass}
            />
          </div>

          <div>
            <Label>Address</Label>
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Address (optional)"
              autoComplete="off"
              className={fieldClass}
            />
          </div>

          <div>
            <Label required>Age</Label>
            <Choice options={CUSTOMER_AGES} value={age} onChange={setAge} columns="grid-cols-5" />
          </div>

          <div>
            <Label required>Gender</Label>
            <Choice options={CUSTOMER_GENDERS} value={gender} onChange={setGender} columns="grid-cols-2" />
          </div>

          <div>
            <Label>Nationality</Label>
            <Choice
              options={CUSTOMER_NATIONALITIES}
              value={nationality}
              onChange={setNationality}
              columns="grid-cols-3 sm:grid-cols-6"
              clearable
            />
          </div>

          <div>
            <Label required>Province</Label>
            <PlaceBox
              value={province}
              onChange={(v) => {
                setProvince(v);
                // A district belongs to one province -- drop it when that changes.
                setDistrict("");
              }}
              options={PROVINCES}
            />
          </div>

          <div>
            <Label>District</Label>
            <PlaceBox value={district} onChange={setDistrict} options={districtsFor(province)} />
          </div>
        </div>

        <div className="border-t border-border px-5 py-4">
          {error && <p className="mb-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-lg border border-border px-4 py-2.5 text-sm font-medium hover:bg-muted"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={isPending}
              className="flex-1 rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
            >
              {isPending ? "Saving..." : "Save customer"}
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}

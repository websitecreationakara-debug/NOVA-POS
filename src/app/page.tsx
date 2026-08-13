import Link from "next/link";

const roles = [
  { href: "/sales", label: "Sales", description: "Checkout & orders" },
  { href: "/stock", label: "Stock", description: "Stock levels & adjustments" },
  { href: "/accountance", label: "Accountance", description: "Reconciliation & reports" },
  { href: "/marketing", label: "Marketing", description: "Promotions & customers" },
];

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 bg-zinc-50 p-8 dark:bg-black">
      <div className="text-center">
        <h1 className="text-3xl font-semibold tracking-tight">NOVA POS</h1>
        <p className="mt-2 text-zinc-500">
          BOSBA Premium Foods · BOSBA Drink&amp;Snack · SORA SAKE
        </p>
      </div>
      <div className="grid w-full max-w-2xl grid-cols-2 gap-4">
        {roles.map((role) => (
          <Link
            key={role.href}
            href={role.href}
            className="rounded-lg border border-black/[.08] p-6 transition-colors hover:bg-black/[.03] dark:border-white/[.145] dark:hover:bg-white/[.05]"
          >
            <div className="text-lg font-medium">{role.label}</div>
            <div className="mt-1 text-sm text-zinc-500">{role.description}</div>
          </Link>
        ))}
      </div>
    </main>
  );
}

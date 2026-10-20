import { Globe } from "lucide-react";

// Marks an order that was placed by the customer on a storefront website (rather
// than rung up at the POS), so its invoice stands out in the order lists.
export default function WebsiteBadge() {
  return (
    <span
      title="Ordered by the customer on the website"
      className="ml-2 inline-flex items-center gap-1 rounded-full bg-sky-100 px-2 py-0.5 align-middle text-[10px] font-semibold text-sky-700 dark:bg-sky-950 dark:text-sky-300"
    >
      <Globe className="size-3" aria-hidden />
      Website
    </span>
  );
}

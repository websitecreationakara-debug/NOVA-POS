// Group-wide navigation fallback. Without this, clicking a sidebar link leaves
// the previous page frozen on screen until the new route's server render
// finishes (a few hundred ms each) -- only /sales and /stock felt "smooth"
// because they had their own loading.tsx. This gives every route the same
// instant transition.
export default function Loading() {
  return (
    <div className="flex h-full items-center justify-center">
      <p className="text-sm text-zinc-500">Loading…</p>
    </div>
  );
}

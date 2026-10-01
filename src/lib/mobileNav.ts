"use client";

// On phones/tablets the sidebar is a slide-out menu. The hamburger lives in the
// TopBar and the menu in the Sidebar, which are separate components, so the
// button just announces itself and the Sidebar listens (same trick as
// ORDERS_CHANGED in ordersChanged.ts).
export const TOGGLE_MOBILE_NAV = "nova:toggle-mobile-nav";

export function toggleMobileNav() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(TOGGLE_MOBILE_NAV));
  }
}

"use client";

import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

// The slot <div id="topbar-left-slot"> (see TopBar.tsx) never gets added or
// removed after mount -- only its portaled contents change -- so there's
// nothing to actually subscribe to.
function subscribe() {
  return () => {};
}
function getSlot() {
  return document.getElementById("topbar-left-slot");
}
function getServerSlot() {
  return null;
}

// Lets a page inject content into the shared TopBar's left side (otherwise
// empty) instead of rendering its own separate title/filter row below the
// TopBar -- saves that whole row of vertical space for pages like Sales
// where the product grid benefits most from it. Reads the DOM node via
// useSyncExternalStore (server snapshot: null) rather than state set from an
// effect, so this renders nothing during SSR/first paint without a
// cascading extra render once mounted.
export default function TopBarSlot({ children }: { children: React.ReactNode }) {
  const slot = useSyncExternalStore(subscribe, getSlot, getServerSlot);
  if (!slot) return null;
  return createPortal(children, slot);
}

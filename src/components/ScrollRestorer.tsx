"use client";

import { Suspense, useEffect, useLayoutEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";

// The app scrolls inside #app-scroll-area (see (app)/layout.tsx), not the window,
// so the browser/Next never put that scroll position back after opening a detail
// page and coming back. This keeps the position of every address in this tab's
// sessionStorage and restores it when the user returns: the browser Back button, a
// <BackLink>, or reloading the page.
const AREA_ID = "app-scroll-area";
const POS_PREFIX = "nova:scroll:";
// The address the user was on before the current one -- BackLink reads it.
export const PREV_URL_KEY = "nova:prev-url";
// A back navigation (popstate / BackLink click) only counts for this long.
const RESTORE_WINDOW_MS = 10_000;
// How long to keep waiting for a slow page to grow tall enough to scroll back.
const RESTORE_GIVE_UP_MS = 4_000;

function read(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // storage blocked or full -- the position just isn't remembered
  }
}

function navigationType(): string | undefined {
  const entry = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
  return entry?.type;
}

function Restorer() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const key = search ? `${pathname}?${search}` : pathname;

  const keyRef = useRef<string | null>(null);
  // When a back navigation started (0 = none pending).
  const backAt = useRef(0);
  const restoring = useRef(false);
  const initialKey = useRef<string | null>(null);
  const initialRestore = useRef(false);

  // Remember where the user is, as they scroll.
  useEffect(() => {
    const area = document.getElementById(AREA_ID);
    if (!area) return;
    let frame = 0;
    const onScroll = () => {
      if (restoring.current || frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (keyRef.current) write(POS_PREFIX + keyRef.current, String(Math.round(area.scrollTop)));
      });
    };
    area.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      area.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, []);

  // Which navigations are "going back": the browser's Back/Forward buttons, and
  // links marked data-restore-scroll (BackLink's fallback).
  useEffect(() => {
    const onPop = () => {
      backAt.current = Date.now();
    };
    const onClick = (e: MouseEvent) => {
      if ((e.target as Element | null)?.closest?.("[data-restore-scroll]")) backAt.current = Date.now();
    };
    window.addEventListener("popstate", onPop);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("popstate", onPop);
      document.removeEventListener("click", onClick, true);
    };
  }, []);

  // A new address: note where we came from, and put the scroll back if this is a
  // return trip. A layout effect, so it runs before the browser paints the new page.
  useLayoutEffect(() => {
    if (keyRef.current !== null && keyRef.current !== key) write(PREV_URL_KEY, keyRef.current);
    keyRef.current = key;

    // Opening or reloading the app on this address counts as a return too.
    if (initialKey.current === null) {
      initialKey.current = key;
      const type = navigationType();
      initialRestore.current = type === "reload" || type === "back_forward";
    } else if (key !== initialKey.current) {
      initialRestore.current = false;
    }
    const wantRestore = Date.now() - backAt.current < RESTORE_WINDOW_MS || initialRestore.current;
    backAt.current = 0;

    const area = document.getElementById(AREA_ID);
    const target = Number(read(POS_PREFIX + key));
    if (!area || !wantRestore || !(target > 0)) return;

    // The page's data may still be streaming in, so it isn't tall enough yet:
    // keep trying until it is, or the user scrolls for themselves.
    restoring.current = true;
    const started = performance.now();
    let frame = 0;
    const stop = () => {
      cancelAnimationFrame(frame);
      restoring.current = false;
      for (const ev of ["wheel", "touchstart", "keydown", "mousedown"]) area.removeEventListener(ev, stop);
    };
    for (const ev of ["wheel", "touchstart", "keydown", "mousedown"]) {
      area.addEventListener(ev, stop, { passive: true });
    }
    const tick = () => {
      const elapsed = performance.now() - started;
      if (area.scrollHeight - area.clientHeight >= target - 1 && Math.abs(area.scrollTop - target) > 1) {
        area.scrollTop = target;
      }
      if (elapsed > RESTORE_GIVE_UP_MS) {
        stop();
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    tick();
    return stop;
  }, [key]);

  return null;
}

export default function ScrollRestorer() {
  // useSearchParams needs a Suspense boundary above it.
  return (
    <Suspense fallback={null}>
      <Restorer />
    </Suspense>
  );
}

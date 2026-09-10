export const EMBEDDED_RETURN_TO_NOW_MS = 20_000;

interface CalendarIdleReturnOptions {
  isEligible: () => boolean;
  returnToNow: () => void;
  isProgrammaticScroll?: () => boolean;
  delayMs?: number;
  initialDelayMs?: number;
}

/** One instance-local deadline, reset by scrolling (including touch momentum). */
export function installCalendarIdleReturn(
  container: HTMLElement,
  {
    isEligible,
    returnToNow,
    isProgrammaticScroll = () => false,
    delayMs = EMBEDDED_RETURN_TO_NOW_MS,
    initialDelayMs = 200,
  }: CalendarIdleReturnOptions,
): () => void {
  const doc = container.ownerDocument;
  const win = doc.defaultView!;
  let timer: number | null = null;
  let pointerHeld = false;
  let disposed = false;

  const cancel = () => {
    if (timer !== null) win.clearTimeout(timer);
    timer = null;
  };
  const arm = (delay: number) => {
    cancel();
    if (disposed || pointerHeld) return;
    timer = win.setTimeout(() => {
      timer = null;
      if (disposed || pointerHeld || !container.isConnected || doc.hidden) return;
      if (!container.getClientRects().length || !isEligible()) return;
      returnToNow();
    }, delay);
  };
  const belongsToTimeline = (event: Event): boolean => {
    const target = event.target as HTMLElement | null;
    if (!target || !container.contains(target) || typeof target.closest !== "function") return false;
    if (target.closest('input, textarea, [contenteditable="true"]')) return false;
    return !!target.closest(
      '.fc-timegrid, .bases-calendar-continuous-scroll-container, .bases-calendar-scroll-surface',
    );
  };
  const activity = (event: Event) => {
    if (!belongsToTimeline(event)) return;
    if (event.type === "scroll" && isProgrammaticScroll()) return;
    if (event.type === "keydown" && ![
      "ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " ",
    ].includes((event as KeyboardEvent).key)) return;
    arm(delayMs);
  };
  const pointerDown = (event: Event) => {
    if (!belongsToTimeline(event)) return;
    pointerHeld = true;
    cancel();
  };
  const pointerUp = () => {
    if (!pointerHeld) return;
    pointerHeld = false;
    arm(delayMs);
  };
  const passiveCapture = { capture: true, passive: true };
  const activityEvents = ["scroll", "wheel", "touchmove", "touchend", "keydown"];
  activityEvents.forEach((type) => container.addEventListener(type, activity, passiveCapture));
  container.addEventListener("pointerdown", pointerDown, passiveCapture);
  doc.addEventListener("pointerup", pointerUp, passiveCapture);
  doc.addEventListener("pointercancel", pointerUp, passiveCapture);
  // A fresh page render starts at now. Later query/event updates keep the deadline.
  arm(initialDelayMs);

  return () => {
    disposed = true;
    cancel();
    activityEvents.forEach((type) => container.removeEventListener(type, activity, true));
    container.removeEventListener("pointerdown", pointerDown, true);
    doc.removeEventListener("pointerup", pointerUp, true);
    doc.removeEventListener("pointercancel", pointerUp, true);
  };
}

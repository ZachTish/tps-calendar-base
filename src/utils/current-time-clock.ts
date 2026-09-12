interface ClockEnvironment {
  now(): Date;
  setTimeout(callback: () => void, delay: number): number;
  clearTimeout(id: number): void;
  events: Pick<Window, "addEventListener" | "removeEventListener">;
}

/** One display-only timer per mounted label; no event queries or vault work. */
export function startCurrentTimeClock(
  update: (date: Date) => void,
  environment: ClockEnvironment = {
    now: () => new Date(),
    setTimeout: (callback, delay) => window.setTimeout(callback, delay),
    clearTimeout: (id) => window.clearTimeout(id),
    events: window,
  },
): () => void {
  let timer: number | undefined;
  let disposed = false;
  const refresh = () => {
    if (disposed) return;
    if (timer !== undefined) environment.clearTimeout(timer);
    const now = environment.now();
    update(now);
    timer = environment.setTimeout(refresh, 60_000 - (now.getTime() % 60_000));
  };
  environment.events.addEventListener("focus", refresh);
  environment.events.addEventListener("visibilitychange", refresh);
  refresh();
  return () => {
    disposed = true;
    if (timer !== undefined) environment.clearTimeout(timer);
    environment.events.removeEventListener("focus", refresh);
    environment.events.removeEventListener("visibilitychange", refresh);
  };
}

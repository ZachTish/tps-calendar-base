const CANCELLED_TITLE_PATTERN = /^\s*cancel(?:l)?ed\s*:/i;

export function isCancelledCalendarTitle(title: unknown): boolean {
    return CANCELLED_TITLE_PATTERN.test(String(title ?? ""));
}

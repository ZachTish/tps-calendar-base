import type { EventApi } from "@fullcalendar/core";

type Transfer = { draggedEl: HTMLElement; event: EventApi; revert: () => void };
const transfers = new WeakMap<HTMLElement, { revert: () => void; start: Date | null; end: Date | null }>();

/** FullCalendar removes a source event before eventReceive; retain its rollback. */
export function rememberCalendarTransfer(info: Transfer): void {
  transfers.set(info.draggedEl, { revert: info.revert, start: info.event.start, end: info.event.end });
}

/** Restore both transient calendars before prompting; only the normal writer commits. */
export function receiveCalendarTransfer(info: Transfer, onDrop: (info: any) => void): void {
  const source = transfers.get(info.draggedEl);
  transfers.delete(info.draggedEl);
  const event = {
    start: info.event.start, end: info.event.end, allDay: info.event.allDay,
    extendedProps: info.event.extendedProps,
  };
  info.revert();
  source?.revert();
  if (!source || !event.start || !event.extendedProps.calendarEntry?.entry) return;
  onDrop({ event, oldEvent: { start: source.start, end: source.end }, revert: () => {} });
}

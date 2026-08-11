export interface CalendarEventNativeGesturePolicy {
  enableNativeFileDrag: boolean;
  enableNativeContextMenu: boolean;
}

/**
 * FullCalendar owns touch dragging. Native HTML drag and context-menu gestures
 * compete with its delayed touch interaction on iOS, so those browser-native
 * handlers are desktop-only. Auxiliary dates never support file dragging.
 */
export function resolveCalendarEventNativeGesturePolicy(
  isMobile: boolean,
  isAuxiliaryDate: boolean,
): CalendarEventNativeGesturePolicy {
  return {
    enableNativeFileDrag: !isMobile && !isAuxiliaryDate,
    enableNativeContextMenu: !isMobile,
  };
}

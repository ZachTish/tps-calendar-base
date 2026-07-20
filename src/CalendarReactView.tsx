import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import "./calendar.css";
import "./embed-calendar.css";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin from "@fullcalendar/interaction";
import timeGridPlugin from "@fullcalendar/timegrid";
import {
  DateSelectArg,
  EventClickArg,
  EventDropArg,
  EventMountArg,
  DatesSetArg,
} from "@fullcalendar/core";
import { BasesEntry, BasesPropertyId, Platform, Value, App, Menu, setIcon } from "obsidian";
import { useApp } from "./hooks";
import * as logger from "./logger";
import {
  calculateSlotHeightFromZoom,
  calculateSlotZoom,
  DEFAULT_CONDENSE_LEVEL,
  DEFAULT_PRIORITY_COLOR_MAP,
} from "./utils";
import { ExternalCalendarEvent } from "./types";

// Extracted hooks
import { useCalendarZoom } from "./hooks/useCalendarZoom";
import { useTimeFollowing } from "./hooks/useTimeFollowing";
import { useCalendarEvents, normalizeValue, tryGetValue } from "./hooks/useCalendarEvents";

// Extracted components
import { useEventRenderer } from "./components/EventRenderer";
import { CalendarNavigation } from "./components/CalendarNavigation";
import { ContinuousScrollView } from "./components/ContinuousScrollView";
import { revealCompletedCheckboxesForFile, shouldForceBaseLinkPreview } from "./tps-gcm-api";
import {
  buildCalendarExternalDropRequest,
  buildCalendarExternalDropPreviewRange,
  hasCalendarExternalDropData,
  type CalendarExternalDropPayload,
} from "./utils/calendar-external-drop";
import { getAdaptiveTimeGridDayCount } from "./utils/calendar-day-count";
import { getInclusiveCalendarDayCount } from "./utils/filter-date-utils";

const DEFAULT_SLOT_MIN_TIME = "00:00:00";
const DEFAULT_SLOT_MAX_TIME = "24:00:00";
const DEFAULT_SCROLL_TIME = "08:00:00";
const PLUGINS = [dayGridPlugin, timeGridPlugin, interactionPlugin];
const HEADER_HEIGHT_VAR = "var(--tps-bases-header-height, 84px)";
const CALENDAR_EVENT_DENSITY_CSS = `
.bases-calendar-wrapper .bases-calendar-event-title,
.bases-calendar-wrapper .fc-event-title {
  font-weight: var(--tps-event-title-weight, 400) !important;
  line-height: var(--tps-event-title-line-height, 1.1) !important;
  letter-spacing: 0 !important;
  padding-left: 2px !important;
  padding-right: 2px !important;
  text-shadow: var(--tps-event-title-shadow, 0 1px 1px rgba(0, 0, 0, 0.28)) !important;
}

.bases-calendar-wrapper .bases-calendar-event-content,
.bases-calendar-wrapper .bases-calendar-event-content > div:first-child {
  min-width: 0;
}

.bases-calendar-wrapper .bases-calendar-event-content > div:first-child {
  gap: 2px !important;
}

.bases-calendar-wrapper .bases-calendar-event-frontmatter-icon {
  width: 12px !important;
  height: 12px !important;
  margin-right: 0 !important;
}

.bases-calendar-wrapper .fc .fc-timegrid .bases-all-day-event .fc-event-title,
.bases-calendar-wrapper .fc .fc-timegrid .bases-all-day-event .bases-calendar-event-title,
.bases-calendar-wrapper .fc-dayGridMonth-view .fc-daygrid-event .fc-event-title,
.bases-calendar-wrapper .fc-dayGridMonth-view .fc-daygrid-event .bases-calendar-event-title {
  font-weight: var(--tps-event-title-weight, 400) !important;
  padding-left: 1px !important;
  padding-right: 1px !important;
}

.bases-calendar-wrapper .fc-dayGridMonth-view .fc-daygrid-event {
  font-weight: var(--tps-event-title-weight, 400) !important;
  padding-left: 3px !important;
  padding-right: 3px !important;
}
`;
type ViewMode = "day" | "3d" | "4d" | "5d" | "7d" | "week" | "month" | "continuous" | "filter-based";
type ScrollSnapshotKind = "timegrid" | "continuous" | "surface";
const HOURS_TOGGLE_EDGE_THRESHOLD_PX = 24;
const IDLE_RETURN_TO_NOW_MS = 30_000;
const MOBILE_UI_KEYBOARD_HIDDEN_CLASS = 'tps-tps-mobile-ui-keyboard-hidden';
const MOBILE_UI_GESTURE_HIDDEN_CLASS = 'tps-tps-mobile-ui-gesture-hidden';
const MOBILE_KEYBOARD_COLLAPSE_THRESHOLD_PX = 140;
const MOBILE_SWIPE_HIDE_TIMEOUT_MS = 260;

function getConfiguredTimeGridDayCount(viewMode: ViewMode): number {
  if (viewMode === "day") return 1;
  if (viewMode === "3d") return 3;
  if (viewMode === "4d") return 4;
  if (viewMode === "5d") return 5;
  if (viewMode === "7d" || viewMode === "week") return 7;
  return 7;
}

// ---------------------------------------------------------------------------
// Persistent canvas-scale BCR patch
// ---------------------------------------------------------------------------
// Obsidian canvas applies transform:scale() to its viewport. FullCalendar's
// PositionCache builds slot top/height arrays via getBoundingClientRect(),
// which returns *visual* (scaled) pixels. FC then uses those values as
// layout-pixel `style.top` offsets for events and the now-indicator, so
// everything is mis-positioned at any canvas zoom ≠ 100%.
//
// Patching only during updateSize() doesn't help because PositionCache is
// also rebuilt on every React componentDidUpdate (resize, slot-zoom change,
// event data change, etc.).
//
// Solution: while any embed is mounted, temporarily override
// Element.prototype.getBoundingClientRect so that calls on elements *inside*
// a registered canvas-embed container return unscaled layout-pixel values.
// Multiple simultaneous embeds are handled via a shared Set + ref count.
// ---------------------------------------------------------------------------
const _canvasEmbedContainers = new Set<HTMLElement>();
const _origBCR = Element.prototype.getBoundingClientRect;
let _bcrPatched = false;
const _scaleCache = new Map<HTMLElement, { scale: number; ts: number }>();
const _SCALE_TTL = 80; // ms — short-lived cache so zoom changes propagate quickly

function _getContainerScale(container: HTMLElement): number {
  const now = Date.now();
  const hit = _scaleCache.get(container);
  if (hit && now - hit.ts < _SCALE_TTL) return hit.scale;
  const fcEl = container.querySelector('.fc') as HTMLElement | null;
  if (!fcEl || fcEl.offsetWidth === 0) {
    _scaleCache.set(container, { scale: 1, ts: now });
    return 1;
  }
  const r = _origBCR.call(fcEl);
  const scale = r.width / fcEl.offsetWidth;
  _scaleCache.set(container, { scale, ts: now });
  return scale;
}

// FullCalendar's coordinate system under canvas scale(n) — two problems:
//
// 1. RENDERING (PositionCache.build):
//    FC calls getBoundingClientRect() on structural slat/col elements to build
//    position arrays, then writes the values directly to style.top (CSS px).
//    BCR returns visual pixels; style.top needs CSS (layout) pixels.
//    Fix: unscale BCR for the four structural measurement elements.
//
// 2. HIT-TESTING / INTERACTION (PointerDragging + HitDragging):
//    FC computes: relativePos = event.clientY − positionCache.originRect.top
//    The "origin" element for both PositionCache.build AND for hit-testing is
//    the *same* .fc-timegrid-slots element.  After fix #1 its BCR.top is
//    returned as visualTop/scale.  So the hit equation needs:
//
//      event.clientY / scale − originBCR.top/scale
//      = (event.clientY − originBCR_visual.top) / scale
//      = visualRelY / scale
//      = layoutRelY  ✓  matches PositionCache layout-px entries.
//
//    So we only need to scale event.clientX/Y by 1/scale.
//    We do this by stopping the original event and re-dispatching a
//    *synthetic* PointerEvent / MouseEvent whose coords are already scaled.
//    Synthetic events are ordinary JS objects — all properties writable.
//
// NOTE: contextmenu and click are intentionally excluded from re-dispatch so
// context-menu popup positioning and link clicks stay in visual-px space.

function _isFCMeasurementEl(el: Element): boolean {
  const tag = el.tagName;
  if (tag === 'TR') return true;                                              // slat rows
  if (tag === 'TD' && el.classList.contains('fc-timegrid-col')) return true; // col cells
  if (el.classList.contains('fc-timegrid-slots')) return true;               // slat/hit origin
  if (el.classList.contains('fc-timegrid-cols')) return true;                // col origin
  return false;
}

// Symbol used to mark synthetic events we create so our listener ignores them.
const _SCALED_SYM = Symbol('tps-canvas-scaled');
const _DRAG_EVENT_TYPES = ['mousedown','mousemove','mouseup'] as const;
let _pointerPatchInstalled = false;

function _interceptAndScaleEvent(e: Event): void {
  if ((e as any)[_SCALED_SYM]) return; // our own re-dispatched event — skip
  const target = e.target as Element | null;
  if (!target) return;
  for (const container of _canvasEmbedContainers) {
    if (!container.contains(target)) continue;
    const scale = _getContainerScale(container);
    if (Math.abs(scale - 1) < 0.005) return;

    // Stop the original so FC never sees it; we'll re-dispatch with correct coords.
    // PointerEvents stay native: FullCalendar relies on the browser pointer
    // lifecycle for selection/drag-create, and synthetic pointer events can
    // break that path inside Obsidian Canvas.
    e.stopImmediatePropagation();

    const me = e as MouseEvent;
    const inv = 1 / scale;

    const base: MouseEventInit = {
      bubbles: e.bubbles,
      cancelable: e.cancelable,
      composed: true,
      view: me.view,
      clientX:   me.clientX   * inv,
      clientY:   me.clientY   * inv,
      screenX:   me.screenX   * inv,
      screenY:   me.screenY   * inv,
      movementX: me.movementX * inv,
      movementY: me.movementY * inv,
      button:    me.button,
      buttons:   me.buttons,
      ctrlKey:   me.ctrlKey,
      shiftKey:  me.shiftKey,
      altKey:    me.altKey,
      metaKey:   me.metaKey,
      relatedTarget: me.relatedTarget,
    };

    const synth = new MouseEvent(e.type, base);
    (synth as any)[_SCALED_SYM] = true;
    target.dispatchEvent(synth);
    return;
  }
}

function _installCanvasBCRPatch(): void {
  if (_bcrPatched) return;
  _bcrPatched = true;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (Element.prototype as any).getBoundingClientRect = function (this: Element) {
    const r = _origBCR.call(this);
    if (!_isFCMeasurementEl(this)) return r;
    for (const container of _canvasEmbedContainers) {
      if (!container.contains(this)) continue;
      const scale = _getContainerScale(container);
      if (Math.abs(scale - 1) < 0.005) return r;
      return new DOMRect(r.x / scale, r.y / scale, r.width / scale, r.height / scale);
    }
    return r;
  };

  if (!_pointerPatchInstalled) {
    _pointerPatchInstalled = true;
    for (const type of _DRAG_EVENT_TYPES) {
      // Non-passive so we can call stopImmediatePropagation
      window.addEventListener(type, _interceptAndScaleEvent, { capture: true, passive: false });
    }
  }
}

function _uninstallCanvasBCRPatch(): void {
  if (_canvasEmbedContainers.size > 0) return;
  if (!_bcrPatched) return;
  _bcrPatched = false;
  Element.prototype.getBoundingClientRect = _origBCR;
  if (_pointerPatchInstalled) {
    _pointerPatchInstalled = false;
    for (const type of _DRAG_EVENT_TYPES) {
      window.removeEventListener(type, _interceptAndScaleEvent, { capture: true });
    }
  }
}

export interface CalendarEntry {
  entry: BasesEntry;
  startDate: Date;
  endDate?: Date;
  title?: string;
  forceAllDay?: boolean;
  isGhost?: boolean;
  ghostDate?: Date;
  isExternal?: boolean;
  isArchivedExternalPlaceholder?: boolean;
  archivedExternalCount?: number;
  archivedExternalEntries?: CalendarEntry[];
  archivedExternalTooltip?: string;
  externalEvent?: ExternalCalendarEvent;
  color?: string;
  isHidden?: boolean;
  status?: string;
  priority?: string;
  style?: string;

  // Pre-calculated styles to avoid logic in View
  cssClasses?: string[];
  backgroundColor?: string;
  borderColor?: string;
  iconName?: string;
  iconColor?: string;
  isAuxiliaryDate?: boolean;
  auxiliaryDateField?: string;
  auxiliaryDateTooltip?: string;
  auxiliaryDateCount?: number;
  auxiliaryDateEntries?: CalendarEntry[];
}

export type CalendarDayContext = {
  openDailyTasks: number;
  scheduledTasks: number;
  scheduledNotes: number;
  externalEvents: number;
};

type CalendarDayMarkerOverlay = {
  dateKey: string;
  auxiliary: number;
  archived: number;
  title: string;
  left: number;
  top: number;
};

interface CalendarReactViewProps {
  entries: CalendarEntry[];
  weekStartDay: number;
  properties: BasesPropertyId[];
  onEntryClick: (entry: CalendarEntry, isModEvent: boolean, event?: MouseEvent) => void;
  onEntryContextMenu: (evt: React.MouseEvent, entry: BasesEntry) => void;
  onEventDrop?: (
    entry: BasesEntry,
    newStart: Date,
    newEnd?: Date,
    allDay?: boolean,
    scope?: "all" | "single",
    oldStart?: Date,
    oldEnd?: Date,
  ) => Promise<void>;
  onEventResize?: (
    entry: BasesEntry,
    newStart: Date,
    newEnd?: Date,
    allDay?: boolean,
    scope?: "all" | "single",
    oldStart?: Date,
    oldEnd?: Date,
  ) => Promise<void>;
  onCreateSelection?: (start: Date, end: Date, allDay?: boolean) => Promise<void>;
  onExternalDrop?: (payload: CalendarExternalDropPayload, start: Date, allDay: boolean) => Promise<void>;
  editable: boolean;

  condenseLevel?: number;
  onCondenseLevelChange?: (level: number) => void;
  showFullDay?: boolean;
  viewMode: ViewMode;
  slotRange?: { min: string; max: string };
  navStep?: number;
  onToggleFullDay?: () => void;
  allDayProperty?: BasesPropertyId | null;
  initialDate?: Date;
  currentDate?: Date;
  jumpTargetDate?: Date;
  onJumpTargetApplied?: () => void;
  onDateChange?: (date: Date) => void;
  showHiddenHoursToggle?: boolean;
  defaultEventDuration?: number;
  embeddedHeight?: number;
  isEmbedded?: boolean;
  preserveEmbeddedDayCount?: boolean;
  onDateClick?: (date: Date, targetEl?: HTMLElement, event?: MouseEvent) => void;
  allDayLimit?: number;
  headerContainer?: HTMLElement;
  showNavButtons?: boolean;
  navigationLocked?: boolean;
  entryBoundsStart?: Date;
  entryBoundsEnd?: Date;
  navigationBoundsStart?: Date;
  navigationBoundsEnd?: Date;

  // Calendar appearance settings
  allDayEventHeight?: number;
  allDayMaxRows?: number;
  allDayStickyScroll?: boolean;
  dayHeaderFormatSetting?: "short" | "long" | "narrow";
  dayHeaderShowDate?: boolean;
  timeFormatSetting?: "12h" | "24h";
  slotDurationMinutes?: number;
  minEventHeight?: number;
  snapDurationMinutes?: number;
  snapCreateSelections?: boolean;
  createSnapDurationMinutes?: number;
  defaultScrollTimeSetting?: string;
  showNowIndicator?: boolean;
  pastEventOpacity?: number;
  eventFontSize?: "small" | "default" | "large";
  /** Status values that should be dimmed as "done". Defaults to ["complete","wont-do"]. */
  doneStatuses?: string[];
  dayContextByDate?: Record<string, CalendarDayContext>;
}

const normalizeDisplayTitle = (raw: string): string => {
  const trimmed = (raw || "").trim();
  if (!trimmed) return "";
  if (/^\\d{4}-\\d{2}-\\d{2}$/.test(trimmed)) return trimmed;
  return trimmed.replace(/ \\d{4}-\\d{2}-\\d{2}$/, "");
};

const formatDateKey = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const parseDateKey = (dateKey: string): Date => {
  const match = String(dateKey || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return new Date(dateKey);
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
};

const normalizeMinuteInterval = (value: unknown, fallback: number): number => {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.max(1, Math.round(parsed));
};

const formatFullCalendarDuration = (minutesValue: unknown, fallback: number): string => {
  const minutes = normalizeMinuteInterval(minutesValue, fallback);
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(remainder).padStart(2, "0")}:00`;
};

const snapDateToMinuteGate = (date: Date, minutesValue: number, direction: "floor" | "ceil"): Date => {
  const minutes = normalizeMinuteInterval(minutesValue, 15);
  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);
  const millisSinceDayStart = date.getTime() - startOfDay.getTime();
  const intervalMillis = minutes * 60000;
  const intervals = direction === "ceil"
    ? Math.ceil(millisSinceDayStart / intervalMillis)
    : Math.floor(millisSinceDayStart / intervalMillis);
  return new Date(startOfDay.getTime() + intervals * intervalMillis);
};

const normalizeCreateSelectionRange = (
  selection: DateSelectArg,
  snapEnabled: boolean,
  createSnapDurationMinutes: number,
): { start: Date; end: Date; allDay: boolean } => {
  const start = selection.start ?? new Date();
  const end = selection.end ?? new Date(start.getTime() + createSnapDurationMinutes * 60000);
  const allDay = !!selection.allDay;

  if (allDay || !snapEnabled) {
    return { start, end, allDay };
  }

  const interval = normalizeMinuteInterval(createSnapDurationMinutes, 15);
  const snappedStart = snapDateToMinuteGate(start, interval, "floor");
  let snappedEnd = snapDateToMinuteGate(end, interval, "ceil");
  if (snappedEnd.getTime() <= snappedStart.getTime()) {
    snappedEnd = new Date(snappedStart.getTime() + interval * 60000);
  }
  return { start: snappedStart, end: snappedEnd, allDay };
};

const getCalendarMarkerFallbackText = (iconName: string): string => {
  const normalized = String(iconName || "").toLowerCase();
  if (normalized.includes("alert") || normalized.includes("warning")) return "!";
  if (normalized.includes("file") || normalized.includes("calendar")) return "□";
  return "•";
};

const CalendarMarkerIcon: React.FC<{ iconName: string }> = ({ iconName }) => {
  const iconRef = useCallback((node: HTMLSpanElement | null) => {
    if (!node) return;
    node.empty();
    try {
      setIcon(node, iconName);
      if (!node.querySelector("svg")) {
        node.textContent = getCalendarMarkerFallbackText(iconName);
      }
    } catch {
      node.textContent = getCalendarMarkerFallbackText(iconName);
    }
  }, [iconName]);

  return <span ref={iconRef} className="tps-calendar-day-marker-icon" />;
};

const addDays = (date: Date, days: number): Date => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

const resolveTimeGridPointerDateTime = (
  root: HTMLElement,
  clientX: number,
  clientY: number,
  fallbackDate: Date | undefined,
): Date | null => {
  if (!fallbackDate) return null;

  const columns = Array.from(root.querySelectorAll<HTMLElement>(".fc-timegrid-col[data-date]"))
    .filter((column) => {
      const rect = column.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });
  const column = columns.find((candidate) => {
    const rect = candidate.getBoundingClientRect();
    return clientX >= rect.left && clientX <= rect.right;
  });
  const dateKey = column?.dataset.date || formatDateKey(fallbackDate);

  const slots = Array.from(root.querySelectorAll<HTMLElement>(
    ".fc-timegrid-slot-lane[data-time], .fc-timegrid-slot[data-time]",
  )).filter((slot) => {
    const rect = slot.getBoundingClientRect();
    return rect.height > 0 && rect.width > 0;
  });
  if (!slots.length) return null;

  let selectedSlot = slots[0];
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const slot of slots) {
    const rect = slot.getBoundingClientRect();
    const distance = Math.abs(rect.top - clientY);
    if (distance < bestDistance) {
      selectedSlot = slot;
      bestDistance = distance;
    }
  }

  const [yearRaw, monthRaw, dayRaw] = dateKey.split("-");
  const [hoursRaw, minutesRaw, secondsRaw] = String(selectedSlot.dataset.time || "00:00:00").split(":");
  const year = Number.parseInt(yearRaw || "", 10);
  const month = Number.parseInt(monthRaw || "", 10);
  const day = Number.parseInt(dayRaw || "", 10);
  const hours = Number.parseInt(hoursRaw || "0", 10) || 0;
  const minutes = Number.parseInt(minutesRaw || "0", 10) || 0;
  const seconds = Number.parseInt(secondsRaw || "0", 10) || 0;
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;

  return new Date(year, month - 1, day, hours, minutes, seconds, 0);
};

const timeToMinutes = (value: string): number => {
  const [hoursRaw, minutesRaw] = value.split(":");
  const hours = Number.parseInt(hoursRaw ?? "0", 10) || 0;
  const minutes = Number.parseInt(minutesRaw ?? "0", 10) || 0;
  return Math.max(0, hours * 60 + minutes);
};

export const CalendarReactView: React.FC<CalendarReactViewProps> = ({
  entries,
  weekStartDay,
  properties,
  onEntryClick,
  onEntryContextMenu,
  onEventDrop,
  onEventResize,
  onCreateSelection,
  onExternalDrop,
  editable,

  condenseLevel,
  onCondenseLevelChange,
  showFullDay,
  viewMode,
  slotRange,
  navStep,
  onToggleFullDay,
  allDayProperty,
  initialDate,
  currentDate,
  jumpTargetDate,
  onJumpTargetApplied,
  onDateChange,
  showHiddenHoursToggle = true,
  defaultEventDuration = 60,
  embeddedHeight,
  isEmbedded,
  preserveEmbeddedDayCount = false,
  onDateClick,
  headerContainer,
  showNavButtons,
  navigationLocked = false,
  entryBoundsStart,
  entryBoundsEnd,
  navigationBoundsStart,
  navigationBoundsEnd,
  allDayLimit,

  // Calendar appearance settings
  allDayEventHeight = 24,
  allDayMaxRows,
  allDayStickyScroll = true,
  dayHeaderFormatSetting = "short",
  dayHeaderShowDate = true,
  timeFormatSetting = "12h",
  slotDurationMinutes = 30,
  minEventHeight = 20,
  snapDurationMinutes = 5,
  snapCreateSelections = true,
  createSnapDurationMinutes = 15,
  defaultScrollTimeSetting = "08:00",
  showNowIndicator = true,
  pastEventOpacity = 50,
  eventFontSize = "default",
  doneStatuses,
}) => {
  const app = useApp() || ((window as any).app as App);
  const calendarRef = useRef<FullCalendar>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const isSameCalendarDay = useCallback((a: Date, b: Date): boolean => (
    a.getFullYear() === b.getFullYear()
      && a.getMonth() === b.getMonth()
      && a.getDate() === b.getDate()
  ), []);
  const [containerHeight, setContainerHeight] = useState<number>(0);
  const [containerWidth, setContainerWidth] = useState<number>(0);
  // Ref and state for the flex child that holds FullCalendar (excludes nav chrome).
  // Used in embed mode so fullCalendarHeight doesn't include the toolbar height.
  const calendarBodyRef = useRef<HTMLDivElement>(null);
  const [calendarBodyHeight, setCalendarBodyHeight] = useState<number>(0);
  const [isEmbedMode, setIsEmbedMode] = useState(isEmbedded === true);
  const [isCanvasEmbed, setIsCanvasEmbed] = useState(false);
  const [localShowFullDay, setLocalShowFullDay] = useState(
    showFullDay ?? true,
  );
  const [isTodayVisible, setIsTodayVisible] = useState(true);
  const [visibleDateRange, setVisibleDateRange] = useState<{ start: Date; end: Date } | null>(null);
  const [headerTitle, setHeaderTitle] = useState("");
  const [hiddenTimeVisible, setHiddenTimeVisible] = useState(false);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [isInternalDragging, setIsInternalDragging] = useState(false);
  const suppressEntryClickUntilRef = useRef(0);
  const mobileEntryTapRef = useRef<{ path: string; at: number } | null>(null);
  const mobileEntryActionTimeoutRef = useRef<
    number | ReturnType<typeof window.setTimeout> | ReturnType<typeof setTimeout> | null
  >(null);
  const [isMobileNavHidden, setIsMobileNavHidden] = useState(false);
  const [allDayExpanded, setAllDayExpanded] = useState(false);
  const [selectionPreview, setSelectionPreview] = useState<{ start: Date; end: Date; allDay: boolean } | null>(null);
  const [selectionPreviewPosition, setSelectionPreviewPosition] = useState<{ top: number; left: number } | null>(null);
  const [externalDropPreview, setExternalDropPreview] = useState<{ start: Date; end: Date; allDay: boolean } | null>(null);
  const [hoursToggleEdge, setHoursToggleEdge] = useState<"top" | "bottom">("bottom");
  const [hoursToggleVisible, setHoursToggleVisible] = useState(false);
  const [navScrollHidden, setNavScrollHidden] = useState(false);
  const [dayMarkerOverlays, setDayMarkerOverlays] = useState<CalendarDayMarkerOverlay[]>([]);
  // Accumulator state for direction-based scroll hiding (same pattern as GCM).
  const navScrollStateRef = useRef({ lastTop: 0, accum: 0 });
  const navScrollHideArmedRef = useRef(false);

  const dragCounterRef = useRef(0);
  const eventContextMenuHandlersRef = useRef(new Map<HTMLElement, (event: MouseEvent) => void>());
  // Ref so closures (eventDidMount handlers) can always read the current value without being rebuilt.
  const isEmbedModeRef = useRef(isEmbedMode);
  useEffect(() => { isEmbedModeRef.current = isEmbedMode; }, [isEmbedMode]);
  const onDateClickRef = useRef<typeof onDateClick>(onDateClick);
  useEffect(() => { onDateClickRef.current = onDateClick; }, [onDateClick]);
  const lastObservedScrollTopRef = useRef(0);
  const lastObservedScrollTargetRef = useRef<HTMLElement | null>(null);
  const mobileUiKeyboardHiddenRef = useRef(false);
  const mobileUiGestureHiddenRef = useRef(false);
  const mobileKeyboardBaseHeightRef = useRef(0);
  const mobileKeyboardDetectionTimerRef = useRef<
    number | ReturnType<typeof window.setTimeout> | ReturnType<typeof setTimeout> | null
  >(null);
  const mobileSwipeRevealTimerRef = useRef<
    number | ReturnType<typeof window.setTimeout> | ReturnType<typeof setTimeout> | null
  >(null);
  const [pendingChange, setPendingChange] = useState<{
    type: 'drop' | 'resize';
    info: any;
    entry: BasesEntry;
    newStart: Date;
    newEnd: Date | null;
    allDay: boolean;
    oldStart?: Date;
    oldEnd?: Date;
  } | null>(null);

  const [pendingCreation, setPendingCreation] = useState<{
    start: Date;
    end: Date;
  } | null>(null);

  // Hide the floating nav on scroll-down, reveal on scroll-up — same accumulator
  // pattern used by the GCM persistent menu.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const HIDE_THRESHOLD = 40;
    const SHOW_THRESHOLD = 20;
    const state = navScrollStateRef.current;
    state.lastTop = 0;
    state.accum = 0;
    navScrollHideArmedRef.current = false;
    setNavScrollHidden(false);

    const armUserScrollHide = () => {
      navScrollHideArmedRef.current = true;
    };

    const listener = (evt: Event) => {
      const target = evt.target as HTMLElement | null;
      if (!target) return;
      const top = (target as HTMLElement).scrollTop ?? 0;
      const delta = top - state.lastTop;
      state.lastTop = top;
      if (!navScrollHideArmedRef.current) return;
      if ((delta > 0 && state.accum < 0) || (delta < 0 && state.accum > 0)) {
        state.accum = 0;
      }
      state.accum += delta;
      if (state.accum > HIDE_THRESHOLD) {
        setNavScrollHidden(true);
        state.accum = 0;
      } else if (state.accum < -SHOW_THRESHOLD) {
        setNavScrollHidden(false);
        state.accum = 0;
      }
    };

    // capture:true catches scroll on any descendant (fc-scroller, scroll-surface, etc.)
    container.addEventListener('scroll', listener, { passive: true, capture: true });
    container.addEventListener('wheel', armUserScrollHide, { passive: true, capture: true });
    container.addEventListener('touchmove', armUserScrollHide, { passive: true, capture: true });
    return () => {
      container.removeEventListener('scroll', listener, { capture: true } as any);
      container.removeEventListener('wheel', armUserScrollHide, { capture: true } as any);
      container.removeEventListener('touchmove', armUserScrollHide, { capture: true } as any);
    };
  }, []);

  // Detect mobile platform
  const isMobile = Platform.isMobile;
  const mobileNavHidden = isInternalDragging;
  const activePlugins = isMobile ? [dayGridPlugin, timeGridPlugin, interactionPlugin] : PLUGINS;
  const allowEdit = editable;
  const allowSelect = !!onCreateSelection;
  const floatingNavStyle: React.CSSProperties = {
    position: isCanvasEmbed ? 'absolute' : isMobile ? 'fixed' : 'absolute',
    top: 'auto',
    bottom: isCanvasEmbed ? '10px' : isMobile ? 'calc(112px + env(safe-area-inset-bottom, 0px))' : '24px',
    left: '50%',
    transform: 'translateX(-50%)',
    backgroundColor: 'var(--background-primary)',
    border: '1px solid var(--background-modifier-border)',
    borderRadius: '20px',
    padding: '4px 12px',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
    flexWrap: 'nowrap',
    minWidth: 0,
    pointerEvents: 'none',
    touchAction: 'pan-y',
    zIndex: isCanvasEmbed ? 40 : 10010,
    opacity: !isMobile && navScrollHidden ? 0 : 1,
    visibility: !isMobile && navScrollHidden ? 'hidden' : 'visible',
    transition: 'opacity 0.2s ease, visibility 0.2s ease',
  };

  useEffect(() => {
    const rootEl = containerRef.current;
    if (!rootEl) return;
    const findDateLinkTarget = (event: MouseEvent): { labelEl: HTMLElement; dateKey: string } | null => {
      const target = event.target as HTMLElement | null;
      const labelEl = target?.closest?.(
        "[data-tps-calendar-day-link='true'], a.fc-col-header-cell-cushion, a.fc-daygrid-day-number, .fc-col-header-cell-cushion, .fc-daygrid-day-number",
      ) as HTMLElement | null;
      if (!labelEl || !rootEl.contains(labelEl)) return null;
      const carrier =
        labelEl.closest<HTMLElement>("[data-date]") ??
        (labelEl.matches("[data-date]") ? labelEl : null);
      const dateKey = labelEl.getAttribute("data-date") || carrier?.getAttribute("data-date") || "";
      if (!dateKey) return null;
      return { labelEl, dateKey };
    };
    const suppressDelegatedDateOpen = (event: MouseEvent) => {
      if (event.button !== 0) return;
      const target = findDateLinkTarget(event);
      if (!target) return;
      event.stopPropagation();
      event.stopImmediatePropagation();
    };
    const handleDelegatedDateClick = (event: MouseEvent) => {
      const currentOnDateClick = onDateClickRef.current;
      if (!currentOnDateClick) return;
      const target = findDateLinkTarget(event);
      if (!target) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      currentOnDateClick(parseDateKey(target.dateKey), target.labelEl, event);
    };
    rootEl.addEventListener("pointerdown", suppressDelegatedDateOpen, true);
    rootEl.addEventListener("mousedown", suppressDelegatedDateOpen, true);
    rootEl.addEventListener("click", handleDelegatedDateClick, true);
    return () => {
      rootEl.removeEventListener("pointerdown", suppressDelegatedDateOpen, true);
      rootEl.removeEventListener("mousedown", suppressDelegatedDateOpen, true);
      rootEl.removeEventListener("click", handleDelegatedDateClick, true);
    };
  }, []);

  useEffect(() => {
    if (!isMobile) return;
    setIsMobileNavHidden(false);
  }, [isMobile]);

  // --- View Configuration ---
  const safeWeekStartDay = Number.isFinite(weekStartDay)
    ? Math.max(0, Math.min(6, weekStartDay))
    : 1;
  const derivedFilterRangeDays = useMemo(() => {
    if (viewMode !== "filter-based") return null;
    if (!entryBoundsStart || !entryBoundsEnd) return null;
    const start = new Date(entryBoundsStart);
    const end = new Date(entryBoundsEnd);
    start.setHours(0, 0, 0, 0);
    end.setHours(0, 0, 0, 0);
    const inclusiveDays = getInclusiveCalendarDayCount(start, end);
    if (!Number.isFinite(inclusiveDays) || inclusiveDays < 1) return 1;
    return inclusiveDays;
  }, [viewMode, entryBoundsStart, entryBoundsEnd]);

  const resolvedFilterViewMode: ViewMode = useMemo(() => {
    if (viewMode !== "filter-based") return viewMode;
    const span = derivedFilterRangeDays;
    if (!span) return "week";
    if (span <= 1) return "day";
    if (span <= 3) return "3d";
    if (span <= 4) return "4d";
    if (span <= 5) return "5d";
    if (span <= 7) return "7d";
    return "month";
  }, [viewMode, derivedFilterRangeDays]);

  const configuredDayCount = getConfiguredTimeGridDayCount(resolvedFilterViewMode);
  const targetDayCount = useMemo(() => {
    if (resolvedFilterViewMode === "month" || resolvedFilterViewMode === "continuous" || preserveEmbeddedDayCount) {
      return configuredDayCount;
    }
    return getAdaptiveTimeGridDayCount(
      configuredDayCount,
      containerWidth,
      isEmbedMode || isCanvasEmbed,
      isCanvasEmbed,
    );
  }, [configuredDayCount, containerWidth, isCanvasEmbed, isEmbedMode, preserveEmbeddedDayCount, resolvedFilterViewMode]);
  const viewName =
    resolvedFilterViewMode === "month" ? "dayGridMonth" :
      resolvedFilterViewMode === "continuous" ? "timeGridDay" :
        resolvedFilterViewMode === "week" && targetDayCount === 7 ? "timeGridWeek" :
        resolvedFilterViewMode === "day" ? "timeGridRange-1" :
          `timeGridRange-${targetDayCount}`;

  const navStepValue = typeof navStep === "number" ? navStep : 0;
  // Only the 'week' view snaps by a full week; every other view defaults to 1 day.
  const isWeekView = resolvedFilterViewMode === "week";

  const resolvedNavDays =
    isWeekView
      ? targetDayCount
      : Number.isFinite(navStepValue) && navStepValue > 0
        ? Math.round(navStepValue)
        : 1;

  // Center the initial date in the view
  const initialDateRef = useRef<Date | null>(null);
  const lastViewModeRef = useRef<ViewMode | null>(null);
  const lastAppliedViewNameRef = useRef<string | null>(null);
  if (lastViewModeRef.current !== resolvedFilterViewMode) {
    lastViewModeRef.current = resolvedFilterViewMode;
    initialDateRef.current = null;
    lastAppliedViewNameRef.current = null;
  }

  if (!initialDateRef.current) {
    if (initialDate) {
      initialDateRef.current = initialDate;
    } else {
      const baseDate = currentDate ?? entries[0]?.startDate ?? new Date();
      if (resolvedFilterViewMode === "month") {
        initialDateRef.current = baseDate;
      } else {
        const offset = Math.floor((targetDayCount - 1) / 2);
        const centered = new Date(baseDate);
        centered.setHours(0, 0, 0, 0);
        centered.setDate(centered.getDate() - offset);
        initialDateRef.current = centered;
      }
    }
  }

  const safeInitialDate = initialDateRef.current!;

  const estimatedVisibleDateRange = useMemo((): { start: Date; end: Date } | null => {
    if (resolvedFilterViewMode === "continuous") return null;

    const start = new Date(safeInitialDate);
    start.setHours(0, 0, 0, 0);

    if (resolvedFilterViewMode === "month") {
      start.setDate(1);
      const end = new Date(start);
      end.setMonth(end.getMonth() + 1);
      start.setDate(start.getDate() - 7);
      end.setDate(end.getDate() + 7);
      return { start, end };
    }

    if (resolvedFilterViewMode === "week") {
      const day = start.getDay();
      const offset = (day - weekStartDay + 7) % 7;
      start.setDate(start.getDate() - offset);
      const end = new Date(start);
      end.setDate(end.getDate() + 7);
      return { start, end };
    }

    const end = new Date(start);
    end.setDate(end.getDate() + targetDayCount);
    return { start, end };
  }, [resolvedFilterViewMode, safeInitialDate, targetDayCount, weekStartDay]);

  const eventRenderDateRange = visibleDateRange ?? estimatedVisibleDateRange;
  const resolvedShowFullDay =
    typeof showFullDay === "boolean" ? showFullDay : localShowFullDay;
  const hasCustomSlotRange = !!slotRange && (
    slotRange.min !== DEFAULT_SLOT_MIN_TIME ||
    slotRange.max !== DEFAULT_SLOT_MAX_TIME
  );
  const shouldEnableScrollHoursToggle = showHiddenHoursToggle && hasCustomSlotRange;
  const slotMinTimeValue = hiddenTimeVisible
    ? DEFAULT_SLOT_MIN_TIME
    : slotRange?.min ?? DEFAULT_SLOT_MIN_TIME;
  const slotMaxTimeValue = hiddenTimeVisible
    ? DEFAULT_SLOT_MAX_TIME
    : slotRange?.max ?? DEFAULT_SLOT_MAX_TIME;
  // Embeds still render the full configured slot range; scrollTime controls
  // initial positioning without removing earlier hours from the grid.
  const embeddedSlotMinTimeValue = slotMinTimeValue;
  const fullCalendarScrollTimeValue = isEmbedMode
    ? slotMinTimeValue
    : `${defaultScrollTimeSetting}:00`;

  const getScrollTargetByKind = useCallback((kind: ScrollSnapshotKind): HTMLElement | null => {
    const root = containerRef.current;
    if (!root) return null;

    if (kind === "timegrid") {
      const nowLineScroller = root
        .querySelector<HTMLElement>(".fc-timegrid-now-indicator-line")
        ?.closest<HTMLElement>(".fc-scroller");
      if (nowLineScroller) return nowLineScroller;

      const bodyScroller = root
        .querySelector<HTMLElement>(".fc-timegrid-body")
        ?.closest<HTMLElement>(".fc-scroller");
      if (bodyScroller) return bodyScroller;

      const colsScroller = root
        .querySelector<HTMLElement>(".fc-timegrid-cols")
        ?.closest<HTMLElement>(".fc-scroller");
      if (colsScroller) return colsScroller;

      const slotsScroller = root
        .querySelector<HTMLElement>(".fc-timegrid-slots")
        ?.closest<HTMLElement>(".fc-scroller");
      if (slotsScroller) return slotsScroller;

      const scrollers = Array.from(root.querySelectorAll<HTMLElement>(".fc-scroller"));
      if (!scrollers.length) return null;

      const overflow = scrollers
        .filter((el) => el.scrollHeight > el.clientHeight + 1)
        .sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight));

      return overflow[0] || scrollers[0] || null;
    }
    if (kind === "continuous") {
      return root.querySelector<HTMLElement>(".bases-calendar-continuous-scroll-container");
    }
    return root.querySelector<HTMLElement>(".bases-calendar-scroll-surface");
  }, []);

  const scrollToTimelineEdge = useCallback((edge: "top" | "bottom") => {
    const apply = () => {
      const primaryKind: ScrollSnapshotKind = resolvedFilterViewMode === "continuous" ? "continuous" : "timegrid";
      const target = getScrollTargetByKind(primaryKind) || getScrollTargetByKind("surface");
      if (!target) return;

      if (edge === "top") {
        target.scrollTop = 0;
      } else {
        target.scrollTop = Math.max(0, target.scrollHeight - target.clientHeight);
      }
    };

    [0, 40, 120, 260].forEach((delayMs) => {
      window.setTimeout(() => {
        requestAnimationFrame(apply);
      }, delayMs);
    });
  }, [getScrollTargetByKind, resolvedFilterViewMode]);

  // --- Hidden time indicator ---
  const hiddenTimeIndicatorEdges = useMemo(() => {
    const empty = new Map<string, { before: boolean; after: boolean }>();
    if (!hasCustomSlotRange || hiddenTimeVisible || !slotRange) {
      return empty;
    }

    const minMinutes = timeToMinutes(embeddedSlotMinTimeValue);
    const maxMinutes = timeToMinutes(slotMaxTimeValue);
    const edges = new Map<string, { before: boolean; after: boolean }>();
    const markEdge = (date: Date, edge: "before" | "after") => {
      const dateKey = formatDateKey(date);
      const current = edges.get(dateKey) ?? { before: false, after: false };
      current[edge] = true;
      edges.set(dateKey, current);
    };

    entries.forEach((calEntry) => {
      if (calEntry.isAuxiliaryDate || calEntry.isArchivedExternalPlaceholder) return;
      const allDayValue = allDayProperty
        ? tryGetValue(calEntry.entry, allDayProperty)
        : null;
      const normalizedAllDay = normalizeValue(allDayValue).trim().toLowerCase();
      const isAllDay = calEntry.forceAllDay === true
        || !!calEntry.externalEvent?.isAllDay
        || ["true", "yes", "y", "1"].includes(normalizedAllDay);
      if (isAllDay) return;

      const start = calEntry.startDate;
      const end = calEntry.endDate
        ? calEntry.endDate
        : new Date(start.getTime() + defaultEventDuration * 60 * 1000);

      const startMinutes = start.getHours() * 60 + start.getMinutes();
      const endMinutes = end.getHours() * 60 + end.getMinutes();
      const spansDays = formatDateKey(start) !== formatDateKey(end);
      if (spansDays) {
        markEdge(start, "after");
        markEdge(end, "before");
        return;
      }

      if (startMinutes < minMinutes || endMinutes <= minMinutes) markEdge(start, "before");
      if (startMinutes >= maxMinutes || endMinutes > maxMinutes) markEdge(start, "after");
    });

    return edges;
  }, [entries, slotRange, hiddenTimeVisible, hasCustomSlotRange, allDayProperty, defaultEventDuration, embeddedSlotMinTimeValue, slotMaxTimeValue]);

  const hiddenTimeIndicatorDates = useMemo(() => new Set(hiddenTimeIndicatorEdges.keys()), [hiddenTimeIndicatorEdges]);

  const hasHiddenTimeEventsInVisibleRange = useMemo(() => {
    if (hiddenTimeVisible || !visibleDateRange || hiddenTimeIndicatorDates.size === 0) {
      return false;
    }

    const startKey = formatDateKey(visibleDateRange.start);
    const endKey = formatDateKey(visibleDateRange.end);
    for (const dateKey of hiddenTimeIndicatorDates) {
      if (dateKey >= startKey && dateKey < endKey) {
        return true;
      }
    }
    return false;
  }, [hiddenTimeVisible, visibleDateRange, hiddenTimeIndicatorDates]);

  // --- Directional navigation availability ---
  // Explicit date filters bound navigation within the selected range.
  const { canNavigatePrev, canNavigateNext, canNavigateToday } = useMemo(() => {
    if (!navigationBoundsStart && !navigationBoundsEnd) {
      return { canNavigatePrev: true, canNavigateNext: true, canNavigateToday: true };
    }

    if (!visibleDateRange) {
      return { canNavigatePrev: true, canNavigateNext: true, canNavigateToday: true };
    }

    const boundsStart = navigationBoundsStart ? new Date(navigationBoundsStart) : null;
    boundsStart?.setHours(0, 0, 0, 0);
    const boundsEnd = navigationBoundsEnd ? new Date(navigationBoundsEnd) : null;
    boundsEnd?.setHours(23, 59, 59, 999);

    const viewStart = visibleDateRange.start;
    const viewEnd = visibleDateRange.end;

    const canPrev = boundsStart ? boundsStart < viewStart : true;
    const canNext = boundsEnd ? boundsEnd >= viewEnd : true;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const canToday =
      (!boundsStart || today >= boundsStart) &&
      (!boundsEnd || today <= boundsEnd);

    return { canNavigatePrev: canPrev, canNavigateNext: canNext, canNavigateToday: canToday };
  }, [navigationBoundsStart, navigationBoundsEnd, visibleDateRange]);

  const validRange = useMemo(() => {
    if (!navigationBoundsStart && !navigationBoundsEnd) return undefined;
    const range: { start?: Date; end?: Date } = {};
    if (navigationBoundsStart) {
      const start = new Date(navigationBoundsStart);
      start.setHours(0, 0, 0, 0);
      range.start = start;
    }
    if (navigationBoundsEnd) {
      const end = new Date(navigationBoundsEnd);
      end.setHours(0, 0, 0, 0);
      end.setDate(end.getDate() + 1);
      range.end = end;
    }
    return range;
  }, [navigationBoundsStart, navigationBoundsEnd]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const dateEls = container.querySelectorAll<HTMLElement>(
      ".fc-timegrid-col[data-date], .fc-col-header-cell[data-date]"
    );
    dateEls.forEach((el) => {
      const date = el.getAttribute("data-date");
      const hiddenEdges = date ? hiddenTimeIndicatorEdges.get(date) : null;
      if (date && hiddenEdges) {
        el.classList.add("has-hidden-time-event");
        el.classList.toggle("has-hidden-time-event-before", hiddenEdges.before);
        el.classList.toggle("has-hidden-time-event-after", hiddenEdges.after);
      } else {
        el.classList.remove("has-hidden-time-event");
        el.classList.remove("has-hidden-time-event-before");
        el.classList.remove("has-hidden-time-event-after");
      }
    });
  }, [hiddenTimeIndicatorEdges, resolvedFilterViewMode]);

  // --- Embed mode detection ---
  useLayoutEffect(() => {
    if (!containerRef.current) return;
    const leafContent = containerRef.current.closest('.workspace-leaf-content');
    const viewType = leafContent?.getAttribute('data-type');
    const isInCanvas = viewType === 'canvas' || !!containerRef.current.closest('.canvas-node-content, .canvas-node');
    setIsCanvasEmbed(isInCanvas);

    if (typeof isEmbedded === "boolean") {
      setIsEmbedMode(isEmbedded);
      return;
    }
    const embedSelectors = ".tps-auto-base-embed__panel, .tps-auto-base-embed__content, .markdown-embed, .internal-embed, .cm-embed-block, .canvas-node-content";
    const isInEmbed = !!containerRef.current.closest(embedSelectors);
    const previewView = containerRef.current.closest('.markdown-preview-view, .markdown-reading-view, .markdown-rendered');
    const isInReadingModeEmbed = previewView && !!containerRef.current.closest('.internal-embed, .markdown-embed');
    const isCalendarLeaf = viewType === 'calendar' || viewType === 'base' || viewType === 'bases';
    const isBasesInMarkdown = viewType === 'markdown' && !!containerRef.current.closest('.internal-embed, .markdown-embed');
    setIsEmbedMode(!isCalendarLeaf && (isInEmbed || isInReadingModeEmbed || isBasesInMarkdown || isInCanvas));
  }, []);

  // --- Zoom / Condense ---
  const effectiveCondenseLevel = condenseLevel ?? DEFAULT_CONDENSE_LEVEL;
  const zoom = calculateSlotZoom(effectiveCondenseLevel);
  const effectiveZoom = isEmbedMode ? Math.min(zoom, isMobile ? 0.75 : 0.82) : zoom;
  const baseSlotHeight = calculateSlotHeightFromZoom(effectiveZoom);
  const computedSlotHeight = baseSlotHeight;

  const applyCalendarSlotHeight = useCallback((root: HTMLElement | null, slotHeight: number) => {
    if (!root) return;
    root.querySelectorAll<HTMLElement>(".fc-timegrid-slot, .fc-timegrid-slot-label").forEach((slot) => {
      slot.style.setProperty("height", `${slotHeight}px`, "important");
      slot.style.setProperty("min-height", `${slotHeight}px`, "important");
    });
  }, []);
  const useCanvasEmbedSizing = isEmbedMode && isCanvasEmbed;
  const resolvedViewHeight = !useCanvasEmbedSizing && typeof embeddedHeight === "number" && Number.isFinite(embeddedHeight)
    ? Math.max(isMobile ? 260 : 300, embeddedHeight)
    : undefined;
  const resolvedEmbedHeight = isEmbedMode ? resolvedViewHeight : undefined;
  const embedFallbackHeight = resolvedEmbedHeight ?? (useCanvasEmbedSizing ? Math.max(240, calendarBodyHeight || 0) : (isMobile ? 340 : 520));
  // Use calendarBodyHeight (the flex child below the nav bar) so FullCalendar is
  // sized to exactly the available space, preventing bottom-overflow in canvas nodes.
  const computedEmbedCalendarHeight = useCanvasEmbedSizing
    ? Math.max(180, calendarBodyHeight || 0)
    : resolvedEmbedHeight
      ?? (calendarBodyHeight > 0
      ? Math.max(isMobile ? 260 : 300, calendarBodyHeight)
      : embedFallbackHeight);
  const viewportHeight = typeof window !== "undefined" ? window.innerHeight : 800;
  const dedicatedFallbackHeight = Math.max(isMobile ? 360 : 480, viewportHeight - (isMobile ? 160 : 190));
  const dedicatedCalendarHeight = (calendarBodyHeight > 0
    ? Math.max(isMobile ? 360 : 420, calendarBodyHeight)
    : dedicatedFallbackHeight);

  const fullCalendarHeight: number | "auto" | "100%" = isEmbedMode
    ? computedEmbedCalendarHeight
    : isMobile
      ? "auto"
      : dedicatedCalendarHeight;
  const fullCalendarContentHeight: number | "auto" | "100%" = isEmbedMode
    ? computedEmbedCalendarHeight
    : isMobile
      ? "auto"
      : dedicatedCalendarHeight;

  const scrollSurfaceHeight: number | "auto" | "100%" = isEmbedMode
    ? "100%"
    : isMobile
      ? "auto"
      : "100%";

  const scrollSurfaceOverflowY = isEmbedMode
    ? "hidden"
    : isMobile
      ? "visible"
      : "auto";
  const resolvedAllDayMaxRows = isEmbedMode
    ? 1
    : (allDayExpanded ? 99 : (allDayMaxRows ?? 3));
  const fullCalendarAllDayMaxRows: false | number = allDayExpanded
    ? false
    : resolvedAllDayMaxRows;

  useEffect(() => {
    const api = calendarRef.current?.getApi();
    if (containerRef.current) {
      containerRef.current.style.setProperty('--calendar-slot-height', `${computedSlotHeight}px`);
      applyCalendarSlotHeight(containerRef.current, computedSlotHeight);
    }
    if (api) {
      api.updateSize();
    }
  }, [effectiveCondenseLevel, resolvedShowFullDay, resolvedFilterViewMode, computedSlotHeight, applyCalendarSlotHeight]);

  useEffect(() => {
    if (!isEmbedMode || !calendarRef.current) return;

    const syncEmbeddedCalendar = () => {
      const api = calendarRef.current?.getApi();
      if (!api) return;
      api.updateSize();
    };

    // Embedded bases can stay hidden/offscreen while rendering; force late size sync after reveal.
    // Include an immediate RAF call + staggered delays to handle canvas layout settling.
    let rafId = requestAnimationFrame(() => {
      syncEmbeddedCalendar();
    });

    const timeouts = [100, 250, 600, 1200, 2000].map((delay) =>
      window.setTimeout(() => {
        syncEmbeddedCalendar();
      }, delay),
    );

    return () => {
      cancelAnimationFrame(rafId);
      timeouts.forEach((id) => window.clearTimeout(id));
    };
  }, [isEmbedMode, fullCalendarHeight, resolvedFilterViewMode]);

  // Canvas resize fix: FullCalendar only listens to the window 'resize' event.
  // Canvas node resizes don't trigger window resize, so FC never calls
  // computeScrollerDims() and tables keep stale pixel widths, causing
  // header/body misalignment. A ResizeObserver on the container detects
  // width changes and calls updateSize() so FC remeasures and recalibrates.
  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;
    const readWidth = () => {
      const layoutWidth = container.clientWidth || container.getBoundingClientRect().width;
      if (!isCanvasEmbed) return layoutWidth;

      const canvasNode = container.closest<HTMLElement>(".canvas-node");
      const canvasNodeStyleWidth = canvasNode
        ? Number.parseFloat(canvasNode.style.width || "")
        : Number.NaN;
      const visualWidth = _origBCR.call(container).width;
      const candidates = [layoutWidth, visualWidth, canvasNodeStyleWidth]
        .filter((width) => Number.isFinite(width) && width > 0);
      return candidates.length ? Math.min(...candidates) : layoutWidth;
    };
    let lastWidth = readWidth();
    if (lastWidth > 0) {
      setContainerWidth((previousWidth) =>
        Math.abs(previousWidth - lastWidth) >= 1 ? lastWidth : previousWidth,
      );
    }
    let debounceId: ReturnType<typeof setTimeout> | null = null;

    const ro = new ResizeObserver(() => {
      const newWidth = readWidth();
      if (Math.abs(newWidth - lastWidth) < 1) return;
      lastWidth = newWidth;
      setContainerWidth((previousWidth) =>
        Math.abs(previousWidth - newWidth) >= 1 ? newWidth : previousWidth,
      );
      if (debounceId !== null) clearTimeout(debounceId);
      debounceId = setTimeout(() => {
        debounceId = null;
        const api = calendarRef.current?.getApi();
        if (api) api.updateSize();
      }, 50);
    });

    ro.observe(container);
    return () => {
      ro.disconnect();
      if (debounceId !== null) clearTimeout(debounceId);
    };
  }, [isCanvasEmbed]);

  // Pinch-to-zoom hook
  const { currentSlotHeightRef } = useCalendarZoom({
    containerRef: containerRef as React.RefObject<HTMLDivElement>,
    computedSlotHeight,
    onCondenseLevelChange,
  });

  const handleSlotMount = useCallback((arg: { el: HTMLElement }) => {
    arg.el.style.setProperty("height", `${computedSlotHeight}px`, "important");
    arg.el.style.setProperty("min-height", `${computedSlotHeight}px`, "important");
  }, [computedSlotHeight]);

  // Time-following hook
  const { isFollowingNow, setIsFollowingNow, scrollToNow } = useTimeFollowing({
    calendarRef: calendarRef as React.RefObject<FullCalendar>,
    containerRef: containerRef as React.RefObject<HTMLDivElement>,
    computedSlotHeight,
    initialFollowingNow: !isEmbedMode,
  });

  const renderableEntries = useMemo(
    () => entries.filter((entry) => !entry.isAuxiliaryDate && !entry.isArchivedExternalPlaceholder),
    [entries],
  );

  // Events hook
  const { basesEntryMap, events } = useCalendarEvents({
    entries: renderableEntries,
    allDayProperty,
    defaultEventDuration,
    minEventHeight,
    noteEventsEditable: editable,
    visibleDateRange: eventRenderDateRange,
    doneStatuses,
  });

  // Canvas BCR patch: register this container so the module-level patch
  // unscales getBoundingClientRect() for every FC measurement (PositionCache
  // builds, scroll dims, now-indicator, events) while this embed is mounted.
  useEffect(() => {
    if (!isEmbedMode || !containerRef.current) return;
    const container = containerRef.current;
    _canvasEmbedContainers.add(container);
    _installCanvasBCRPatch();
    return () => {
      _canvasEmbedContainers.delete(container);
      _scaleCache.delete(container);
      _uninstallCanvasBCRPatch();
    };
  }, [isEmbedMode]);

  // Data-refresh size sync: when events change (Obsidian file watcher fires ~every minute),
  // React re-renders FC with new props, triggering componentDidUpdate → handleSizing() →
  // computeScrollerDims(). If the DOM is in a transient state at that exact moment the
  // harness width measurement can be stale and the wrong pixel widths get cached.
  // Schedule a corrective updateSize() after the DOM has settled so FC remeasures correctly.
  useEffect(() => {
    if (!isEmbedMode) return;
    const id = window.setTimeout(() => {
      const api = calendarRef.current?.getApi();
      if (api) api.updateSize();
    }, 100);
    return () => window.clearTimeout(id);
  }, [isEmbedMode, events]);

  // Event renderer hook
  const sanitizedProperties = properties ?? [];
  const { renderEventContent } = useEventRenderer({
    app,
    sanitizedProperties,
    basesEntryMap,
  });

  const dayMarkerSources = useMemo(() => {
    const markersByDay = new Map<string, { auxiliary: number; archived: number; titleParts: string[] }>();
    for (const entry of entries) {
      const isAuxiliary = !!entry.isAuxiliaryDate;
      const isArchived = !!entry.isArchivedExternalPlaceholder;
      if (!isAuxiliary && !isArchived) continue;

      const date = entry.startDate instanceof Date ? entry.startDate : new Date(entry.startDate);
      if (!Number.isFinite(date.getTime())) continue;

      const key = formatDateKey(date);
      const marker = markersByDay.get(key) || {
        auxiliary: 0,
        archived: 0,
        titleParts: [],
      };
      if (isAuxiliary) marker.auxiliary += Math.max(1, Number(entry.auxiliaryDateCount || 1));
      if (isArchived) marker.archived += Math.max(1, Number(entry.archivedExternalCount || 1));
      const tooltip = String(
        isArchived
          ? entry.archivedExternalTooltip || entry.title || "Hidden external event"
          : entry.auxiliaryDateTooltip || entry.title || "Additional date",
      ).trim();
      if (tooltip) marker.titleParts.push(tooltip);
      markersByDay.set(key, marker);
    }
    if (markersByDay.size > 0) {
      logger.log("[CalendarReactView] Day markers prepared", {
        days: Array.from(markersByDay.entries()).map(([dateKey, marker]) => ({
          dateKey,
          auxiliary: marker.auxiliary,
          archived: marker.archived,
        })),
      });
    }
    return markersByDay;
  }, [entries]);

  useLayoutEffect(() => {
    const root = containerRef.current;
    if (!root) {
      setDayMarkerOverlays([]);
      return;
    }

    const measureMarkers = () => {
      if (dayMarkerSources.size === 0) {
        setDayMarkerOverlays([]);
        return;
      }

      const rootRect = root.getBoundingClientRect();
      const next: CalendarDayMarkerOverlay[] = [];
      for (const [dateKey, marker] of dayMarkerSources) {
        const column =
          root.querySelector<HTMLElement>(`.fc-col-header-cell[data-date="${dateKey}"]`) ||
          root.querySelector<HTMLElement>(`.fc-timegrid-col[data-date="${dateKey}"]`) ||
          root.querySelector<HTMLElement>(`.fc-daygrid-day[data-date="${dateKey}"]`);
        if (!column) continue;

        const columnRect = column.getBoundingClientRect();
        if (columnRect.width <= 0 || columnRect.height <= 0) continue;
        next.push({
          dateKey,
          auxiliary: marker.auxiliary,
          archived: marker.archived,
          title: marker.titleParts.join("\n"),
          left: Math.max(0, columnRect.right - rootRect.left - 8),
          top: Math.max(0, columnRect.bottom - rootRect.top - 24),
        });
      }

      if (dayMarkerSources.size > 0) {
        logger.log("[CalendarReactView] Day marker overlays measured", {
          requested: dayMarkerSources.size,
          rendered: next.length,
          dates: next.map((marker) => marker.dateKey),
        });
      }

      setDayMarkerOverlays((previous) => {
        const signature = JSON.stringify(next);
        const previousSignature = JSON.stringify(previous);
        return signature === previousSignature ? previous : next;
      });
    };

    const scheduleMeasure = () => window.requestAnimationFrame(measureMarkers);
    const frame = scheduleMeasure();
    const timeouts = [80, 250, 600, 1200].map((delay) => window.setTimeout(measureMarkers, delay));
    const resizeObserver = new ResizeObserver(() => {
      scheduleMeasure();
    });
    resizeObserver.observe(root);
    if (calendarBodyRef.current) resizeObserver.observe(calendarBodyRef.current);
    const mutationObserver = new MutationObserver(() => {
      scheduleMeasure();
    });
    mutationObserver.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style", "data-date"] });
    root.addEventListener("scroll", measureMarkers, true);
    window.addEventListener("resize", measureMarkers);

    return () => {
      window.cancelAnimationFrame(frame);
      timeouts.forEach((timeout) => window.clearTimeout(timeout));
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      root.removeEventListener("scroll", measureMarkers, true);
      window.removeEventListener("resize", measureMarkers);
    };
  }, [dayMarkerSources, resolvedFilterViewMode, targetDayCount, visibleDateRange]);

  // --- Sync effects ---
  useEffect(() => {
    if (typeof showFullDay === "boolean") {
      setLocalShowFullDay(showFullDay);
    }
  }, [showFullDay]);

  useEffect(() => {
    if (!slotRange) {
      setHiddenTimeVisible(false);
    }
  }, [slotRange]);

  useEffect(() => {
    if (!shouldEnableScrollHoursToggle) {
      setHoursToggleVisible(false);
      return;
    }

    const container = containerRef.current;
    if (!container) return;

    const handleScroll = (event: Event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (target.scrollHeight <= target.clientHeight + 1) return;

      const isTimegridScroller = target.classList.contains("fc-scroller") && !!target.closest(".fc-timegrid");
      const isContinuousScroller = target.classList.contains("bases-calendar-continuous-scroll-container");
      if (!isTimegridScroller && !isContinuousScroller) return;

      const nextTop = target.scrollTop;
      if (lastObservedScrollTargetRef.current !== target) {
        lastObservedScrollTargetRef.current = target;
        lastObservedScrollTopRef.current = nextTop;
        return;
      }
      const prevTop = lastObservedScrollTopRef.current;
      const delta = nextTop - prevTop;
      if (Math.abs(delta) < 2) return;

      const maxScrollTop = Math.max(0, target.scrollHeight - target.clientHeight);
      const distanceToTop = Math.max(0, nextTop);
      const distanceToBottom = Math.max(0, maxScrollTop - nextTop);
      const isNearTop = distanceToTop <= HOURS_TOGGLE_EDGE_THRESHOLD_PX;
      const isNearBottom = distanceToBottom <= HOURS_TOGGLE_EDGE_THRESHOLD_PX;

      lastObservedScrollTopRef.current = nextTop;
      if (hiddenTimeVisible) {
        if (hoursToggleVisible) {
          setHoursToggleVisible(false);
        }
        return;
      }

      if (!(isNearTop || isNearBottom)) {
        if (hoursToggleVisible) {
          const oppositeDirectionForTop = hoursToggleEdge === "top" && delta > 0;
          const oppositeDirectionForBottom = hoursToggleEdge === "bottom" && delta < 0;
          if (oppositeDirectionForTop || oppositeDirectionForBottom) {
            setHoursToggleVisible(false);
          }
        }
        return;
      }

      if (isNearTop && !isNearBottom) {
        setHoursToggleEdge("top");
      } else if (isNearBottom && !isNearTop) {
        setHoursToggleEdge("bottom");
      } else {
        setHoursToggleEdge(delta > 0 ? "bottom" : "top");
      }
      setHoursToggleVisible(true);
    };

    container.addEventListener("scroll", handleScroll, true);
    return () => {
      container.removeEventListener("scroll", handleScroll, true);
    };
  }, [
    shouldEnableScrollHoursToggle,
    hiddenTimeVisible,
    hoursToggleEdge,
    hoursToggleVisible,
  ]);

  useEffect(() => {
    if (isEmbedMode) return;
    const container = containerRef.current;
    if (!container) return;

    let inactivityTimeoutId: number | null = null;

    const engageFollowNow = () => {
      if (!isTodayVisible) return;

      const shouldRestoreNowState = hiddenTimeVisible || !isFollowingNow;
      if (!shouldRestoreNowState) return;

      setHiddenTimeVisible(false);
      setHoursToggleVisible(false);
      setIsFollowingNow(true);
      if (hiddenTimeVisible) {
        window.setTimeout(() => scrollToNow(), 80);
        return;
      }
      scrollToNow();
    };

    const armInactivityTimeout = () => {
      if (inactivityTimeoutId !== null) {
        window.clearTimeout(inactivityTimeoutId);
      }
      inactivityTimeoutId = window.setTimeout(engageFollowNow, IDLE_RETURN_TO_NOW_MS);
    };

    const handleActivity = (event: Event) => {
      const target = event.target;
      if (target instanceof Node && !container.contains(target)) return;
      armInactivityTimeout();
    };

    const capture = true;
    const passiveCapture: AddEventListenerOptions = { capture: true, passive: true };
    container.addEventListener("scroll", handleActivity, capture);
    container.addEventListener("wheel", handleActivity, passiveCapture);
    container.addEventListener("touchstart", handleActivity, passiveCapture);
    container.addEventListener("pointerdown", handleActivity, capture);
    container.addEventListener("click", handleActivity, capture);
    container.addEventListener("contextmenu", handleActivity, capture);
    container.addEventListener("keydown", handleActivity, capture);

    armInactivityTimeout();

    return () => {
      if (inactivityTimeoutId !== null) {
        window.clearTimeout(inactivityTimeoutId);
      }
      container.removeEventListener("scroll", handleActivity, capture);
      container.removeEventListener("wheel", handleActivity, passiveCapture);
      container.removeEventListener("touchstart", handleActivity, passiveCapture);
      container.removeEventListener("pointerdown", handleActivity, capture);
      container.removeEventListener("click", handleActivity, capture);
      container.removeEventListener("contextmenu", handleActivity, capture);
      container.removeEventListener("keydown", handleActivity, capture);
    };
  }, [
    isEmbedMode,
    hiddenTimeVisible,
    isFollowingNow,
    isTodayVisible,
    scrollToNow,
    setIsFollowingNow,
  ]);

  // Container resize handling
  useEffect(() => {
    if (!containerRef.current || !calendarRef.current) return;

    const containerEl = containerRef.current;
    const lastSizeRef = { width: 0, height: 0 };
    let resizeTimeout: NodeJS.Timeout | null = null;
    let rafId: number | null = null;

    const timeouts = [50, 200, 500].map(delay =>
      setTimeout(() => {
        if (calendarRef.current) {
          calendarRef.current.getApi().updateSize();
        }
      }, delay)
    );

    const handleResize = () => {
      if (!containerEl) return;
      const rect = containerEl.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      setContainerHeight((prev) => {
        const next = Math.round(rect.height);
        return Math.abs(prev - next) > 1 ? next : prev;
      });
      const widthDiff = Math.abs(rect.width - lastSizeRef.width);
      const heightDiff = Math.abs(rect.height - lastSizeRef.height);
      if (widthDiff < 1 && heightDiff < 1) return;
      lastSizeRef.width = rect.width;
      lastSizeRef.height = rect.height;

      if (resizeTimeout) {
        clearTimeout(resizeTimeout);
      }

      const runUpdate = (delay: number) => {
        resizeTimeout = setTimeout(() => {
          if (calendarRef.current) {
            const api = calendarRef.current.getApi();
            if (isEmbedMode) {
              if (rafId) cancelAnimationFrame(rafId);
              rafId = requestAnimationFrame(() => {
                api.updateSize();
              });
              return;
            }
            api.updateSize();
          }
        }, delay);
      };

      if (isEmbedMode) {
        // In canvas embeds, FullCalendar sets inline pixel widths that go stale.
        // Fire updateSize immediately via RAF, then again after a delay for layout settling.
        if (rafId) cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(() => {
          if (calendarRef.current) {
            calendarRef.current.getApi().updateSize();
          }
        });
        runUpdate(200);
        return;
      }

      requestAnimationFrame(() => {
        if (calendarRef.current) {
          calendarRef.current.getApi().updateSize();
        }
      });

      runUpdate(150);
    };

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(containerEl);

    if (!isEmbedMode) {
      let parent = containerEl.parentElement;
      let depth = 0;
      while (parent && depth < 5) {
        resizeObserver.observe(parent);
        parent = parent.parentElement;
        depth++;
      }
    } else {
      // In embed mode (especially canvas), observe ancestor containers
      // so we catch canvas node resize / scroll changes
      const canvasNode = containerEl.closest('.canvas-node-content') || containerEl.closest('.canvas-node');
      if (canvasNode) {
        resizeObserver.observe(canvasNode);
        if (canvasNode.parentElement) resizeObserver.observe(canvasNode.parentElement);
      }
      // Also observe a few parent levels for general embeds
      let parent = containerEl.parentElement;
      let depth = 0;
      while (parent && depth < 3) {
        resizeObserver.observe(parent);
        parent = parent.parentElement;
        depth++;
      }
    }

    return () => {
      resizeObserver.disconnect();
      timeouts.forEach(clearTimeout);
      if (resizeTimeout) {
        clearTimeout(resizeTimeout);
      }
      if (rafId) {
        cancelAnimationFrame(rafId);
      }
    };
  }, [isEmbedMode]);

  // Measure the calendar body flex child (below nav chrome) separately so that
  // fullCalendarHeight excludes the toolbar and matches the exact available space.
  useEffect(() => {
    const el = calendarBodyRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const h = Math.round(entry.contentRect.height);
      setCalendarBodyHeight(prev => h > 0 && Math.abs(prev - h) > 1 ? h : prev);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Window resize fallback
  useEffect(() => {
    if (isEmbedMode) return;
    const handleResize = () => {
      if (calendarRef.current) {
        calendarRef.current.getApi().updateSize();
      }
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [isEmbedMode]);

  // Sync current date from outside
  useEffect(() => {
    if (currentDate && calendarRef.current) {
      const api = calendarRef.current.getApi();
      if (resolvedFilterViewMode !== "month" && resolvedFilterViewMode !== "week") {
        const offset = Math.floor((targetDayCount - 1) / 2);
        const centered = new Date(currentDate);
        centered.setHours(0, 0, 0, 0);
        centered.setDate(centered.getDate() - offset);
        if (!isSameCalendarDay(api.getDate(), centered)) {
          api.gotoDate(centered);
        }
      } else {
        if (!isSameCalendarDay(api.getDate(), currentDate)) {
          api.gotoDate(currentDate);
        }
      }
    }
  }, [currentDate, resolvedFilterViewMode, targetDayCount, isSameCalendarDay]);

  useEffect(() => {
    if (!jumpTargetDate || !calendarRef.current) return;
    const api = calendarRef.current.getApi();
    const target = new Date(jumpTargetDate);
    if (resolvedFilterViewMode !== "month" && resolvedFilterViewMode !== "week") {
      const offset = Math.floor((targetDayCount - 1) / 2);
      const centered = new Date(target);
      centered.setHours(0, 0, 0, 0);
      centered.setDate(centered.getDate() - offset);
      api.gotoDate(centered);
    } else {
      api.gotoDate(target);
    }

    if (onDateChange) onDateChange(target);
    onJumpTargetApplied?.();

    const seconds = target.getHours() * 3600 + target.getMinutes() * 60 + target.getSeconds();
    if (seconds > 0) {
      const hh = String(target.getHours()).padStart(2, "0");
      const mm = String(target.getMinutes()).padStart(2, "0");
      const ss = String(target.getSeconds()).padStart(2, "0");
      [80, 180, 360].forEach((delayMs) => {
        window.setTimeout(() => {
          api.scrollToTime(`${hh}:${mm}:${ss}`);
        }, delayMs);
      });
    }
  }, [jumpTargetDate, resolvedFilterViewMode, targetDayCount, onDateChange, onJumpTargetApplied]);

  // FullCalendar treats `initialView` as one-time setup. When filter-based logic
  // derives a different concrete mode after mount, force the calendar API to
  // switch so the rendered columns match the computed mode.
  useEffect(() => {
    const api = calendarRef.current?.getApi();
    if (!api) return;
    if (lastAppliedViewNameRef.current === viewName) return;

    let targetDate = currentDate ? new Date(currentDate) : api.getDate();
    if (resolvedFilterViewMode !== "month" && resolvedFilterViewMode !== "week" && resolvedFilterViewMode !== "continuous") {
      const offset = Math.floor((targetDayCount - 1) / 2);
      targetDate = new Date(targetDate);
      targetDate.setHours(0, 0, 0, 0);
      targetDate.setDate(targetDate.getDate() - offset);
    }

    logger.log(
      `[CalendarReactView] Syncing FullCalendar view desired=${viewName} actual=${api.view.type} target=${targetDate.toDateString()}`,
    );
    api.changeView(viewName, targetDate);
    lastAppliedViewNameRef.current = viewName;
  }, [viewName, currentDate, resolvedFilterViewMode, targetDayCount]);

  // --- Event handlers ---
  const showAuxiliaryDateMenu = useCallback((sourceEntry: CalendarEntry, mouseEvent: MouseEvent) => {
    const representedEntries = sourceEntry.auxiliaryDateEntries?.length
      ? sourceEntry.auxiliaryDateEntries
      : [sourceEntry];
    const menu = new Menu();
    const grouped = new Map<string, CalendarEntry[]>();
    const seenByGroup = new Set<string>();

    for (const representedEntry of representedEntries) {
      const file = representedEntry.entry?.file;
      if (!file?.path) continue;
      const field = String(representedEntry.auxiliaryDateField || "Secondary date").trim();
      const groupKey = field || "Secondary date";
      const dedupeKey = `${groupKey}::${file.path}`;
      if (seenByGroup.has(dedupeKey)) continue;
      seenByGroup.add(dedupeKey);
      const group = grouped.get(groupKey) || [];
      group.push(representedEntry);
      grouped.set(groupKey, group);
    }

    const sortedGroups = Array.from(grouped.entries()).sort(([a], [b]) => a.localeCompare(b));
    sortedGroups.forEach(([field, fieldEntries], groupIndex) => {
      if (fieldEntries.length === 0) return;
      menu.addItem((item) => {
        item
          .setTitle(field)
          .setIcon("list")
          .setDisabled(true);
      });

      const sortedEntries = [...fieldEntries].sort((a, b) => {
        const aTitle = a.title || a.entry?.file?.basename || "";
        const bTitle = b.title || b.entry?.file?.basename || "";
        return aTitle.localeCompare(bTitle);
      });

      for (const representedEntry of sortedEntries) {
        const file = representedEntry.entry?.file;
        if (!file?.path) continue;
        const title = representedEntry.title || file.basename;
        menu.addItem((item) => {
          item
            .setTitle(`  ${title}`)
            .setIcon("file-text")
            .onClick(() => {
              void onEntryClick(representedEntry, false);
            });
        });
      }
      if (groupIndex < sortedGroups.length - 1) {
        menu.addSeparator();
      }
    });
    if (seenByGroup.size === 0) return;
    menu.showAtMouseEvent(mouseEvent);
  }, [onEntryClick]);

  const showArchivedExternalMenu = useCallback((sourceEntry: CalendarEntry, mouseEvent: MouseEvent) => {
    const representedEntries = sourceEntry.archivedExternalEntries?.length
      ? sourceEntry.archivedExternalEntries
      : [sourceEntry];
    const menu = new Menu();
    const seen = new Set<string>();
    const sortedEntries = [...representedEntries].sort((a, b) => {
      const timeDiff = a.startDate.getTime() - b.startDate.getTime();
      if (timeDiff !== 0) return timeDiff;
      return String(a.title || "").localeCompare(String(b.title || ""));
    });

    for (const representedEntry of sortedEntries) {
      const externalEvent = representedEntry.externalEvent;
      const identity = externalEvent?.id
        ? `${externalEvent.sourceUrl || ""}::${externalEvent.id}`
        : `${representedEntry.title || ""}::${representedEntry.startDate.getTime()}`;
      if (seen.has(identity)) continue;
      seen.add(identity);
      const title = representedEntry.title || externalEvent?.title || "External event";
      menu.addItem((item) => {
        item
          .setTitle(title)
          .setIcon("triangle-alert")
          .onClick(() => {
            void onEntryClick(representedEntry, false);
          });
      });
    }

    if (seen.size === 0) return;
    menu.showAtMouseEvent(mouseEvent);
  }, [onEntryClick]);

  const showDayMarkerMenu = useCallback((marker: CalendarDayMarkerOverlay, type: "auxiliary" | "archived", event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();

    const matchingEntries = entries.filter((entry) => {
      const isRequestedType = type === "auxiliary"
        ? !!entry.isAuxiliaryDate
        : !!entry.isArchivedExternalPlaceholder;
      if (!isRequestedType) return false;
      const date = entry.startDate instanceof Date ? entry.startDate : new Date(entry.startDate);
      return Number.isFinite(date.getTime()) && formatDateKey(date) === marker.dateKey;
    });
    if (!matchingEntries.length) return;

    const representative = { ...matchingEntries[0] };
    if (type === "auxiliary") {
      representative.auxiliaryDateEntries = matchingEntries.flatMap((entry) => (
        entry.auxiliaryDateEntries?.length ? entry.auxiliaryDateEntries : [entry]
      ));
      showAuxiliaryDateMenu(representative, event.nativeEvent);
    } else {
      representative.archivedExternalEntries = matchingEntries.flatMap((entry) => (
        entry.archivedExternalEntries?.length ? entry.archivedExternalEntries : [entry]
      ));
      showArchivedExternalMenu(representative, event.nativeEvent);
    }
  }, [entries, showArchivedExternalMenu, showAuxiliaryDateMenu]);

  const eventClickPreviewTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const clearEventClickPreview = useCallback(() => {
    if (eventClickPreviewTimeoutRef.current) {
      clearTimeout(eventClickPreviewTimeoutRef.current);
      eventClickPreviewTimeoutRef.current = null;
    }
  }, []);

  const revealCompletedTaskForPreview = useCallback((entry: CalendarEntry | undefined) => {
    if (!app || !entry?.entry?.file) return;
    const inlineTask = (entry.entry as any)?.inlineTask as { lineNumber?: number; completed?: boolean } | undefined;
    if (!inlineTask || typeof inlineTask.lineNumber !== "number") return;
    revealCompletedCheckboxesForFile(app, entry.entry.file.path, inlineTask.lineNumber);
  }, [app]);

  const normalizeTaskPreviewText = useCallback((value: string): string =>
    String(value || "")
      .replace(/\[[^\]]+::[^\]]*\]/g, " ")
      .replace(/\b(?:scheduled|timeEstimate|due|start|end)::\s*\S+/gi, " ")
      .replace(/#[\w/-]+/g, " ")
      .replace(/[-*]\s+\[[^\]]*\]\s*/, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase(),
  []);

  const highlightTaskLineInHoverPreview = useCallback((entry: CalendarEntry | undefined) => {
    if (!app || !entry?.entry?.file) return;
    const inlineTask = (entry.entry as any)?.inlineTask as { lineNumber?: number; title?: string; line?: string; scheduledValue?: string } | undefined;
    if (!inlineTask || typeof inlineTask.lineNumber !== "number") return;

    const file = entry.entry.file;
    const targetLineNumber = inlineTask.lineNumber;
    const targetTitle = normalizeTaskPreviewText(String(inlineTask.title || entry.title || ""));
    const targetDate = String(inlineTask.scheduledValue || "").match(/\d{4}-\d{2}-\d{2}/)?.[0]
      || (entry.startDate instanceof Date ? formatDateKey(entry.startDate) : "")
      || String(inlineTask.line || "").match(/\d{4}-\d{2}-\d{2}/)?.[0]
      || "";
    let disposed = false;
    const completedToggleClicked = new WeakSet<HTMLElement>();

    const getCandidateLineNumber = (candidate: HTMLElement): number | null => {
      const lineSource = candidate.getAttribute("data-line")
        || candidate.getAttribute("data-line-number")
        || candidate.closest<HTMLElement>("[data-line]")?.getAttribute("data-line")
        || candidate.closest<HTMLElement>("[data-line-number]")?.getAttribute("data-line-number");
      if (!lineSource) return null;
      const parsed = Number(lineSource);
      return Number.isFinite(parsed) ? parsed : null;
    };

    const revealCompletedRowsInPopover = (popover: HTMLElement) => {
      popover.querySelectorAll<HTMLElement>(".markdown-preview-view, .markdown-rendered, .markdown-reading-view")
        .forEach((root) => {
          root.addClass("tps-gcm-completed-checkboxes-revealed");
          root.addClass("tps-gcm-task-hiding-excluded");
        });
      popover
        .querySelectorAll<HTMLElement>(
          "li.task-list-item.is-checked, li.task-list-item[data-task='x'], li.task-list-item[data-task='X'], .task-list-item.is-checked"
        )
        .forEach((row) => {
          row.style.removeProperty("visibility");
          row.style.removeProperty("opacity");
          row.style.setProperty("display", row.tagName === "LI" ? "list-item" : "block", "important");
        });
    };

    const findAndHighlight = (sourceLine?: string, sourceLineCount?: number, attempt = 0): boolean => {
      if (disposed) return true;
      const normalizedSourceLine = normalizeTaskPreviewText(sourceLine || "");
      const normalizedSourcePrefix = normalizedSourceLine ? normalizedSourceLine.slice(0, 80) : "";
      const effectiveTargetDate = targetDate || String(sourceLine || "").match(/\d{4}-\d{2}-\d{2}/)?.[0] || "";
      const popovers = Array.from(document.querySelectorAll<HTMLElement>(".hover-popover, .popover, .workspace-leaf.mod-popover"));
      for (const popover of popovers) {
        revealCompletedRowsInPopover(popover);
        if (completedToggleClicked.has(popover)) continue;
        const completedToggle = Array.from(popover.querySelectorAll<HTMLElement>("button, .clickable-icon, [role='button']"))
          .find((el) => /show completed/i.test(el.innerText || el.getAttribute("aria-label") || el.getAttribute("title") || ""));
        if (completedToggle) {
          completedToggleClicked.add(popover);
          completedToggle.click();
        }
      }
      if (sourceLineCount && targetLineNumber >= 0) {
        const lineRatio = Math.min(1, Math.max(0, targetLineNumber / Math.max(1, sourceLineCount - 1)));
        const scanRatios = [
          Math.max(0, lineRatio - 0.22),
          Math.max(0, lineRatio - 0.12),
          lineRatio,
          Math.min(1, lineRatio + 0.12),
          Math.max(0, lineRatio - 0.32),
          Math.min(1, lineRatio + 0.24),
          0,
          0.25,
          0.5,
          0.75,
          1,
        ];
        const scrollRatio = scanRatios[Math.min(attempt, scanRatios.length - 1)] ?? lineRatio;
        for (const popover of popovers) {
          const scrollers = [
            popover,
            ...Array.from(popover.querySelectorAll<HTMLElement>(".markdown-preview-view, .view-content, .markdown-reading-view, .workspace-leaf-content")),
          ].filter((el) => el.scrollHeight > el.clientHeight + 8);
          for (const scroller of scrollers) {
            const targetTop = Math.max(0, (scroller.scrollHeight - scroller.clientHeight) * scrollRatio - scroller.clientHeight * 0.2);
            if (Math.abs(scroller.scrollTop - targetTop) > 24) scroller.scrollTop = targetTop;
          }
        }
      }
      const candidates = popovers.flatMap((popover) => {
        return Array.from(popover.querySelectorAll<HTMLElement>(
          "li.task-list-item, .task-list-item, .cm-line"
        ));
      });

      for (const candidate of candidates) {
        const text = normalizeTaskPreviewText(candidate.innerText || candidate.textContent || "");
        if (!text) continue;
        const candidateLine = getCandidateLineNumber(candidate);
        const matchesLine = candidateLine === targetLineNumber || candidateLine === targetLineNumber + 1;
        const matchesSource = normalizedSourcePrefix && text.includes(normalizedSourcePrefix) && (!effectiveTargetDate || text.includes(effectiveTargetDate));
        const matchesTitle = targetTitle && text.includes(targetTitle);
        const matchesDate = !effectiveTargetDate || text.includes(effectiveTargetDate);
        if (!matchesLine && !matchesSource && !(matchesTitle && matchesDate)) continue;

        candidate.scrollIntoView({ block: "center", inline: "nearest" });
        candidate.addClass("tps-calendar-source-line-highlight");
        candidate.addClass("tps-gcm-line-highlight");
        window.setTimeout(() => {
          candidate.removeClass("tps-calendar-source-line-highlight");
          candidate.removeClass("tps-gcm-line-highlight");
        }, 2200);
        disposed = true;
        return true;
      }
      return false;
    };

    app.vault.cachedRead(file).then((content: string) => {
      const sourceLines = content.split(/\r?\n/);
      const sourceLine = sourceLines[targetLineNumber];
      let attempts = 0;
      const run = () => {
        attempts += 1;
        if (findAndHighlight(sourceLine, sourceLines.length, attempts - 1) || attempts >= 18) return;
        window.setTimeout(run, 120);
      };
      window.setTimeout(run, 120);
    }).catch(() => {
      let attempts = 0;
      const run = () => {
        attempts += 1;
        if (findAndHighlight(undefined, undefined, attempts - 1) || attempts >= 12) return;
        window.setTimeout(run, 120);
      };
      window.setTimeout(run, 120);
    });
  }, [app, normalizeTaskPreviewText]);

  const openEntryClickPreview = useCallback((event: MouseEvent, targetEl: HTMLElement, entry: CalendarEntry) => {
    const file = entry.entry.file;
    if (!file || !app || !shouldForceBaseLinkPreview(app)) return;
    clearEventClickPreview();
    eventClickPreviewTimeoutRef.current = setTimeout(() => {
      eventClickPreviewTimeoutRef.current = null;
      revealCompletedTaskForPreview(entry);
      const hoverParent = app.workspace.activeLeaf || app.workspace.getMostRecentLeaf() || app.renderContext;
      app.workspace.trigger("hover-link", {
        event,
        source: "tps-calendar",
        hoverParent,
        targetEl,
        linktext: file.path,
        sourcePath: file.path,
      });
      window.setTimeout(() => revealCompletedTaskForPreview(entry), 80);
      highlightTaskLineInHoverPreview(entry);
    }, 80);
  }, [app, clearEventClickPreview, highlightTaskLineInHoverPreview, revealCompletedTaskForPreview]);

	  const handleEventClick = useCallback(
	    (clickInfo: EventClickArg) => {
	      clickInfo.jsEvent.preventDefault();
	      if (
	        clickInfo.jsEvent.button !== 0 ||
	        (Platform.isMacOS && clickInfo.jsEvent.ctrlKey && !clickInfo.jsEvent.metaKey)
	      ) {
	        clickInfo.jsEvent.stopPropagation();
	        return;
	      }
	      if (Date.now() < suppressEntryClickUntilRef.current) {
	        clickInfo.jsEvent.stopPropagation();
	        return;
	      }
      const directCalendarEntry = clickInfo.event.extendedProps.calendarEntry as CalendarEntry | undefined;
      const entryPath = clickInfo.event.extendedProps.entryPath as string | undefined;
      const entry =
        directCalendarEntry ??
        entries.find((candidate) => candidate.entry.file.path === entryPath);

      const isModEvent = clickInfo.jsEvent.ctrlKey || clickInfo.jsEvent.metaKey;
      const isDoubleClick = clickInfo.jsEvent.detail >= 2;
	      if (!entry) return;
      const inlineTask = (entry.entry as any)?.inlineTask as { lineNumber?: number } | undefined;
      const isInlineTaskEntry = !!inlineTask && typeof inlineTask.lineNumber === "number";

      if (entry.isAuxiliaryDate) {
        clickInfo.jsEvent.preventDefault();
        clickInfo.jsEvent.stopPropagation();
        showAuxiliaryDateMenu(entry, clickInfo.jsEvent);
        return;
      }

      if (entry.isArchivedExternalPlaceholder && (entry.archivedExternalEntries?.length || 0) > 1) {
        clickInfo.jsEvent.preventDefault();
        clickInfo.jsEvent.stopPropagation();
        showArchivedExternalMenu(entry, clickInfo.jsEvent);
        return;
      }

	      if (
	        clickInfo.jsEvent.button !== 0 ||
	        (Platform.isMacOS && clickInfo.jsEvent.ctrlKey && !clickInfo.jsEvent.metaKey)
	      ) {
	        clickInfo.jsEvent.preventDefault();
	        clickInfo.jsEvent.stopPropagation();
	        return;
	      }

	      if (Platform.isMobile) {
	        const entryPathForTap = `${entry.entry.file?.path || entryPath || ""}:${inlineTask?.lineNumber ?? ""}`;
	        const now = Date.now();
	        const previousTap = mobileEntryTapRef.current;
	        const isRepeatedTap =
	          !!entryPathForTap &&
	          previousTap?.path === entryPathForTap &&
	          now - previousTap.at < 450;
	        mobileEntryTapRef.current = { path: entryPathForTap, at: now };
	        if (isRepeatedTap && !entry.isExternal && !entry.isArchivedExternalPlaceholder) {
            clearEventClickPreview();
            if (mobileEntryActionTimeoutRef.current) {
              window.clearTimeout(mobileEntryActionTimeoutRef.current);
              mobileEntryActionTimeoutRef.current = null;
            }
	          clickInfo.jsEvent.preventDefault();
	          clickInfo.jsEvent.stopPropagation();
	          onEntryClick(entry, false, clickInfo.jsEvent);
	          return;
	        }
	        const syntheticEvent = {
	          nativeEvent: clickInfo.jsEvent,
          currentTarget: clickInfo.el,
          target: clickInfo.el,
          preventDefault: () => clickInfo.jsEvent.preventDefault(),
          stopPropagation: () => clickInfo.jsEvent.stopPropagation(),
        } as unknown as React.MouseEvent;
        (syntheticEvent.nativeEvent as any).fullCalendarEvent = clickInfo.event;
        if (mobileEntryActionTimeoutRef.current) {
          window.clearTimeout(mobileEntryActionTimeoutRef.current);
        }
        mobileEntryActionTimeoutRef.current = window.setTimeout(() => {
          mobileEntryActionTimeoutRef.current = null;
          onEntryContextMenu(syntheticEvent, entry.entry);
        }, 260);
        return;
      }
      if (
        shouldForceBaseLinkPreview(app) &&
        !isModEvent &&
        !isDoubleClick &&
        !entry.isExternal &&
        !entry.isArchivedExternalPlaceholder
      ) {
        clickInfo.jsEvent.preventDefault();
        clickInfo.jsEvent.stopPropagation();
        clickInfo.jsEvent.stopImmediatePropagation();
        openEntryClickPreview(clickInfo.jsEvent, clickInfo.el, entry);
        return;
      }
      clearEventClickPreview();
      onEntryClick(entry, isModEvent, clickInfo.jsEvent);
    },
    [onEntryClick, onEntryContextMenu, entries, showAuxiliaryDateMenu, showArchivedExternalMenu, openEntryClickPreview, clearEventClickPreview],
  );

  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  useEffect(() => {
    return () => {
      if (eventClickPreviewTimeoutRef.current) {
        clearTimeout(eventClickPreviewTimeoutRef.current);
        eventClickPreviewTimeoutRef.current = null;
      }
      if (mobileEntryActionTimeoutRef.current) {
        window.clearTimeout(mobileEntryActionTimeoutRef.current);
        mobileEntryActionTimeoutRef.current = null;
      }
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current);
        hoverTimeoutRef.current = null;
      }

	      for (const [element, handler] of eventContextMenuHandlersRef.current.entries()) {
	        element.removeEventListener("contextmenu", handler);
	        const contextMouseDownHandler = (element as any)._tpsContextMouseDownHandler as EventListener | undefined;
	        if (contextMouseDownHandler) {
	          element.removeEventListener("mousedown", contextMouseDownHandler);
	          delete (element as any)._tpsContextMouseDownHandler;
	        }
	      }
      eventContextMenuHandlersRef.current.clear();

    };
  }, []);

  const handleEventMouseEnter = useCallback(
    (mouseEnterInfo: { event: any; el: HTMLElement; jsEvent: MouseEvent }) => {
      if (mouseEnterInfo.event.extendedProps?.isAuxiliaryDate) return;
      if (!shouldForceBaseLinkPreview(app)) return;
      if (!mouseEnterInfo.jsEvent.metaKey && !mouseEnterInfo.jsEvent.ctrlKey) return;
      const entryPath = mouseEnterInfo.event.extendedProps.entryPath;
      const entry = entryPath ? basesEntryMap.get(entryPath) : undefined;
      if (!entry) return;

      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current);
      }

      hoverTimeoutRef.current = setTimeout(() => {
        if (app && entry) {
          const calendarEntry = mouseEnterInfo.event.extendedProps.calendarEntry as CalendarEntry | undefined;
          revealCompletedTaskForPreview(calendarEntry);
          const hoverParent = app.workspace.activeLeaf || app.workspace.getMostRecentLeaf() || app.renderContext;
          app.workspace.trigger("hover-link", {
            event: mouseEnterInfo.jsEvent,
            source: "tps-calendar",
            hoverParent,
            targetEl: mouseEnterInfo.el,
            linktext: entry.file.path,
            sourcePath: entry.file.path,
          });
          window.setTimeout(() => revealCompletedTaskForPreview(calendarEntry), 80);
          highlightTaskLineInHoverPreview(calendarEntry);
        }
      }, 300);
    },
    [app, basesEntryMap, highlightTaskLineInHoverPreview, revealCompletedTaskForPreview],
  );

  const handleMoreLinkClick = useCallback((_arg: any) => {
    setAllDayExpanded(prev => !prev);
    return false;
  }, []);

  const renderMoreLinkContent = useCallback((arg: any) => {
    if (allDayExpanded) {
      return { html: '<span class="tps-allday-collapse-link">↑ less</span>' };
    }
    return { html: `<span class="tps-allday-more-link">+${arg.num} more</span>` };
  }, [allDayExpanded]);

  const handleEventMouseLeave = useCallback(() => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
  }, []);

  const handleDrop = useCallback(
    async (dropInfo: EventDropArg) => {
      const allDay = dropInfo.event.allDay;
      if (!onEventDrop) {
        dropInfo.revert();
        return;
      }
      const directCalendarEntry = dropInfo.event.extendedProps.calendarEntry as CalendarEntry | undefined;
      const directEntry = directCalendarEntry?.entry;
      const entryPath = dropInfo.event.extendedProps.entryPath;
      const entry = directEntry ?? (entryPath ? basesEntryMap.get(entryPath) : undefined);
      if (!entry) { dropInfo.revert(); return; }
      const newStart = dropInfo.event.start;
      const newEnd = dropInfo.event.end;
      if (!newStart) { dropInfo.revert(); return; }
      const oldStart = dropInfo.oldEvent?.start ?? undefined;
      const oldEnd = dropInfo.oldEvent?.end ?? undefined;
      setPendingChange({ type: 'drop', info: dropInfo, entry, newStart, newEnd: newEnd ?? newStart, allDay, oldStart, oldEnd });
    },
    [onEventDrop, basesEntryMap],
  );

  const handleResize = useCallback(
    async (resizeInfo: any) => {
      if (!onEventResize) { resizeInfo.revert(); return; }
      const directCalendarEntry = resizeInfo.event.extendedProps.calendarEntry as CalendarEntry | undefined;
      const directEntry = directCalendarEntry?.entry;
      const entryPath = resizeInfo.event.extendedProps.entryPath;
      const entry = directEntry ?? (entryPath ? basesEntryMap.get(entryPath) : undefined);
      if (!entry) { resizeInfo.revert(); return; }
      const newStart = resizeInfo.event.start;
      const newEnd = resizeInfo.event.end;
      if (!newStart || !newEnd) { resizeInfo.revert(); return; }
      const oldStart = resizeInfo.oldEvent?.start ?? undefined;
      const oldEnd = resizeInfo.oldEvent?.end ?? undefined;
      setPendingChange({ type: 'resize', info: resizeInfo, entry, newStart, newEnd, allDay: resizeInfo.event.allDay, oldStart, oldEnd });
    },
    [onEventResize, basesEntryMap],
  );

  const confirmChangeWithScope = useCallback(async (scope: "all" | "single") => {
    if (!pendingChange) return;
    try {
      if (pendingChange.type === 'drop' && onEventDrop) {
        await onEventDrop(pendingChange.entry, pendingChange.newStart, pendingChange.newEnd ?? undefined, pendingChange.allDay, scope, pendingChange.oldStart, pendingChange.oldEnd ?? undefined);
      } else if (pendingChange.type === 'resize' && onEventResize) {
        await onEventResize(pendingChange.entry, pendingChange.newStart, pendingChange.newEnd ?? undefined, pendingChange.allDay, scope, pendingChange.oldStart, pendingChange.oldEnd ?? undefined);
      }
      setPendingChange(null);
    } catch (error) {
      logger.error(error);
      pendingChange.info.revert();
      setPendingChange(null);
    }
  }, [pendingChange, onEventDrop, onEventResize]);

  const handleCancelChange = useCallback(() => {
    if (!pendingChange) return;
    pendingChange.info.revert();
    setPendingChange(null);
  }, [pendingChange]);

  // --- Time labels for drag/resize ---
  const formatTime = useCallback((date: Date) => {
    return date.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
      hour12: timeFormatSetting === "12h",
    });
  }, [timeFormatSetting]);

  const formatSelectionPreview = useCallback((start: Date, end: Date, allDay: boolean) => {
    if (!allDay) {
      return `${formatTime(start)} - ${formatTime(end)}`;
    }
    const endInclusive = new Date(end.getTime() - 1);
    const startLabel = start.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    const endLabel = endInclusive.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    return startLabel === endLabel ? startLabel : `${startLabel} - ${endLabel}`;
  }, [formatTime]);

  const handleEventMount = useCallback(
    (arg: EventMountArg) => {
      const element = arg.el;
      const event = arg.event;
      if (!element) return;
      const isAuxiliaryDate = !!event.extendedProps?.isAuxiliaryDate;
      const isArchivedExternalPlaceholder = !!event.extendedProps?.isArchivedExternalPlaceholder;

      const isNonActiveEvent = !!event.extendedProps?.isNonActive || !!event.extendedProps?.isPast || event.classNames.includes("is-non-active") || event.classNames.includes("is-past");
      const mutedEventOpacity = isCanvasEmbed
        ? "1"
        : "var(--tps-completed-event-opacity, var(--tps-past-event-opacity, 0.5))";
      if (isNonActiveEvent) {
        element.style.setProperty("opacity", mutedEventOpacity, "important");
      } else {
        element.style.removeProperty("opacity");
      }

      const priorityColor = (event.extendedProps.priorityColor as string | undefined) ?? "";
      if (isArchivedExternalPlaceholder) {
        const archivedCount = Number(event.extendedProps?.archivedExternalCount || 0);
        const tooltip = String(
          event.extendedProps?.archivedExternalTooltip ||
          event.title ||
          "Restore archived event",
        ).trim();
        element.setAttribute("title", archivedCount > 1 ? tooltip : `Restore archived event: ${tooltip}`);
        element.setAttribute("data-archived-external", "true");
        const markerWidth = archivedCount > 1 ? "30px" : "22px";
        const harness = element.closest(".fc-timegrid-event-harness, .fc-daygrid-event-harness") as HTMLElement | null;
        if (harness) {
          harness.classList.add("tps-calendar-archived-external-harness");
          harness.style.setProperty("display", "block", "important");
          harness.style.setProperty("visibility", "visible", "important");
          harness.style.setProperty("opacity", "1", "important");
          harness.style.setProperty("overflow", "visible", "important");
          harness.style.setProperty("width", markerWidth, "important");
          harness.style.setProperty("min-width", markerWidth, "important");
          harness.style.setProperty("left", "auto", "important");
          harness.style.setProperty("right", "4px", "important");
          harness.style.setProperty("z-index", "7", "important");
        }
        element.style.setProperty("display", "flex", "important");
        element.style.setProperty("visibility", "visible", "important");
        element.style.setProperty("opacity", "1", "important");
        element.style.setProperty("overflow", "visible", "important");
        element.style.setProperty("background", "transparent", "important");
        element.style.setProperty("background-image", "none", "important");
        element.style.setProperty("border-color", "transparent", "important");
        element.style.setProperty("box-shadow", "none", "important");
        element.style.setProperty("color", "var(--text-warning, var(--text-accent))");
        element.style.setProperty("width", markerWidth, "important");
        element.style.setProperty("min-width", markerWidth, "important");
        element.style.setProperty("min-height", "18px");
      } else if (isAuxiliaryDate) {
        const tooltip = String(event.extendedProps?.auxiliaryDateTooltip || event.title || "").trim();
        if (tooltip) element.setAttribute("title", tooltip);
        const harness = element.closest(".fc-timegrid-event-harness, .fc-daygrid-event-harness") as HTMLElement | null;
        if (harness) {
          harness.classList.add("tps-calendar-aux-harness");
          harness.style.setProperty("display", "block", "important");
          harness.style.setProperty("visibility", "visible", "important");
          harness.style.setProperty("opacity", "1", "important");
          harness.style.setProperty("overflow", "visible", "important");
          harness.style.setProperty("width", "auto", "important");
          harness.style.setProperty("min-width", "16px", "important");
          harness.style.setProperty("left", "auto", "important");
          harness.style.setProperty("right", "4px", "important");
          harness.style.setProperty("z-index", "4", "important");
          harness.style.setProperty("pointer-events", "none", "important");
        }
        element.style.setProperty("display", "flex", "important");
        element.style.setProperty("visibility", "visible", "important");
        element.style.setProperty("opacity", "1", "important");
        element.style.setProperty("overflow", "visible", "important");
        element.style.setProperty("background", "transparent", "important");
        element.style.setProperty("background-image", "none", "important");
        element.style.setProperty("border-color", "transparent", "important");
        element.style.setProperty("box-shadow", "none", "important");
        element.style.setProperty("color", "var(--text-muted)");
        element.style.setProperty("width", "auto", "important");
        element.style.setProperty("min-width", "16px", "important");
        element.style.setProperty("height", "16px", "important");
        element.style.setProperty("min-height", "16px");
        element.style.setProperty("pointer-events", "auto", "important");
      } else if (priorityColor) {
        const harness = element.closest(".fc-timegrid-event-harness, .fc-daygrid-event-harness") as HTMLElement | null;
        if (harness) {
          harness.classList.toggle("tps-calendar-done-harness", isNonActiveEvent);
          harness.classList.toggle("tps-calendar-primary-harness", !isNonActiveEvent);
          harness.style.setProperty("z-index", isNonActiveEvent ? "2" : "6", "important");
        }
        element.style.setProperty("--priority-color", priorityColor);
        if (isEmbedMode) {
          element.style.setProperty("--tps-event-title-color", isNonActiveEvent ? "var(--text-muted)" : "white");
          element.style.setProperty(
            "background",
            isNonActiveEvent
              ? `color-mix(in srgb, ${priorityColor} 16%, transparent)`
              : priorityColor,
            "important",
          );
          element.style.setProperty(
            "background-image",
            isNonActiveEvent
              ? "none"
              : `linear-gradient(180deg, ${priorityColor}, color-mix(in srgb, ${priorityColor}, black 10%))`,
            "important",
          );
          element.style.setProperty(
            "border-color",
            isNonActiveEvent
              ? `color-mix(in srgb, ${priorityColor} 30%, transparent)`
              : `color-mix(in srgb, ${priorityColor} 92%, var(--background-modifier-border))`,
            "important",
          );
          element.style.setProperty("border-left", isNonActiveEvent
            ? `2px solid color-mix(in srgb, ${priorityColor} 48%, transparent)`
            : `2px solid ${priorityColor}`,
            "important",
          );
          element.style.setProperty("box-shadow", "none", "important");
          element.style.setProperty("opacity", isNonActiveEvent ? mutedEventOpacity : "1", "important");
        } else {
          element.style.setProperty("--tps-event-title-color", isNonActiveEvent ? "var(--text-muted)" : "white");
          element.style.setProperty(
            "background",
            isNonActiveEvent
              ? `color-mix(in srgb, ${priorityColor} 24%, var(--background-primary) 76%)`
              : priorityColor,
            "important",
          );
          element.style.setProperty(
            "background-image",
            isNonActiveEvent
              ? "none"
              : `linear-gradient(180deg, ${priorityColor}, color-mix(in srgb, ${priorityColor}, black 10%))`,
            "important",
          );
          element.style.setProperty(
            "border-color",
            isNonActiveEvent
              ? `color-mix(in srgb, ${priorityColor} 32%, var(--background-modifier-border) 68%)`
              : priorityColor,
            "important",
          );
          element.style.setProperty(
            "border-left",
            isNonActiveEvent
              ? `3px solid color-mix(in srgb, ${priorityColor} 46%, transparent)`
              : `3px solid color-mix(in srgb, ${priorityColor}, white 18%)`,
            "important",
          );
          element.style.setProperty("box-shadow", isNonActiveEvent ? "none" : "inset 0 1px rgba(255,255,255,0.24), 0 1px 2px rgba(0,0,0,0.35)", "important");
          element.style.setProperty("filter", isNonActiveEvent ? "saturate(0.45) brightness(0.82)" : "none", "important");
          element.style.setProperty("opacity", isNonActiveEvent ? mutedEventOpacity : "1", "important");
        }
      } else {
        const harness = element.closest(".fc-timegrid-event-harness, .fc-daygrid-event-harness") as HTMLElement | null;
        if (harness) {
          harness.classList.toggle("tps-calendar-done-harness", isNonActiveEvent);
          harness.classList.toggle("tps-calendar-primary-harness", !isNonActiveEvent);
          harness.style.setProperty("z-index", isNonActiveEvent ? "2" : "6", "important");
        }
        element.style.removeProperty("--priority-color");
        element.style.setProperty("--tps-event-title-color", isNonActiveEvent ? "var(--text-muted)" : "var(--text-normal)");
        if (isEmbedMode) {
          element.style.setProperty(
            "background",
            isNonActiveEvent
              ? "color-mix(in srgb, var(--background-secondary) 42%, transparent)"
              : "color-mix(in srgb, var(--background-secondary) 88%, var(--background-primary-alt))",
            "important",
          );
          element.style.setProperty("background-image", "none", "important");
          element.style.setProperty(
            "border-color",
            isNonActiveEvent
              ? "color-mix(in srgb, var(--background-modifier-border) 46%, transparent)"
              : "color-mix(in srgb, var(--text-muted) 50%, var(--background-modifier-border))",
            "important",
          );
          element.style.setProperty(
            "border-left",
            isNonActiveEvent
              ? "2px solid color-mix(in srgb, var(--text-muted) 42%, transparent)"
              : "2px solid var(--text-accent)",
            "important",
          );
          element.style.setProperty("box-shadow", "none", "important");
          element.style.setProperty("opacity", isNonActiveEvent ? mutedEventOpacity : "1", "important");
        } else {
          element.style.removeProperty("background");
          element.style.removeProperty("background-image");
          element.style.removeProperty("border-color");
          element.style.removeProperty("border-left");
          element.style.removeProperty("--tps-event-title-color");
        }
      }

      const isExternalDropPreview = !!event.extendedProps?.isExternalDropPreview;
      if (isExternalDropPreview) {
        element.style.opacity = "0.7";
        element.style.borderStyle = "dashed";
        element.style.pointerEvents = "none";
      }

      if (event.extendedProps.entryPath) {
        const entryPath = String(event.extendedProps.entryPath || "").trim();
        const calendarEntry = event.extendedProps.calendarEntry as CalendarEntry | undefined;
        const renderedCalendarEntry = calendarEntry && event.start
          ? { ...calendarEntry, startDate: new Date(event.start) }
          : calendarEntry;
        const inlineTask = (calendarEntry?.entry as any)?.inlineTask as { lineNumber?: number; title?: string } | undefined;
        const isInlineTaskEntry = !!calendarEntry && !!inlineTask && typeof inlineTask.lineNumber === "number";
        element.setAttribute('data-path', entryPath);
        element.setAttribute('aria-label', entryPath);
        element.classList.add('tps-calendar-entry');
        element.setAttribute('data-tps-calendar-context-owner', 'true');
        const titleEl = element.querySelector<HTMLElement>('.bases-calendar-event-title, .fc-event-title');
        if (!isInlineTaskEntry) {
          element.setAttribute('data-href', entryPath);
          element.setAttribute('data-linkpath', entryPath);
          element.classList.add('internal-link');
        }
        if (titleEl && !isInlineTaskEntry) {
          titleEl.classList.add('internal-link');
          titleEl.setAttribute('data-href', entryPath);
          titleEl.setAttribute('data-linkpath', entryPath);
          titleEl.setAttribute('aria-label', entryPath);
        }
        if (isInlineTaskEntry) {
          const taskCalendarEntry = renderedCalendarEntry ?? calendarEntry;
          const taskLineNumber = String(inlineTask.lineNumber! + 1);
          element.classList.remove("internal-link");
          element.removeAttribute("data-href");
          element.removeAttribute("data-linkpath");
          element.removeAttribute("href");
          element.setAttribute("role", "button");
          if (titleEl) {
            titleEl.classList.remove("internal-link");
            titleEl.removeAttribute("data-href");
            titleEl.removeAttribute("data-linkpath");
            titleEl.removeAttribute("href");
          }
          element.setAttribute("data-tps-gcm-context", "calendar-task");
          element.setAttribute("data-task-path", entryPath);
          element.setAttribute("data-task-line", taskLineNumber);
          element.setAttribute("data-tps-calendar-task-text", String(inlineTask.title || event.title || ""));
          element.setAttribute("data-tps-calendar-all-day", event.allDay ? "true" : "false");
          element.setAttribute("data-tps-calendar-start", event.start ? event.start.toISOString() : "");
          element.setAttribute("data-tps-calendar-end", event.end ? event.end.toISOString() : "");
          element.classList.add("tps-calendar-task-entry");
          if (titleEl) {
            titleEl.setAttribute("data-tps-gcm-context", "calendar-task");
            titleEl.setAttribute("data-task-path", entryPath);
            titleEl.setAttribute("data-task-line", taskLineNumber);
            titleEl.setAttribute("data-tps-calendar-all-day", event.allDay ? "true" : "false");
          }
          const previousTaskClickHandler = (element as any)._tpsCalendarTaskClickHandler as EventListener | undefined;
          if (previousTaskClickHandler) {
            element.removeEventListener("click", previousTaskClickHandler, true);
          }
          const taskClickHandler = (e: MouseEvent) => {
            if (
              e.button !== 0 ||
              (Platform.isMacOS && e.ctrlKey && !e.metaKey)
            ) {
              return;
            }
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            clearEventClickPreview();
            onEntryClick(taskCalendarEntry, e.ctrlKey || e.metaKey, e);
          };
          (element as any)._tpsCalendarTaskClickHandler = taskClickHandler;
          element.addEventListener("click", taskClickHandler, true);
        }
        const dragPath = String(event.extendedProps.entryPath || "").trim();
        const previousDragStartHandler = (element as any)._tpsDragStartHandler as ((dragEvent: DragEvent) => void) | undefined;
        if (previousDragStartHandler) {
          element.removeEventListener("dragstart", previousDragStartHandler);
          delete (element as any)._tpsDragStartHandler;
        }
        if (isAuxiliaryDate) {
          element.removeAttribute("draggable");
        } else {
          element.setAttribute("draggable", "true");
          const handleDragStart = (dragEvent: DragEvent) => {
            if (!dragEvent.dataTransfer || !dragPath) return;
            dragEvent.dataTransfer.effectAllowed = "copy";
            dragEvent.dataTransfer.setData("obsidian/file", dragPath);
            dragEvent.dataTransfer.setData("text/plain", dragPath);
            dragEvent.dataTransfer.setData("text/uri-list", `obsidian://open?file=${encodeURIComponent(dragPath)}`);
          };
          (element as any)._tpsDragStartHandler = handleDragStart;
          element.addEventListener("dragstart", handleDragStart);
        }

        const previousHoverMoveHandler = (element as any)._tpsHoverPreviewMouseMoveHandler as EventListener | undefined;
        if (previousHoverMoveHandler) {
          element.removeEventListener("mousemove", previousHoverMoveHandler);
        }
        const hoverMoveHandler = (e: MouseEvent) => {
          if (!e.metaKey && !e.ctrlKey) return;
          if (hoverTimeoutRef.current) return;
          const entry = entryPath ? basesEntryMap.get(entryPath) : undefined;
          if (!entry || !app || !shouldForceBaseLinkPreview(app)) return;
          hoverTimeoutRef.current = setTimeout(() => {
            hoverTimeoutRef.current = null;
            revealCompletedTaskForPreview(renderedCalendarEntry);
            const hoverParent = app.workspace.activeLeaf || app.workspace.getMostRecentLeaf() || app.renderContext;
            app.workspace.trigger("hover-link", {
              event: e,
              source: "tps-calendar",
              hoverParent,
              targetEl: element,
              linktext: entry.file.path,
              sourcePath: entry.file.path,
            });
            window.setTimeout(() => revealCompletedTaskForPreview(renderedCalendarEntry), 80);
            highlightTaskLineInHoverPreview(renderedCalendarEntry);
          }, 250);
        };
        (element as any)._tpsHoverPreviewMouseMoveHandler = hoverMoveHandler;
        element.addEventListener("mousemove", hoverMoveHandler);

      }
      if (!event.allDay) {
        const eventMinHeight = event.extendedProps.minEventHeight as number | undefined;
        if (typeof eventMinHeight === "number" && Number.isFinite(eventMinHeight) && eventMinHeight > 0) {
          element.style.minHeight = `${eventMinHeight}px`;
        }
      }

	      const contextMenuHandler = (e: MouseEvent) => {
	        suppressEntryClickUntilRef.current = Date.now() + 800;
	        e.preventDefault();
        const calendarEntry = event.extendedProps.calendarEntry as CalendarEntry | undefined;
        const inlineTask = (calendarEntry?.entry as any)?.inlineTask as { lineNumber?: number } | undefined;
        const isInlineTaskEntry = !!inlineTask && typeof inlineTask.lineNumber === "number";
        // Task events are handled directly by GCM's task-line menu. Do not let
        // Canvas replace that with the node/file context menu.
        if (isInlineTaskEntry || !isEmbedModeRef.current) {
          e.stopPropagation();
          e.stopImmediatePropagation();
        }
        const entry = event.extendedProps.entry as BasesEntry;
        if (entry && onEntryContextMenu) {
          (e as any).fullCalendarEvent = event;
          const syntheticEvent = {
            nativeEvent: e,
            currentTarget: element,
            target: e.target as HTMLElement,
            preventDefault: () => e.preventDefault(),
            stopPropagation: () => e.stopPropagation(),
          } as unknown as React.MouseEvent;
          (syntheticEvent.nativeEvent as any).fullCalendarEvent = event;
          onEntryContextMenu(syntheticEvent, entry);
        }
	      };
	      const contextMouseDownHandler = (e: MouseEvent) => {
	        if (e.button !== 0 || (Platform.isMacOS && e.ctrlKey && !e.metaKey)) {
	          suppressEntryClickUntilRef.current = Date.now() + 800;
	        }
	      };
      const previousContextHandler = eventContextMenuHandlersRef.current.get(element);
	      if (previousContextHandler) {
	        element.removeEventListener("contextmenu", previousContextHandler);
	      }
	      const previousContextMouseDownHandler = (element as any)._tpsContextMouseDownHandler as EventListener | undefined;
	      if (previousContextMouseDownHandler) {
	        element.removeEventListener("mousedown", previousContextMouseDownHandler);
	      }
	      eventContextMenuHandlersRef.current.set(element, contextMenuHandler);
	      element.addEventListener('contextmenu', contextMenuHandler);
	      (element as any)._tpsContextMouseDownHandler = contextMouseDownHandler;
	      element.addEventListener("mousedown", contextMouseDownHandler);
	    },
    [app, basesEntryMap, clearEventClickPreview, highlightTaskLineInHoverPreview, isCanvasEmbed, onEntryClick, onEntryContextMenu, openEntryClickPreview, revealCompletedTaskForPreview],
	  );

  const handleDayMount = useCallback((arg: any) => {
    const { date, el } = arg;
    const link = el.querySelector('a.fc-col-header-cell-cushion, a.fc-daygrid-day-number');
      if (link) {
        const linkEl = link as HTMLElement;
        linkEl.classList.add("tps-calendar-day-link");
        linkEl.setAttribute("data-tps-calendar-day-link", "true");
        linkEl.setAttribute("data-date", formatDateKey(date));
        linkEl.setAttribute("role", "button");
        linkEl.removeAttribute("href");
        if (!(link as HTMLElement).dataset?.tpsDailyNoteBound) {
        linkEl.dataset.tpsDailyNoteBound = "true";
        link.addEventListener('click', (e: MouseEvent) => {
          const currentOnDateClick = onDateClickRef.current;
          if (currentOnDateClick) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            currentOnDateClick(date, linkEl, e);
          }
        }, true);
      }
    }

    if (Platform.isMobile) {
      // Mobile header injection removed in favor of floating controls
    }
  }, [resolvedFilterViewMode, resolvedNavDays, onDateChange]);

  const handleEventWillUnmount = useCallback((arg: EventMountArg) => {
    const element = arg.el;
    const contextMenuHandler = eventContextMenuHandlersRef.current.get(element);
	    if (contextMenuHandler) {
	      element.removeEventListener("contextmenu", contextMenuHandler);
	      eventContextMenuHandlersRef.current.delete(element);
	    }
	    const contextMouseDownHandler = (element as any)._tpsContextMouseDownHandler as EventListener | undefined;
	    if (contextMouseDownHandler) {
	      element.removeEventListener("mousedown", contextMouseDownHandler);
	      delete (element as any)._tpsContextMouseDownHandler;
	    }
    const dragStartHandler = (element as any)._tpsDragStartHandler as EventListener | undefined;
    if (dragStartHandler) {
      element.removeEventListener("dragstart", dragStartHandler);
      delete (element as any)._tpsDragStartHandler;
    }
    const hoverMoveHandler = (element as any)._tpsHoverPreviewMouseMoveHandler as EventListener | undefined;
    if (hoverMoveHandler) {
      element.removeEventListener("mousemove", hoverMoveHandler);
      delete (element as any)._tpsHoverPreviewMouseMoveHandler;
    }
    const taskClickHandler = (element as any)._tpsCalendarTaskClickHandler as EventListener | undefined;
    if (taskClickHandler) {
      element.removeEventListener("click", taskClickHandler, true);
      delete (element as any)._tpsCalendarTaskClickHandler;
    }
  }, []);

  const handleDragStart = useCallback(
    (info: any) => {
      setIsInternalDragging(true);
      suppressEntryClickUntilRef.current = Date.now() + 800;
    },
    [],
  );

  const handleDragStop = useCallback(
    (info: any) => {
      setIsInternalDragging(false);
      suppressEntryClickUntilRef.current = Date.now() + 800;
    },
    [],
  );

  const handleResizeStart = useCallback(
    (info: any) => {
      setIsInternalDragging(true);
    },
    [],
  );

  const handleResizeStop = useCallback(
    (info: any) => {
      setIsInternalDragging(false);
    },
    [],
  );

  const handleSelect = useCallback(
    async (selection: DateSelectArg) => {
      if (!onCreateSelection) return;
      const { start, end, allDay } = normalizeCreateSelectionRange(
        selection,
        snapCreateSelections !== false,
        createSnapDurationMinutes,
      );
      try {
        setSelectionPreview(null);
        setSelectionPreviewPosition(null);
        await onCreateSelection(start, end, allDay);
      } catch (error) {
        logger.error('[Calendar] Error creating event:', error);
      } finally {
        setSelectionPreview(null);
        setSelectionPreviewPosition(null);
        calendarRef.current?.getApi()?.unselect();
      }
    },
    [onCreateSelection, snapCreateSelections, createSnapDurationMinutes],
  );

  const updateSelectionPreviewPosition = useCallback(() => {
    window.requestAnimationFrame(() => {
      const root = calendarBodyRef.current;
      const highlight = root?.querySelector<HTMLElement>(".fc-highlight");
      if (!highlight) {
        setSelectionPreviewPosition(null);
        return;
      }
      const rect = highlight.getBoundingClientRect();
      const top = Math.max(8, rect.top + 4);
      const left = Math.max(8, Math.min(rect.left + 6, window.innerWidth - 180));
      setSelectionPreviewPosition({ top, left });
    });
  }, []);

  const handleSelectAllow = useCallback((selectionInfo: any) => {
    const toDate = (value: any): Date | null => {
      if (!value) return null;
      if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : null;
      const parsed = new Date(value);
      return Number.isFinite(parsed.getTime()) ? parsed : null;
    };
    const start = toDate(selectionInfo?.start);
    const end = toDate(selectionInfo?.end);
    if (start && end && end.getTime() > start.getTime()) {
      setSelectionPreview(normalizeCreateSelectionRange(
        { ...selectionInfo, start, end } as DateSelectArg,
        snapCreateSelections !== false,
        createSnapDurationMinutes,
      ));
      updateSelectionPreviewPosition();
    }
    return true;
  }, [snapCreateSelections, createSnapDurationMinutes, updateSelectionPreviewPosition]);

  const handleUnselect = useCallback(() => {
    setSelectionPreview(null);
    setSelectionPreviewPosition(null);
  }, []);

  // --- External file drop handling ---
  const getDateFromDropEvent = useCallback((e: React.DragEvent): { date: Date; allDay: boolean } | null => {
    const stack = document.elementsFromPoint(e.clientX, e.clientY) as HTMLElement[];
    const elementAtPoint = stack[0] ?? document.elementFromPoint(e.clientX, e.clientY);
    if (!elementAtPoint) return null;

    let dateStr: string | null = null;
    let timeStr: string | null = null;
    let isAllDay = false;

    // Prefer the full hit stack, since timegrid slats often sit under event/overlay layers.
    for (const node of stack) {
      const slot = node.closest('.fc-timegrid-slot[data-time]') as HTMLElement | null;
      if (slot) {
        timeStr = slot.getAttribute('data-time');
        break;
      }
    }

    const timeGridBody =
      (stack.find((node) => node.closest('.fc-timegrid-body'))?.closest('.fc-timegrid-body') as HTMLElement | null)
      ?? (elementAtPoint.closest('.fc-timegrid-body') as HTMLElement | null);
    if (timeGridBody) {
      const cols = timeGridBody.querySelectorAll('.fc-timegrid-col[data-date]');
      const dropX = e.clientX;
      for (const col of Array.from(cols)) {
        const rect = col.getBoundingClientRect();
        if (dropX >= rect.left && dropX <= rect.right) {
          dateStr = col.getAttribute('data-date');
          break;
        }
      }
    }

    // If we couldn't directly hit a slat, derive time from slot geometry at this Y.
    if (!timeStr) {
      const fcRoot =
        (stack.find((node) => node.closest('.fc'))?.closest('.fc') as HTMLElement | null)
        ?? (elementAtPoint.closest('.fc') as HTMLElement | null);
      if (fcRoot) {
        const slotRows = Array.from(
          fcRoot.querySelectorAll<HTMLElement>('.fc-timegrid-slot[data-time]'),
        );
        if (slotRows.length > 0) {
          const y = e.clientY;
          let bestSlot: HTMLElement | null = null;
          let bestDist = Number.POSITIVE_INFINITY;
          for (const slot of slotRows) {
            const rect = slot.getBoundingClientRect();
            // Prefer the slot that contains the pointer Y.
            if (y >= rect.top && y < rect.bottom) {
              bestSlot = slot;
              break;
            }
            const dist = Math.min(Math.abs(y - rect.top), Math.abs(y - rect.bottom));
            if (dist < bestDist) {
              bestDist = dist;
              bestSlot = slot;
            }
          }
          if (bestSlot) {
            timeStr = bestSlot.getAttribute('data-time');
          }
        }
      }
    }

    if (!dateStr) {
      const dayGridCell = elementAtPoint.closest('.fc-daygrid-day');
      if (dayGridCell) {
        dateStr = dayGridCell.getAttribute('data-date');
        if (dateStr) isAllDay = true;
      }
    }

    if (!dateStr) {
      const colHeader =
        (stack.find((node) => node.closest('[data-date]'))?.closest('[data-date]') as HTMLElement | null)
        ?? (elementAtPoint.closest('[data-date]') as HTMLElement | null);
      if (colHeader) {
        dateStr = colHeader.getAttribute('data-date');
      }
    }

    if (!isAllDay) {
      const inAllDayRow = stack.some(
        (node) => !!node.closest('.fc-timegrid-allday, .fc-daygrid-day-events, .fc-daygrid-day'),
      );
      if (inAllDayRow && !timeStr) {
        isAllDay = true;
      }
    }

    if (!dateStr) return null;

    const date = new Date(dateStr + 'T00:00:00');
    if (timeStr) {
      const [hours, minutes] = timeStr.split(':').map(Number);
      date.setHours(hours, minutes, 0, 0);
      isAllDay = false;
    } else if (!isAllDay) {
      date.setHours(9, 0, 0, 0);
    }

    return { date, allDay: isAllDay };
  }, []);

  const handleExternalDragOver = useCallback((e: React.DragEvent) => {
    if (hasCalendarExternalDropData(e.dataTransfer.types) && onExternalDrop) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      const dropInfo = getDateFromDropEvent(e);
      if (dropInfo) {
        const preview = buildCalendarExternalDropPreviewRange({
          date: dropInfo.date,
          allDay: dropInfo.allDay,
          snapDurationMinutes,
          defaultEventDurationMinutes: defaultEventDuration,
        });
        setExternalDropPreview((prev) => {
          if (
            prev &&
            prev.allDay === preview.allDay &&
            prev.start.getTime() === preview.start.getTime() &&
            prev.end.getTime() === preview.end.getTime()
          ) {
            return prev;
          }
          return preview;
        });
      } else {
        setExternalDropPreview(null);
      }
    }
  }, [onExternalDrop, getDateFromDropEvent, snapDurationMinutes, defaultEventDuration]);

  const handleExternalDragEnter = useCallback((e: React.DragEvent) => {
    dragCounterRef.current++;
    if (hasCalendarExternalDropData(e.dataTransfer.types) && onExternalDrop) {
      e.preventDefault();
      setIsDraggingOver(true);
    }
  }, [onExternalDrop]);

  const handleExternalDragLeave = useCallback((e: React.DragEvent) => {
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) {
      setIsDraggingOver(false);
      setExternalDropPreview(null);
    }
  }, []);

  const handleExternalDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current = 0;
    setIsDraggingOver(false);
    setExternalDropPreview(null);
    if (!onExternalDrop) return;
    const request = buildCalendarExternalDropRequest(e.dataTransfer, getDateFromDropEvent(e));
    if (!request) return;
    try {
      await onExternalDrop(request.payload, request.date, request.allDay);
    } catch (error) {
      logger.error('[Calendar] Error handling external drop:', error);
    }
  }, [onExternalDrop, getDateFromDropEvent]);

  const eventsWithExternalDropPreview = useMemo(() => {
    const previewEvent = externalDropPreview
      ? [{
        id: "__tps_external_drop_preview__",
        title: "Drop here",
        start: externalDropPreview.start,
        end: externalDropPreview.end,
        allDay: externalDropPreview.allDay,
        classNames: ["bases-calendar-event", "bases-calendar-external-drop-preview"],
        extendedProps: {
          isExternalDropPreview: true,
          dropPreviewTimeLabel: formatSelectionPreview(
            externalDropPreview.start,
            externalDropPreview.end,
            externalDropPreview.allDay,
          ),
        },
        display: "block",
        backgroundColor: "var(--interactive-accent)",
        borderColor: "var(--interactive-accent)",
        textColor: "#ffffff",
      }]
      : [];
    return [...events, ...previewEvent];
  }, [events, externalDropPreview, formatSelectionPreview]);

  useEffect(() => {
    const api = calendarRef.current?.getApi?.();
    if (!api) return;
    const currentIds = new Set(
      (eventsWithExternalDropPreview as any[]).map((event) => String(event?.id ?? "")),
    );
    for (const event of api.getEvents()) {
      if (!currentIds.has(String(event.id))) {
        event.remove();
      }
    }
  }, [eventsWithExternalDropPreview]);

  const fullCalendarInstanceKey = `calendar-${resolvedFilterViewMode}-${resolvedShowFullDay}-${slotDurationMinutes}-${snapDurationMinutes}-${snapCreateSelections}-${createSnapDurationMinutes}-${dayHeaderFormatSetting}-${dayHeaderShowDate}-${timeFormatSetting}-${defaultScrollTimeSetting}-${showNowIndicator}`;

  const handleDatesSet = useCallback((arg: DatesSetArg) => {
    logger.log(
      `[CalendarReactView] datesSet view.type=${arg.view.type} title=${arg.view.title} start=${arg.start.toDateString()} end=${arg.end.toDateString()} desired=${viewName}`,
    );
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const start = new Date(arg.start);
    start.setHours(0, 0, 0, 0);
    const end = new Date(arg.end);
    end.setHours(0, 0, 0, 0);
    const isVisible = today >= start && today < end;
    setIsTodayVisible(isVisible);
    setVisibleDateRange({ start: new Date(start), end: new Date(end) });
    setHeaderTitle(arg.view?.title ?? "");

    if (isVisible && isFollowingNow) {
      window.setTimeout(() => scrollToNow(), 50);
    }

    // Sync the current date back to the parent view to persist state across re-renders
    if (onDateChange && arg.view) {
      let currentApiDate = arg.view.calendar.getDate();

      // If in a centered view mode (3d, 5d, 7d), we need to shift the date back to center
      // because the parent expects the center date, but FullCalendar reports the start date.
      if (resolvedFilterViewMode !== "month" && resolvedFilterViewMode !== "week" && resolvedFilterViewMode !== "continuous") {
        const offset = Math.floor((targetDayCount - 1) / 2);
        const centered = new Date(currentApiDate);
        centered.setDate(centered.getDate() + offset);
        currentApiDate = centered;
      }

      const timeSource = jumpTargetDate ?? currentDate;
      if (timeSource && isSameCalendarDay(currentApiDate, timeSource)) {
        currentApiDate = new Date(currentApiDate);
        currentApiDate.setHours(
          timeSource.getHours(),
          timeSource.getMinutes(),
          timeSource.getSeconds(),
          timeSource.getMilliseconds(),
        );
      }

      // Avoid infinite loops by checking if the date actually changed
      if (!currentDate || currentApiDate.getTime() !== currentDate.getTime()) {
        onDateChange(currentApiDate);
      }
    }
  }, [onDateChange, currentDate, jumpTargetDate, resolvedFilterViewMode, targetDayCount, isFollowingNow, scrollToNow, viewName, isSameCalendarDay]);

  const handleHiddenTimeToggle = useCallback(() => {
    if (hiddenTimeVisible) return;

    // Prevent follow-now from snapping to current time after toggling slot bounds.
    setIsFollowingNow(false);
    const edge = hoursToggleEdge;
    setHiddenTimeVisible(true);
    setHoursToggleVisible(false);
    scrollToTimelineEdge(edge);
  }, [
    hiddenTimeVisible,
    hoursToggleEdge,
    scrollToTimelineEdge,
    setIsFollowingNow,
  ]);

  const handleToggleFullDay = useCallback(() => {
    if (onToggleFullDay) {
      onToggleFullDay();
      return;
    }
    setLocalShowFullDay((value) => !value);
  }, [onToggleFullDay]);

  // --- Navigation handlers ---
  const handleTodayCentered = useCallback(() => {
    const api = calendarRef.current?.getApi();
    if (!api) return;
    if (navigationLocked || !canNavigateToday) return;
    if (resolvedFilterViewMode === "month" || resolvedFilterViewMode === "week") {
      api.today();
      if (onDateChange) onDateChange(api.getDate());
      if (resolvedFilterViewMode === "week") {
        setIsFollowingNow(true);
        setTimeout(() => scrollToNow(), 50);
      }
      return;
    }
    const offset = Math.floor((targetDayCount - 1) / 2);
    const calendarStart = new Date();
    calendarStart.setHours(0, 0, 0, 0);
    calendarStart.setDate(calendarStart.getDate() - offset);
    api.gotoDate(calendarStart);
    if (onDateChange) onDateChange(new Date());
    setIsFollowingNow(true);
    setTimeout(() => scrollToNow(), 50);
  }, [targetDayCount, resolvedFilterViewMode, onDateChange, scrollToNow, navigationLocked, canNavigateToday]);

  const handlePrevClick = useCallback(() => {
    if (navigationLocked || !canNavigatePrev) return;
    if (resolvedFilterViewMode === 'continuous') {
      if (document.querySelector('.bases-calendar-continuous-scroll-container')) {
        const el = document.querySelector('.bases-calendar-continuous-scroll-container') as HTMLElement;
        if (el) {
          const currentScroll = el.scrollTop;
          el.scrollTo({ top: currentScroll - 800, behavior: 'smooth' });
        }
      }
      return;
    }
    const api = calendarRef.current?.getApi();
    if (!api) return;
    if (resolvedFilterViewMode === "month") {
      api.prev();
      if (onDateChange) onDateChange(api.getDate());
      return;
    }
    const apiDate = api.getDate();
    const newStartDate = new Date(apiDate);
    newStartDate.setDate(newStartDate.getDate() - resolvedNavDays);
    api.gotoDate(newStartDate);
    const offset = Math.floor((targetDayCount - 1) / 2);
    const centerDate = new Date(newStartDate);
    centerDate.setDate(centerDate.getDate() + offset);
    if (onDateChange) onDateChange(centerDate);
  }, [resolvedNavDays, resolvedFilterViewMode, onDateChange, targetDayCount, navigationLocked, canNavigatePrev]);

  const handleNextClick = useCallback(() => {
    if (navigationLocked || !canNavigateNext) return;
    if (resolvedFilterViewMode === 'continuous') {
      const el = document.querySelector('.bases-calendar-continuous-scroll-container') as HTMLElement;
      if (el) {
        const currentScroll = el.scrollTop;
        el.scrollTo({ top: currentScroll + 800, behavior: 'smooth' });
      }
      return;
    }
    const api = calendarRef.current?.getApi();
    if (!api) return;
    if (resolvedFilterViewMode === "month") {
      api.next();
      if (onDateChange) onDateChange(api.getDate());
      return;
    }
    const apiDate = api.getDate();
    const newStartDate = new Date(apiDate);
    newStartDate.setDate(newStartDate.getDate() + resolvedNavDays);
    api.gotoDate(newStartDate);
    const offset = Math.floor((targetDayCount - 1) / 2);
    const centerDate = new Date(newStartDate);
    centerDate.setDate(centerDate.getDate() + offset);
    if (onDateChange) onDateChange(centerDate);
  }, [resolvedNavDays, resolvedFilterViewMode, onDateChange, targetDayCount, navigationLocked, canNavigateNext]);

  const setMobileUiHiddenClass = useCallback((className: string, hidden: boolean) => {
    if (!isMobile) return;
    document.body?.classList.toggle(className, hidden);
  }, [isMobile]);

  const setMobileGestureHidden = useCallback((hidden: boolean) => {
    if (mobileUiGestureHiddenRef.current === hidden) return;
    mobileUiGestureHiddenRef.current = hidden;
    setMobileUiHiddenClass(MOBILE_UI_GESTURE_HIDDEN_CLASS, hidden);
  }, [setMobileUiHiddenClass]);

  const setMobileKeyboardHidden = useCallback((hidden: boolean) => {
    if (mobileUiKeyboardHiddenRef.current === hidden) return;
    mobileUiKeyboardHiddenRef.current = hidden;
    setMobileUiHiddenClass(MOBILE_UI_KEYBOARD_HIDDEN_CLASS, hidden);
    if (hidden) {
      setMobileGestureHidden(false);
    }
  }, [setMobileUiHiddenClass, setMobileGestureHidden]);

  const evaluateMobileKeyboardState = useCallback(() => {
    if (!window.visualViewport) return;
    const currentHeight = window.visualViewport.height || window.innerHeight;

    if (!mobileKeyboardBaseHeightRef.current) {
      mobileKeyboardBaseHeightRef.current = currentHeight;
      return;
    }

    if (currentHeight > mobileKeyboardBaseHeightRef.current) {
      mobileKeyboardBaseHeightRef.current = currentHeight;
    }

    const delta = mobileKeyboardBaseHeightRef.current - currentHeight;
    setMobileKeyboardHidden(delta > MOBILE_KEYBOARD_COLLAPSE_THRESHOLD_PX);
  }, [setMobileKeyboardHidden]);

  const handleWrapperFocusIn = useCallback(() => {
    const target = document.activeElement as HTMLElement | null;
    if (!target) return;
    if (target.closest('input, textarea, [contenteditable="true"], [contenteditable]')) {
      setMobileKeyboardHidden(true);
    }
  }, [setMobileKeyboardHidden]);

  const handleWrapperFocusOut = useCallback(() => {
    if (mobileKeyboardDetectionTimerRef.current) {
      window.clearTimeout(mobileKeyboardDetectionTimerRef.current);
    }
    mobileKeyboardDetectionTimerRef.current = window.setTimeout(() => {
      const activeElement = document.activeElement as HTMLElement | null;
      if (!activeElement || !containerRef.current?.contains(activeElement)) {
        setMobileKeyboardHidden(false);
      }
      mobileKeyboardDetectionTimerRef.current = null;
    }, 80);
  }, [setMobileKeyboardHidden]);

  // --- Touch / Haptic ---
  const touchTimerRef = useRef<
    number | ReturnType<typeof window.setTimeout> | ReturnType<typeof setTimeout> | null
  >(null);

  const handleWrapperTouchStart = useCallback(() => {
    if (!isMobile) return;
    if (mobileSwipeRevealTimerRef.current) {
      window.clearTimeout(mobileSwipeRevealTimerRef.current);
      mobileSwipeRevealTimerRef.current = null;
    }
    setMobileGestureHidden(false);
    touchTimerRef.current = window.setTimeout(() => {
      if (navigator.vibrate) navigator.vibrate(50);
    }, 600);
  }, [isMobile]);

  const handleWrapperTouchEnd = useCallback(() => {
    if (mobileSwipeRevealTimerRef.current) {
      window.clearTimeout(mobileSwipeRevealTimerRef.current);
    }
    mobileSwipeRevealTimerRef.current = window.setTimeout(() => {
      setMobileGestureHidden(false);
      mobileSwipeRevealTimerRef.current = null;
    }, MOBILE_SWIPE_HIDE_TIMEOUT_MS);

    if (touchTimerRef.current) {
      window.clearTimeout(touchTimerRef.current);
      touchTimerRef.current = null;
    }
  }, []);

  const handleWrapperTouchMove = useCallback((event: React.TouchEvent<HTMLDivElement>) => {
    if (!isMobile) return;
    if (mobileSwipeRevealTimerRef.current) {
      window.clearTimeout(mobileSwipeRevealTimerRef.current);
      mobileSwipeRevealTimerRef.current = null;
    }
    setMobileGestureHidden(true);
    if (touchTimerRef.current) {
      window.clearTimeout(touchTimerRef.current);
      touchTimerRef.current = null;
    }
  }, [isMobile, setMobileGestureHidden]);

  // Mobile nav visibility
  useEffect(() => {
    if (!isMobile) return;
    setIsMobileNavHidden(false);
  }, [isMobile]);

  useEffect(() => {
    if (!isMobile) return;
    if (isInternalDragging) {
      setIsMobileNavHidden(true);
    } else {
      setIsMobileNavHidden(false);
    }
  }, [isMobile, isInternalDragging]);

  useEffect(() => {
    if (!isMobile) {
      setMobileKeyboardHidden(false);
      setMobileGestureHidden(false);
      return;
    }

    const container = containerRef.current;
    if (!container) return;

    const handleFocusIn = (evt: FocusEvent) => {
      const target = evt.target;
      if (target && target instanceof HTMLElement) {
        if (target.closest('input, textarea, [contenteditable="true"], [contenteditable]')) {
          setMobileKeyboardHidden(true);
          return;
        }
      }
      handleWrapperFocusIn();
    };

    const handleFocusOut = () => {
      handleWrapperFocusOut();
    };

    container.addEventListener("focusin", handleFocusIn);
    container.addEventListener("focusout", handleFocusOut);
    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", evaluateMobileKeyboardState);
      window.visualViewport.addEventListener("scroll", evaluateMobileKeyboardState);
    }

    evaluateMobileKeyboardState();
    mobileKeyboardBaseHeightRef.current = 0;
    if (mobileKeyboardDetectionTimerRef.current) {
      window.clearTimeout(mobileKeyboardDetectionTimerRef.current);
      mobileKeyboardDetectionTimerRef.current = null;
    }

    return () => {
      container.removeEventListener("focusin", handleFocusIn);
      container.removeEventListener("focusout", handleFocusOut);
      if (window.visualViewport) {
        window.visualViewport.removeEventListener("resize", evaluateMobileKeyboardState);
        window.visualViewport.removeEventListener("scroll", evaluateMobileKeyboardState);
      }
      if (mobileKeyboardDetectionTimerRef.current) {
        window.clearTimeout(mobileKeyboardDetectionTimerRef.current);
        mobileKeyboardDetectionTimerRef.current = null;
      }
      if (mobileSwipeRevealTimerRef.current) {
        window.clearTimeout(mobileSwipeRevealTimerRef.current);
        mobileSwipeRevealTimerRef.current = null;
      }
      mobileKeyboardBaseHeightRef.current = 0;
      setMobileKeyboardHidden(false);
      setMobileGestureHidden(false);
    };
  }, [
    isMobile,
    handleWrapperFocusIn,
    handleWrapperFocusOut,
    setMobileGestureHidden,
    setMobileKeyboardHidden,
    evaluateMobileKeyboardState,
  ]);

  const handleCondenseChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (onCondenseLevelChange) {
      onCondenseLevelChange(Number(e.target.value));
    }
  }, [onCondenseLevelChange]);

  const [isMini, setIsMini] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setIsMini(entry.contentRect.width < 550);
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // Manual delegated event listener for 'more' links
  // This is a robust fallback if FullCalendar's moreLinkClick prop fails
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleDelegatedClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const moreLink = target.closest('.fc-more-link');

      if (moreLink) {
        e.preventDefault();
        e.stopPropagation();

        // Try to find the date from the parent day cell (dayGrid or timeGrid)
        const dayCell = moreLink.closest('.fc-daygrid-day') ?? moreLink.closest('.fc-timegrid-col');
        const dateStr = dayCell?.getAttribute('data-date');

        if (dateStr) {
          const [y, m, d] = dateStr.split('-').map(Number);
          const date = new Date(y, m - 1, d); // Month is 0-indexed
          handleMoreLinkClick({ date, jsEvent: e });
        } else {
          // Fallback: use FullCalendar's arg.date if available via moreLinkClick prop
        }
      }
    };

    container.addEventListener('click', handleDelegatedClick, true); // Capture phase
    return () => {
      container.removeEventListener('click', handleDelegatedClick, true);
    };
  }, [handleMoreLinkClick]);

  const views = {
    "timeGridRange-1": { type: "timeGrid", duration: { days: 1 }, buttonText: "Day" },
    "timeGridRange-2": { type: "timeGrid", duration: { days: 2 }, buttonText: "2d" },
    "timeGridRange-3": { type: "timeGrid", duration: { days: 3 }, buttonText: "3d" },
    "timeGridRange-4": { type: "timeGrid", duration: { days: 4 }, buttonText: "4d" },
    "timeGridRange-5": { type: "timeGrid", duration: { days: 5 }, buttonText: "5d" },
    "timeGridRange-7": { type: "timeGrid", duration: { days: 7 }, buttonText: "7d" },
    timeGridWeek: { buttonText: "Week" },
    dayGridMonth: { buttonText: "Month" },
  };
  // --- Render ---
  return (
    <div
      ref={containerRef}
      className={`bases-calendar-wrapper ${isEmbedMode ? 'bases-calendar-embedded' : 'bases-calendar-dedicated'} ${isCanvasEmbed ? 'bases-calendar-canvas-embedded' : ''} ${isDraggingOver ? 'is-drag-over' : ''} ${isMini ? 'bases-calendar-mini' : ''} ${allDayStickyScroll ? 'allday-sticky' : 'allday-no-sticky'}`}
      style={{
        height: isEmbedMode ? scrollSurfaceHeight : isMobile ? "auto" : `${dedicatedCalendarHeight}px`,
        minHeight: isEmbedMode ? (useCanvasEmbedSizing ? 0 : `${embedFallbackHeight}px`) : isMobile ? undefined : `${dedicatedCalendarHeight}px`,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        "--calendar-slot-height": `${computedSlotHeight}px`,
        "--calendar-slot-zoom": `${effectiveZoom}`,
        "--tps-calendar-embedded-height": `${computedEmbedCalendarHeight}px`,
        "--tps-allday-event-height": `${isEmbedMode ? Math.min(allDayEventHeight, 20) : allDayEventHeight}px`,
        "--tps-allday-max-rows": `${resolvedAllDayMaxRows}`,
        "--tps-completed-event-opacity": `${pastEventOpacity / 100}`,
        "--tps-past-event-opacity": `${pastEventOpacity / 100}`,
        "--tps-event-font-size": eventFontSize === "small" ? "var(--font-ui-smaller)" : eventFontSize === "large" ? "var(--font-ui-medium)" : "var(--font-ui-small)",
        "--tps-event-title-font-size": isEmbedMode
          ? "var(--font-ui-smaller)"
          : isMobile
          ? "clamp(10px, 2.4vw, 12px)"
          : eventFontSize === "large"
            ? "var(--font-ui-medium)"
            : "var(--font-ui-small)",
        "--tps-event-title-weight": "400",
        "--tps-event-title-line-height": isMobile ? "1.05" : "1.1",
        "--tps-event-title-shadow": isCanvasEmbed ? "none" : "0 1px 1px rgba(0, 0, 0, 0.28)",
        position: "relative"
      } as React.CSSProperties}
      onDragOver={handleExternalDragOver}
      onDragEnter={handleExternalDragEnter}
      onDragLeave={handleExternalDragLeave}
      onDrop={handleExternalDrop}
      onTouchStart={handleWrapperTouchStart}
      onTouchEnd={handleWrapperTouchEnd}
      onTouchMove={handleWrapperTouchMove}
    >
      <style>{CALENDAR_EVENT_DENSITY_CSS}</style>
      {pendingChange && (
        <div
          style={{
            position: "fixed",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            backgroundColor: "var(--background-primary)",
            border: "2px solid var(--background-modifier-border)",
            borderRadius: "8px",
            padding: "16px 24px",
            boxShadow: "0 4px 12px rgba(0, 0, 0, 0.3)",
            zIndex: 1000,
            minWidth: "300px",
            textAlign: "center"
          }}
        >
          <>
            <div style={{ marginBottom: "16px", fontSize: "14px", color: "var(--text-normal)" }}>
              Confirm event {pendingChange.type === 'drop' ? 'move' : 'resize'}?
            </div>
            <div style={{ display: "flex", gap: "12px", justifyContent: "center" }}>
              <button
                type="button"
                onClick={() => confirmChangeWithScope("all")}
                style={{
                  padding: "8px 16px",
                  backgroundColor: "var(--interactive-accent)",
                  color: "var(--text-on-accent)",
                  border: "none",
                  borderRadius: "4px",
                  cursor: "pointer",
                  fontWeight: "500"
                }}
              >
                Confirm
              </button>
              <button
                type="button"
                onClick={handleCancelChange}
                style={{
                  padding: "8px 16px",
                  backgroundColor: "var(--background-modifier-border)",
                  color: "var(--text-normal)",
                  border: "none",
                  borderRadius: "4px",
                  cursor: "pointer",
                  fontWeight: "500"
                }}
              >
                Cancel
              </button>
            </div>
          </>
        </div>
      )}

      {pendingChange && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0, 0, 0, 0.5)",
            zIndex: 999
          }}
          onClick={handleCancelChange}
        />
      )}

      {(!isEmbedMode || isCanvasEmbed) && (
        <CalendarNavigation
          showNavButtons={isCanvasEmbed ? true : showNavButtons}
          navigationLocked={navigationLocked}
          canNavigatePrev={canNavigatePrev}
          canNavigateNext={canNavigateNext}
          canNavigateToday={canNavigateToday}
          navigationBoundsStart={navigationBoundsStart}
          navigationBoundsEnd={navigationBoundsEnd}
          headerTitle={headerTitle}
          currentDate={currentDate}
          onDateChange={onDateChange}
          onPrevClick={handlePrevClick}
          onNextClick={handleNextClick}
          onTodayCentered={handleTodayCentered}
          mobileNavHidden={mobileNavHidden}
          floatingNavStyle={floatingNavStyle}
          mode="embedded"
        />
      )}

      {dayMarkerOverlays.map((marker) => (
        <div
          key={marker.dateKey}
          className="tps-calendar-day-marker-overlay"
          title={marker.title}
          style={{
            "--tps-marker-left": `${marker.left}px`,
            "--tps-marker-top": `${marker.top}px`,
          } as React.CSSProperties}
        >
          {marker.auxiliary > 0 && (
            <button
              type="button"
              className="tps-calendar-day-marker-chip is-auxiliary-date"
              title={marker.title || "Open additional date records"}
              aria-label={`Open ${marker.auxiliary} additional date ${marker.auxiliary === 1 ? "record" : "records"}`}
              onClick={(event) => showDayMarkerMenu(marker, "auxiliary", event)}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <CalendarMarkerIcon iconName="file-text" />
              {marker.auxiliary > 1 && (
                <span className="tps-calendar-day-marker-count">{marker.auxiliary}</span>
              )}
            </button>
          )}
          {marker.archived > 0 && (
            <button
              type="button"
              className="tps-calendar-day-marker-chip is-archived-external"
              title={marker.title || "Open hidden external events"}
              aria-label={`Open ${marker.archived} hidden external ${marker.archived === 1 ? "event" : "events"}`}
              onClick={(event) => showDayMarkerMenu(marker, "archived", event)}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <CalendarMarkerIcon iconName="triangle-alert" />
              {marker.archived > 1 && (
                <span className="tps-calendar-day-marker-count">{marker.archived}</span>
              )}
            </button>
          )}
        </div>
      ))}

      {shouldEnableScrollHoursToggle && !hiddenTimeVisible && (
        <button
          type="button"
          className={`bases-calendar-scroll-hours-toggle ${hoursToggleEdge === "top" ? "is-top" : "is-bottom"}${hoursToggleVisible ? " is-visible" : ""}${hasHiddenTimeEventsInVisibleRange ? " has-hidden-events" : " has-no-hidden-events"}`}
          onClick={handleHiddenTimeToggle}
          title="Show all hours"
          aria-label="Show all hours"
        >
          {hoursToggleEdge === "top" ? "↑" : "↓"}
        </button>
      )}

      {selectionPreview && (
        <div
          className="bases-calendar-selection-preview"
          style={{
            position: "fixed",
            top: selectionPreviewPosition?.top ?? 12,
            left: selectionPreviewPosition?.left ?? 12,
            zIndex: 100000,
            background: "var(--background-primary)",
            border: "1px solid var(--background-modifier-border)",
            borderRadius: "999px",
            padding: "4px 10px",
            fontSize: "12px",
            fontWeight: 600,
            color: "var(--text-normal)",
            pointerEvents: "none",
            boxShadow: "0 4px 12px rgba(0,0,0,0.2)",
          }}
        >
          {formatSelectionPreview(selectionPreview.start, selectionPreview.end, selectionPreview.allDay)}
        </div>
      )}

      <div
        ref={calendarBodyRef}
        style={{
          flex: isEmbedMode ? "1 1 0%" : isMobile ? "1 1 auto" : "1 1 0%",
          height: isEmbedMode ? "100%" : isMobile ? "auto" : `${dedicatedCalendarHeight}px`,
          minHeight: isEmbedMode ? 0 : isMobile ? undefined : 0,
          overflow: "hidden",
          position: "relative",
          display: "flex",
          flexDirection: "column"
        }}
      >
        <div
          className="bases-calendar-scroll-surface"
          style={{
            flex: "1 1 0%",
            width: "100%",
            height: scrollSurfaceHeight,
            overflowY: scrollSurfaceOverflowY,
            overflowX: "hidden",
            WebkitOverflowScrolling: "touch"
          }}
        >
          {resolvedFilterViewMode !== 'continuous' && (
            <FullCalendar
              height={fullCalendarHeight}
              contentHeight={fullCalendarContentHeight}
              expandRows={resolvedFilterViewMode === "month" && !isEmbedMode && !isMobile}
              plugins={activePlugins}
              key={fullCalendarInstanceKey}
              ref={calendarRef}
              initialView={viewName}
              initialDate={safeInitialDate}
              views={views}
              headerToolbar={false}
              selectable={allowSelect}
              selectMirror={allowSelect}
              selectOverlap={allowSelect}
              selectAllow={allowSelect ? handleSelectAllow : undefined}
              slotEventOverlap={!isEmbedMode}
              select={allowSelect ? handleSelect : undefined}
              selectLongPressDelay={isMobile ? 600 : 300}
              longPressDelay={isMobile ? 600 : 300}
              eventLongPressDelay={isMobile ? 600 : 300}
              eventDragMinDistance={isMobile ? 10 : 5}
              unselectAuto={true}
              unselectCancel=".fc-event"
              unselect={allowSelect ? handleUnselect : undefined}
              editable={allowEdit}
              eventStartEditable={allowEdit}
              eventDurationEditable={allowEdit && !!onEventResize}
              events={eventsWithExternalDropPreview}
              eventContent={(info) => { return renderEventContent(info); }}
              eventClick={handleEventClick}
              eventMouseEnter={handleEventMouseEnter}
              eventMouseLeave={handleEventMouseLeave}
              eventDrop={handleDrop}
              eventResize={handleResize}
              eventDidMount={handleEventMount}
              dayHeaderDidMount={handleDayMount}
              dayCellDidMount={handleDayMount}
              eventWillUnmount={handleEventWillUnmount}
              eventDragStart={handleDragStart}
              eventDragStop={handleDragStop}
              eventResizeStart={handleDragStart}
              // @ts-ignore
              eventResizeStop={handleDragStop}

              nowIndicator={showNowIndicator}
              dayHeaderFormat={
                resolvedFilterViewMode === "month"
                  ? { weekday: dayHeaderFormatSetting }
                  : dayHeaderShowDate
                    ? { weekday: dayHeaderFormatSetting, month: "short", day: "numeric" }
                    : { weekday: dayHeaderFormatSetting }
              }
              firstDay={safeWeekStartDay}
              slotMinTime={embeddedSlotMinTimeValue}
              slotMaxTime={slotMaxTimeValue}
              scrollTime={fullCalendarScrollTimeValue}
              scrollTimeReset={false}
              slotDuration={formatFullCalendarDuration(slotDurationMinutes, 30)}
              slotLaneDidMount={handleSlotMount}
              slotLabelDidMount={handleSlotMount}
              snapDuration={formatFullCalendarDuration(snapDurationMinutes, 5)}
              slotLabelInterval="01:00"

              slotLabelFormat={{
                hour: "numeric",
                minute: "2-digit",
                hour12: timeFormatSetting === "12h",
                meridiem: timeFormatSetting === "12h" ? 'short' : false as any,
              }}
              allDaySlot={resolvedShowFullDay}
              allDayText="all-day"
              displayEventTime={false}
              displayEventEnd={false}
              navLinks={true}
              navLinkDayClick={(date, jsEvent) => {
                jsEvent?.preventDefault?.();
                jsEvent?.stopPropagation?.();
                jsEvent?.stopImmediatePropagation?.();
                if (onDateClick) onDateClick(date, jsEvent?.target as HTMLElement | undefined, jsEvent as MouseEvent);
              }}
              datesSet={handleDatesSet}
              validRange={validRange}
              showNonCurrentDates={true}
              dayMaxEvents={fullCalendarAllDayMaxRows}
              dayMaxEventRows={fullCalendarAllDayMaxRows}
              // @ts-ignore
              moreLinkClick={handleMoreLinkClick}
              moreLinkContent={renderMoreLinkContent}
              fixedWeekCount={false}
              stickyHeaderDates={isEmbedMode}
              handleWindowResize={true}
              windowResizeDelay={100}
            />
          )}

          {resolvedFilterViewMode === 'continuous' && (
            <ContinuousScrollView
              currentDate={currentDate}
              events={eventsWithExternalDropPreview}
              allDayMaxRows={allDayMaxRows}
              slotMinTimeValue={slotMinTimeValue}
              slotMaxTimeValue={slotMaxTimeValue}
              defaultScrollTime={DEFAULT_SCROLL_TIME}
              resolvedShowFullDay={resolvedShowFullDay}
              safeWeekStartDay={safeWeekStartDay}
              allowEdit={allowEdit}
              allowSelect={allowSelect}
              onEventResize={onEventResize}
              handleEventClick={handleEventClick}
              renderEventContent={renderEventContent}
              handleDrop={handleDrop}
              handleResize={handleResize}
              handleEventMount={handleEventMount}
              handleEventWillUnmount={handleEventWillUnmount}
              handleDragStart={handleDragStart}
              handleDragStop={handleDragStop}
              handleResizeStart={handleResizeStart}
              handleResizeStop={handleResizeStop}
              handleSelect={allowSelect ? handleSelect : undefined}
              handleSelectAllow={allowSelect ? handleSelectAllow : undefined}
              handleUnselect={allowSelect ? handleUnselect : undefined}
              onDateClick={onDateClick}
              slotDurationMinutes={slotDurationMinutes}
              snapDurationMinutes={snapDurationMinutes}
              handleMoreLinkClick={handleMoreLinkClick}
              renderMoreLinkContent={renderMoreLinkContent}
              allDayExpanded={allDayExpanded}
            />
          )}
        </div>
      </div>
    </div>
  );
};

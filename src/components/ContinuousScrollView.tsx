import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin from "@fullcalendar/interaction";
import timeGridPlugin from "@fullcalendar/timegrid";
import { EventContentArg, EventMountArg } from "@fullcalendar/core";
import { Platform } from "obsidian";

const PLUGINS = [dayGridPlugin, timeGridPlugin, interactionPlugin];

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

interface ContinuousScrollViewProps {
  currentDate?: Date;
  events: any[];
  allDayMaxRows?: number;
  slotMinTimeValue: string;
  slotMaxTimeValue: string;
  defaultScrollTime: string;
  slotDurationMinutes?: number;
  snapDurationMinutes?: number;
  eventMinHeight?: number;
  resolvedShowFullDay: boolean;
  safeWeekStartDay: number;
  allowEdit: boolean;
  allowSelect: boolean;
  onEventResize?: (...args: any[]) => any;
  // Handlers (shared with main calendar)
  handleEventClick: (info: any) => void;
  renderEventContent: (info: EventContentArg) => any;
  handleDrop: (info: any) => void;
  handleResize: (info: any) => void;
  handleEventMount: (arg: EventMountArg) => void;
  handleEventWillUnmount: (arg: EventMountArg) => void;
  handleDragStart: (info: any) => void;
  handleDragStop: (info: any) => void;
  handleResizeStart: (info: any) => void;
  handleResizeStop: (info: any) => void;
  handleSelect?: (selection: any) => void;
  handleSelectAllow?: (selection: any) => boolean;
  handleUnselect?: () => void;
  onDateClick?: (date: Date, targetEl?: HTMLElement, event?: MouseEvent) => void;
  onDateChange?: (date: Date, interactionStartedAt: number) => void;
  onRenderedDateCommit?: (date: Date) => void;
  handleMoreLinkClick?: (arg: any) => void;
  renderMoreLinkContent?: (arg: any) => any;
  allDayExpanded?: boolean;
}

/**
 * Renders a continuous vertical scroll view with one FullCalendar
 * per day, infinite scroll up/down (capped at 14 days).
 */
export const ContinuousScrollView: React.FC<ContinuousScrollViewProps> = ({
  currentDate,
  events,
  allDayMaxRows,
  slotMinTimeValue,
  slotMaxTimeValue,
  defaultScrollTime,
  slotDurationMinutes = 30,
  snapDurationMinutes = 5,
  eventMinHeight = 0,
  resolvedShowFullDay,
  safeWeekStartDay,
  allowEdit,
  allowSelect,
  onEventResize,
  handleEventClick,
  renderEventContent,
  handleDrop,
  handleResize,
  handleEventMount,
  handleEventWillUnmount,
  handleDragStart,
  handleDragStop,
  handleResizeStart,
  handleResizeStop,
  handleSelect,
  handleSelectAllow,
  handleUnselect,
  onDateClick,
  onDateChange,
  onRenderedDateCommit,
  handleMoreLinkClick,
  renderMoreLinkContent,
  allDayExpanded,
}) => {
  const isMobile = Platform.isMobile;
  const [continuousDays, setContinuousDays] = useState<Date[]>([]);
  const continuousContainerRef = useRef<HTMLDivElement>(null);
  const prevScrollHeightRef = useRef(0);
  const isPrependingRef = useRef(false);
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const centerTimeoutRef = useRef<number | null>(null);
  const centerFrameRef = useRef<number | null>(null);
  const centerReleaseTimeoutRef = useRef<number | null>(null);
  const centerGenerationRef = useRef(0);
  const programmaticCenteringRef = useRef(false);
  const renderedCommitRef = useRef(onRenderedDateCommit);

  useEffect(() => {
    renderedCommitRef.current = onRenderedDateCommit;
  }, [onRenderedDateCommit]);

  // Initialize days on mount or date change
  useEffect(() => {
    const centerGeneration = ++centerGenerationRef.current;
    const base = currentDate || new Date();

    const days: Date[] = [];
    for (let i = -2; i <= 2; i++) {
      const d = new Date(base);
      d.setDate(d.getDate() + i);
      days.push(d);
    }
    setContinuousDays(days);

    // A protocol focus is complete only after the requested block is actually
    // centered. Merely buffering the day is not a presentation commitment.
    programmaticCenteringRef.current = true;
    if (centerReleaseTimeoutRef.current !== null) {
      window.clearTimeout(centerReleaseTimeoutRef.current);
      centerReleaseTimeoutRef.current = null;
    }
    centerTimeoutRef.current = window.setTimeout(() => {
      if (centerGeneration !== centerGenerationRef.current) return;
      const container = continuousContainerRef.current;
      if (!container || !currentDate) {
        programmaticCenteringRef.current = false;
        return;
      }
      const targetKey = currentDate.toDateString();
      const targetEl = Array.from(
        container.querySelectorAll<HTMLElement>('.bases-calendar-continuous-day-block'),
      ).find((element) => element.dataset.date === targetKey);
      if (!targetEl) {
        programmaticCenteringRef.current = false;
        return;
      }

      if (isMobile) {
        targetEl.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'nearest' });
      } else {
        const scrollPos = targetEl.offsetTop
          - (container.clientHeight / 2)
          + (targetEl.offsetHeight / 2);
        container.scrollTop = Math.max(0, scrollPos);
      }

      centerFrameRef.current = window.requestAnimationFrame(() => {
        centerFrameRef.current = window.requestAnimationFrame(() => {
          if (centerGeneration !== centerGenerationRef.current) return;
          if (!targetEl.isConnected || !continuousContainerRef.current) {
            programmaticCenteringRef.current = false;
            return;
          }
          const targetRect = targetEl.getBoundingClientRect();
          const viewportRect = isMobile
            ? { top: 0, bottom: window.innerHeight }
            : continuousContainerRef.current.getBoundingClientRect();
          const viewportMidpoint = (viewportRect.top + viewportRect.bottom) / 2;
          const targetMidpoint = (targetRect.top + targetRect.bottom) / 2;
          const tolerance = Math.max(24, Math.min(120, (viewportRect.bottom - viewportRect.top) * 0.2));
          if (
            targetRect.bottom > viewportRect.top
            && targetRect.top < viewportRect.bottom
            && Math.abs(targetMidpoint - viewportMidpoint) <= tolerance
          ) {
            renderedCommitRef.current?.(new Date(currentDate));
          }
          centerReleaseTimeoutRef.current = window.setTimeout(() => {
            if (centerGeneration === centerGenerationRef.current) {
              programmaticCenteringRef.current = false;
            }
            centerReleaseTimeoutRef.current = null;
          }, 50);
        });
      });
    }, 100);

    return () => {
      programmaticCenteringRef.current = false;
      if (centerTimeoutRef.current !== null) {
        window.clearTimeout(centerTimeoutRef.current);
        centerTimeoutRef.current = null;
      }
      if (centerFrameRef.current !== null) {
        window.cancelAnimationFrame(centerFrameRef.current);
        centerFrameRef.current = null;
      }
      if (centerReleaseTimeoutRef.current !== null) {
        window.clearTimeout(centerReleaseTimeoutRef.current);
        centerReleaseTimeoutRef.current = null;
      }
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
        scrollTimeoutRef.current = null;
      }
    };
  }, [currentDate, isMobile]);

  // Restore scroll position after prepend
  useLayoutEffect(() => {
    if (continuousContainerRef.current && isPrependingRef.current) {
      const el = continuousContainerRef.current;
      const heightDiff = el.scrollHeight - prevScrollHeightRef.current;
      if (heightDiff > 0) {
        el.scrollTop += heightDiff;
      }
      isPrependingRef.current = false;
    }
  }, [continuousDays]);

  const handleContinuousScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    if (programmaticCenteringRef.current) return;
    const interactionStartedAt = performance.now();
    const el = e.currentTarget;
    const threshold = 200;

    if (el.scrollTop < threshold) {
      prevScrollHeightRef.current = el.scrollHeight;
      isPrependingRef.current = true;
      setContinuousDays(prev => {
        const newDay = new Date(prev[0]);
        newDay.setDate(newDay.getDate() - 1);
        const next = [newDay, ...prev];
        if (next.length > 14) next.pop();
        return next;
      });
    }

    if (el.scrollHeight - el.scrollTop - el.clientHeight < threshold) {
      setContinuousDays(prev => {
        const newDay = new Date(prev[prev.length - 1]);
        newDay.setDate(newDay.getDate() + 1);
        const next = [...prev, newDay];
        if (next.length > 14) next.shift();
        return next;
      });
    }

    // Debounce update to parent
    if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
    scrollTimeoutRef.current = setTimeout(() => {
      if (!onDateChange || !continuousContainerRef.current) return;

      // Find the visible day (closest to top + padding)
      const container = continuousContainerRef.current;
      const containerRect = container.getBoundingClientRect();
      const midY = containerRect.top + containerRect.height / 2;

      // Find child closest to midpoint
      let bestDay: Date | null = null;
      let minDist = Number.MAX_VALUE;

      // Children correspond to continuousDays (plus maybe spacers?)
      // The structure is flat divs.
      const children = Array.from(container.children).filter(c => c.classList.contains('bases-calendar-continuous-day-block'));

      children.forEach((child, index) => {
        const rect = child.getBoundingClientRect();
        const dist = Math.abs((rect.top + rect.height / 2) - midY);
        if (dist < minDist) {
          minDist = dist;
          const candidate = continuousDays[index];
          if (candidate) {
            bestDay = candidate;
          }
        }
      });

      if (bestDay && (!currentDate || (bestDay as Date).toDateString() !== currentDate.toDateString())) {
        onDateChange(bestDay as Date, interactionStartedAt);
      }
    }, 300);

  }, [continuousDays, onDateChange, currentDate]);

  useEffect(() => {
    if (!isMobile || !onDateChange) return;
    const container = continuousContainerRef.current;
    if (!container) return;
    const reportVisibleMobileDay = () => {
      if (programmaticCenteringRef.current) return;
      const interactionStartedAt = performance.now();
      if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
      scrollTimeoutRef.current = setTimeout(() => {
        const midpoint = window.innerHeight / 2;
        let bestDay: Date | null = null;
        let bestDistance = Number.POSITIVE_INFINITY;
        const blocks = Array.from(
          container.querySelectorAll<HTMLElement>('.bases-calendar-continuous-day-block'),
        );
        for (let index = 0; index < blocks.length; index += 1) {
          const block = blocks[index];
          const rect = block.getBoundingClientRect();
          if (rect.bottom <= 0 || rect.top >= window.innerHeight) continue;
          const distance = Math.abs((rect.top + rect.bottom) / 2 - midpoint);
          if (distance < bestDistance && continuousDays[index]) {
            bestDistance = distance;
            bestDay = continuousDays[index];
          }
        }
        if (bestDay && (!currentDate || bestDay.toDateString() !== currentDate.toDateString())) {
          onDateChange(new Date(bestDay), interactionStartedAt);
        }
      }, 300);
    };
    window.addEventListener('scroll', reportVisibleMobileDay, { passive: true, capture: true });
    return () => {
      window.removeEventListener('scroll', reportVisibleMobileDay, { capture: true } as EventListenerOptions);
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
        scrollTimeoutRef.current = null;
      }
    };
  }, [continuousDays, currentDate, isMobile, onDateChange]);

  return (
    <div
      ref={continuousContainerRef}
      className="bases-calendar-continuous-scroll-container"
      style={{
        height: isMobile ? 'auto' : '100%',
        overflowY: isMobile ? 'visible' : 'auto',
        overflowX: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        gap: '1px',
        background: 'var(--background-secondary)'
      }}
      onScroll={isMobile ? undefined : handleContinuousScroll}
    >
      {continuousDays.map(day => {
        const isToday = day.toDateString() === new Date().toDateString();
        return (
          <div
            key={day.toISOString()}
            data-date={day.toDateString()}
            className={`bases-calendar-continuous-day-block${isToday ? ' is-today' : ''}`}
            style={{
              minHeight: '800px',
              background: 'var(--background-primary)',
              position: 'relative',
              ...(isToday ? {
                boxShadow: 'inset 0 0 0 1px var(--interactive-accent)',
              } : {})
            }}
          >
            <div style={{
              position: 'sticky',
              top: 0,
              zIndex: 10,
              background: 'var(--background-primary)',
              padding: '8px 16px',
              borderBottom: '1px solid var(--background-modifier-border)',
              fontWeight: 600,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              ...(isToday ? {
                background: 'rgba(var(--interactive-accent-rgb), 0.05)',
                borderBottomColor: 'var(--interactive-accent)',
              } : {})
            }}>
              <span
                onClick={(event) => onDateClick && onDateClick(day, event.currentTarget, event.nativeEvent)}
                style={{ cursor: 'pointer', textDecoration: 'none' }}
                className="fc-col-header-cell-cushion"
              >
                {day.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
              </span>
              {isToday && (
                <span style={{
                  fontSize: '0.8em',
                  color: 'var(--text-accent)',
                  background: 'rgba(var(--interactive-accent-rgb), 0.15)',
                  padding: '3px 8px',
                  borderRadius: '4px',
                  fontWeight: 600,
                  border: '1px solid rgba(var(--interactive-accent-rgb), 0.3)'
                }}>
                  Today
                </span>
              )}
            </div>

          <FullCalendar
            key={`continuous-${day.toISOString()}`}
            plugins={PLUGINS}
            initialView="timeGridDay"
            initialDate={day}
            headerToolbar={false}
            height="auto"
            expandRows={!isMobile}
            slotMinTime={slotMinTimeValue}
            slotMaxTime={slotMaxTimeValue}
            scrollTime={defaultScrollTime}
            allDaySlot={resolvedShowFullDay}
            slotDuration={formatFullCalendarDuration(slotDurationMinutes, 30)}
            snapDuration={formatFullCalendarDuration(snapDurationMinutes, 5)}
            slotLabelInterval="01:00"
            events={events}
            firstDay={safeWeekStartDay}
            editable={allowEdit}
            eventStartEditable={allowEdit}
            eventDurationEditable={allowEdit && !!onEventResize}
            eventMinHeight={eventMinHeight}
            selectable={allowSelect}
            selectMirror={allowSelect}
            selectLongPressDelay={isMobile ? 600 : 300}
            longPressDelay={isMobile ? 600 : 300}
            eventLongPressDelay={isMobile ? 600 : 300}
            eventDragMinDistance={isMobile ? 10 : 5}
            eventClick={handleEventClick}
            eventContent={renderEventContent}
            eventDrop={handleDrop}
            eventResize={handleResize}
            eventDidMount={handleEventMount}
            eventWillUnmount={handleEventWillUnmount}
            eventDragStart={handleDragStart}
            eventDragStop={handleDragStop}
            eventResizeStart={handleResizeStart}
            eventResizeStop={handleResizeStop}
            select={allowSelect ? handleSelect : undefined}
            selectAllow={allowSelect ? handleSelectAllow : undefined}
            unselect={allowSelect ? handleUnselect : undefined}
            nowIndicator={true}
            dayMaxEvents={allDayExpanded ? false : (allDayMaxRows ?? 3)}
            dayMaxEventRows={allDayExpanded ? false : (allDayMaxRows ?? 3)}
            // @ts-ignore
            moreLinkClick={handleMoreLinkClick}
            moreLinkContent={renderMoreLinkContent}
            weekNumbers={false}
            weekends={true}
          />
        </div>
        );
      })}
    </div>
  );
};

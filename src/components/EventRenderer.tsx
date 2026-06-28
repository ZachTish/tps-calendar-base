import React, { useCallback } from "react";
import { BasesEntry, BasesPropertyId, Value, setIcon } from "obsidian";
import { EventContentArg } from "@fullcalendar/core";
import { parsePropertyId } from "obsidian";
import { tryGetValue } from "../hooks/useCalendarEvents";

interface UseEventRendererOptions {
  app: any;
  sanitizedProperties: BasesPropertyId[];
  basesEntryMap: Map<string, BasesEntry>;
}

/**
 * Provides the renderEventContent callback for FullCalendar.
 */
export function useEventRenderer({
  app,
  sanitizedProperties,
  basesEntryMap,
}: UseEventRendererOptions) {
  const hasNonEmptyValue = useCallback((value: Value): boolean => {
    if (value === null || value === undefined) return false;
    if (typeof (value as any).isTruthy === 'function') {
      return (value as any).isTruthy();
    }
    const str = String(value);
    return !!str && str.trim().length > 0;
  }, []);

  const renderEventContent = useCallback(
    (eventInfo: EventContentArg) => {
      const props = eventInfo.event.extendedProps;
      const title = eventInfo.event.title || props.calEntryTitle || 'Untitled';
      const entryPath = props.entryPath;
      const entry = (props.entry as BasesEntry | undefined) || (entryPath ? basesEntryMap.get(entryPath) : undefined);
      const isGhost = props.isGhost || false;
      const isExternal = props.isExternal || false;
      const isExternalDropPreview = !!props.isExternalDropPreview;
      const dropPreviewTimeLabel = isExternalDropPreview
        ? String(props.dropPreviewTimeLabel || "").trim()
        : "";
      const isArchivedExternalPlaceholder = props.isArchivedExternalPlaceholder || false;
      const archivedExternalCount = Number(props.archivedExternalCount || 0);
      const archivedExternalTooltip = String(props.archivedExternalTooltip || title).trim();
      const inlineTask = ((props.calendarEntry as any)?.entry as any)?.inlineTask;
      const inlineTaskIconName = inlineTask
        ? getCheckboxStateIconName(String(inlineTask.checkboxState ?? (inlineTask.completed ? "[x]" : "[ ]")))
        : "";
      const iconName = inlineTaskIconName || (typeof props.iconName === "string" ? props.iconName.trim() : "");
      const iconColor = inlineTask ? "" : typeof props.iconColor === "string" ? props.iconColor.trim() : "";
      const isAuxiliaryDate = !!props.isAuxiliaryDate;
      const auxiliaryDateTooltip = String(props.auxiliaryDateTooltip || title).trim();
      const auxiliaryDateCount = Number(props.auxiliaryDateCount || 0);

      if (isAuxiliaryDate) {
        return (
          <div
            className="bases-calendar-aux-date-content tps-calendar-entry"
            data-path={entryPath}
            aria-label={auxiliaryDateTooltip}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: "auto",
              minWidth: "16px",
              height: "16px",
              minHeight: "16px",
              padding: 0,
              margin: 0,
              overflow: "visible",
              color: "var(--text-muted)",
              opacity: 0.74,
              gap: "2px",
              fontSize: "11px",
              lineHeight: "16px",
              whiteSpace: "nowrap",
            }}
          >
            <EventIcon iconName="file-text" />
            {auxiliaryDateCount > 1 && (
              <span className="bases-calendar-aux-date-count">
                ({auxiliaryDateCount})
              </span>
            )}
          </div>
        );
      }

      if (isArchivedExternalPlaceholder) {
        return (
          <div
            className="bases-calendar-archived-external-content tps-calendar-entry"
            data-path={entryPath}
            data-archived-external="true"
            title={archivedExternalCount > 1 ? archivedExternalTooltip : `Restore archived event: ${title}`}
            aria-label={archivedExternalCount > 1 ? archivedExternalTooltip : `Restore archived event: ${title}`}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "2px",
              width: "100%",
              height: "100%",
              minHeight: "18px",
              color: "var(--text-warning, var(--text-accent))",
              fontSize: "11px",
              lineHeight: "16px",
              whiteSpace: "nowrap",
            }}
          >
            <EventIcon iconName="triangle-alert" />
            {archivedExternalCount > 1 && (
              <span
                className="bases-calendar-archived-external-count"
                style={{
                  color: "currentColor",
                  fontSize: "10px",
                  fontWeight: 700,
                  lineHeight: "14px",
                  opacity: 0.9,
                }}
              >
                {archivedExternalCount}
              </span>
            )}
          </div>
        );
      }

      const propertyChips: React.ReactElement[] = [];
      if (entry && sanitizedProperties && sanitizedProperties.length > 0) {
        for (const prop of sanitizedProperties) {
          if (isTitleProperty(prop)) continue;
          try {
            const value = tryGetValue(entry, prop);
            if (hasNonEmptyValue(value as Value)) {
              propertyChips.push(
                <PropertyValue
                  key={prop}
                  value={value as Value}
                  app={app}
                />
              );
            }
          } catch (err) {
            // skip
          }
        }
      } else if (eventInfo.event.extendedProps?.isExternal && sanitizedProperties?.length) {
        const external = eventInfo.event.extendedProps?.externalEvent as any;
        for (const prop of sanitizedProperties) {
          const parsed = parsePropertyId(prop);
          const name = String(parsed.name || (parsed as any).property || prop).toLowerCase();
          const externalValue =
            name === "location" ? external?.location :
              name === "organizer" ? external?.organizer :
                name === "url" ? external?.url :
                  name === "description" ? external?.description :
                    name === "allday" ? String(!!external?.isAllDay) :
                      null;
          if (externalValue) {
            propertyChips.push(
              <span key={prop} className="bases-calendar-event-property-value">{String(externalValue)}</span>
            );
          }
        }
      }

      if (eventInfo.event.allDay) {
        return (
          <div
            className="bases-calendar-event-content bases-calendar-event-content--allday tps-calendar-entry"
            data-path={entryPath}
            style={{
              overflow: 'hidden',
              display: 'flex',
              alignItems: 'center',
              height: '18px',
              minHeight: '18px',
              maxHeight: '18px',
              width: '100%',
              padding: 0,
              margin: 0,
              lineHeight: '14px',
              fontSize: '0.65rem'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 2, width: '100%' }}>
              <LeadingEventIcon
                isGhost={isGhost}
                isExternal={isExternal}
                iconName={iconName}
                iconColor={iconColor}
              />
              <div
                className="bases-calendar-event-title"
                style={{
                  fontWeight: 'var(--tps-event-title-weight, 400)',
                  fontSize: 'var(--tps-event-title-font-size, var(--tps-event-font-size, var(--font-ui-small)))',
                  lineHeight: 'var(--tps-event-title-line-height, 1.2)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  textShadow: 'var(--tps-event-title-shadow, none)',
                  flex: 1,
                  minWidth: 0,
                }}
                title={title}
              >
                {title}
              </div>
            </div>
          </div>
        );
      }

      return (
        <div
          className="bases-calendar-event-content tps-calendar-entry"
          data-path={entryPath}
          style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column', height: '100%', alignItems: 'stretch', justifyContent: 'flex-start' }}
        >
          {dropPreviewTimeLabel && (
            <div
              className="bases-calendar-external-drop-preview-time"
              style={{
                color: 'currentColor',
                fontSize: '0.72em',
                fontWeight: 700,
                lineHeight: '1.05',
                opacity: 0.95,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                marginBottom: 1,
              }}
            >
              {dropPreviewTimeLabel}
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 2, width: '100%', minHeight: 0 }}>
            <LeadingEventIcon
              isGhost={isGhost}
              isExternal={isExternal}
              iconName={iconName}
              iconColor={iconColor}
            />
            <div
              className="bases-calendar-event-title"
              style={{
                fontWeight: 'var(--tps-event-title-weight, 400)',
                fontSize: 'var(--tps-event-title-font-size, var(--tps-event-font-size, var(--font-ui-small)))',
                lineHeight: 'var(--tps-event-title-line-height, 1.2)',
                textShadow: 'var(--tps-event-title-shadow, none)',
                flex: 1,
                minWidth: 0,
                whiteSpace: 'normal',
                overflow: 'hidden',
                overflowWrap: 'break-word',
              }}
              title={title}
            >
              {title}
            </div>
          </div>
          {propertyChips.length > 0 && (
            <div className="bases-calendar-event-properties" style={{ flex: '1 1 0', minHeight: 0, overflow: 'hidden' }}>
              {propertyChips}
            </div>
          )}
        </div>
      );
    },
    [app, sanitizedProperties, hasNonEmptyValue, basesEntryMap],
  );

  return { renderEventContent };
}

function isTitleProperty(prop: BasesPropertyId): boolean {
  try {
    const parsed = parsePropertyId(prop);
    const name = String(parsed.name || (parsed as any).property || prop);
    const normalized = name.replace(/^note\./i, "").toLowerCase().replace(/[\s_.-]+/g, "");
    return normalized === "title";
  } catch {
    const normalized = String(prop).replace(/^note\./i, "").toLowerCase().replace(/[\s_.-]+/g, "");
    return normalized === "title";
  }
}

function getCheckboxStateIconName(rawState: string): string {
  const raw = String(rawState ?? "").trim();
  const state = raw.startsWith("[") && raw.endsWith("]") ? raw : `[${raw}]`;
  const marker = state.slice(1, -1).trim().toLowerCase();
  if (!marker) return "square";
  if (marker === "x") return "square-check-big";
  if (marker === "/" || marker === "\\" || marker === ">") return "square-play";
  if (marker === "?" || marker === "!") return "square-help";
  if (marker === "-" || marker === "~") return "square-minus";
  return "square-dot";
}

const LeadingEventIcon: React.FC<{
  isGhost: boolean;
  isExternal: boolean;
  iconName: string;
  iconColor?: string;
}> = ({ isGhost, isExternal, iconName, iconColor }) => {
  const resolvedIconName = isGhost
    ? "repeat-2"
    : iconName || (isExternal ? "calendar-days" : "calendar");

  return <EventIcon iconName={resolvedIconName} color={iconColor} />;
};

const EventIcon: React.FC<{ iconName: string; color?: string }> = ({ iconName, color }) => {
  const iconRef = useCallback((node: HTMLSpanElement | null) => {
    if (!node) return;
    node.empty();
    const normalizedIcon = String(iconName || "").replace(/^(lucide|icon):/i, "").trim() || "file-text";
    try {
      setIcon(node, normalizedIcon);
      if (!node.querySelector("svg")) renderFallbackIcon(node, normalizedIcon);
    } catch {
      renderFallbackIcon(node, normalizedIcon);
    }
  }, [iconName]);

  return (
    <span
      ref={iconRef}
      className="bases-calendar-event-frontmatter-icon"
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: "12px",
        height: "12px",
        flexShrink: 0,
        marginRight: 0,
        color: color || "currentColor",
        opacity: 0.95,
      }}
    />
  );
};

const FALLBACK_ICON_PATHS: Record<string, string[]> = {
  square: ["M5 5h14v14H5z"],
  "square-check-big": ["M5 5h14v14H5z", "M9 12l2 2 4-5"],
  "square-minus": ["M5 5h14v14H5z", "M9 12h6"],
  "square-play": ["M5 5h14v14H5z", "M10 8l6 4-6 4z"],
  "square-help": ["M5 5h14v14H5z", "M9.5 9a2.5 2.5 0 0 1 5 0c0 2-2.5 2-2.5 4", "M12 17h.01"],
  "square-dot": ["M5 5h14v14H5z", "M12 12h.01"],
};

function renderFallbackIcon(node: HTMLElement, iconName: string): void {
  const paths = FALLBACK_ICON_PATHS[iconName];
  if (!paths) {
    node.textContent = getFallbackIconText(iconName);
    return;
  }
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  for (const d of paths) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", d);
    svg.appendChild(path);
  }
  node.appendChild(svg);
}

function getFallbackIconText(iconName: string): string {
  const normalized = String(iconName || "").toLowerCase().replace(/[\s_]+/g, "-");
  if (normalized.includes("alert") || normalized.includes("warning")) return "!";
  if (normalized.includes("calendar")) return "□";
  if (normalized.includes("file")) return "□";
  return "•";
}

const PropertyValue: React.FC<{ value: Value; app: any }> = ({ value, app }) => {
  const elementRef = useCallback(
    (node: HTMLElement | null) => {
      if (!node) return;
      node.textContent = ''; // Clear previous content

      if (value === null || value === undefined) return;

      // Handle objects with renderTo (e.g., complex Obsidian widgets)
      if (typeof (value as any).renderTo === 'function' && app?.renderContext) {
        (value as any).renderTo(node, app.renderContext);
      } else {
        // Fallback for primitives or objects without renderTo
        node.textContent = String(value);
      }
    },
    [app, value],
  );

  return <span ref={elementRef} className="bases-calendar-event-property-value" style={{ display: 'inline-flex', alignItems: 'center' }} />;
};

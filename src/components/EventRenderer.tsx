import { useCallback } from "react";
import { BasesEntry, BasesPropertyId, Value, parsePropertyId, setIcon } from "obsidian";
import { EventContentArg } from "@fullcalendar/core";
import { tryGetValue } from "../hooks/useCalendarEvents";

interface UseEventRendererOptions {
  app: any;
  sanitizedProperties: BasesPropertyId[];
  basesEntryMap: Map<string, BasesEntry>;
}

/** FullCalendar owns event DOM, so content is ready in its own layout pass.
 * React portals otherwise mount the same cards in a later commit and ask
 * FullCalendar to measure all of their geometry again.
 */
export function useEventRenderer({ app, sanitizedProperties, basesEntryMap }: UseEventRendererOptions) {
  const renderEventContent = useCallback((eventInfo: EventContentArg): { domNodes: HTMLElement[] } => {
    const props = eventInfo.event.extendedProps;
    const title = eventInfo.event.title || props.calEntryTitle || "Untitled";
    const entryPath = props.entryPath;
    const entry = (props.entry as BasesEntry | undefined) || (entryPath ? basesEntryMap.get(entryPath) : undefined);
    const inlineTask = ((props.calendarEntry as any)?.entry as any)?.inlineTask;
    const iconName = typeof props.iconName === "string" ? props.iconName.trim() : "";
    const iconColor = inlineTask ? "" : typeof props.iconColor === "string" ? props.iconColor.trim() : "";
    const node = document.createElement("div");
    if (entryPath != null) node.dataset.path = entryPath;

    if (props.isArchivedExternalPlaceholder) {
      const count = Number(props.archivedExternalCount || 0);
      const tooltip = String(props.archivedExternalTooltip || title).trim();
      node.className = "bases-calendar-archived-external-content tps-calendar-entry";
      node.dataset.archivedExternal = "true";
      node.title = count > 1 ? tooltip : `Restore archived event: ${title}`;
      node.setAttribute("aria-label", node.title);
      Object.assign(node.style, { display: "flex", alignItems: "center", justifyContent: "center", gap: "2px", width: "100%", height: "100%", minHeight: "18px", color: "var(--text-warning, var(--text-accent))", fontSize: "11px", lineHeight: "16px", whiteSpace: "nowrap" });
      node.appendChild(createEventIcon("triangle-alert"));
      if (count > 1) {
        const badge = document.createElement("span");
        badge.className = "bases-calendar-archived-external-count";
        badge.textContent = String(count);
        Object.assign(badge.style, { color: "currentColor", fontSize: "10px", fontWeight: "700", lineHeight: "14px", opacity: "0.9" });
        node.appendChild(badge);
      }
      return { domNodes: [node] };
    }

    const allDay = eventInfo.event.allDay;
    node.className = `bases-calendar-event-content${allDay ? " bases-calendar-event-content--allday" : ""} tps-calendar-entry`;
    Object.assign(node.style, allDay
      ? { overflow: "hidden", display: "flex", alignItems: "center", height: "18px", minHeight: "18px", maxHeight: "18px", width: "100%", padding: "0", margin: "0", lineHeight: "14px", fontSize: "0.65rem" }
      : { overflow: "hidden", display: "flex", flexDirection: "column", height: "100%", alignItems: "stretch", justifyContent: "flex-start" });
    const preview = props.isExternalDropPreview ? String(props.dropPreviewTimeLabel || "").trim() : "";
    if (!allDay && preview) {
      const label = document.createElement("div");
      label.className = "bases-calendar-external-drop-preview-time";
      label.textContent = preview;
      Object.assign(label.style, { color: "currentColor", fontSize: "0.72em", fontWeight: "700", lineHeight: "1.05", opacity: "0.95", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginBottom: "1px" });
      node.appendChild(label);
    }
    const heading = document.createElement("div");
    Object.assign(heading.style, { display: "flex", alignItems: allDay ? "center" : "flex-start", gap: "2px", width: "100%", minHeight: "0" });
    heading.appendChild(createEventIcon(props.isGhost ? "repeat-2" : iconName || (props.isExternal ? "calendar-days" : "calendar"), iconColor));
    const titleEl = document.createElement("div");
    titleEl.className = "bases-calendar-event-title";
    titleEl.title = title;
    titleEl.textContent = title;
    Object.assign(titleEl.style, { fontWeight: "var(--tps-event-title-weight, 400)", fontSize: "var(--tps-event-title-font-size, var(--tps-event-font-size, var(--font-ui-small)))", lineHeight: "var(--tps-event-title-line-height, 1.2)", textShadow: "var(--tps-event-title-shadow, none)", flex: "1", minWidth: "0", whiteSpace: allDay ? "nowrap" : "normal", overflow: "hidden", overflowWrap: "break-word", textOverflow: allDay ? "ellipsis" : "clip" });
    heading.appendChild(titleEl);
    node.appendChild(heading);

    // All-day cards have never displayed property chips. Do not evaluate
    // formulas or construct widgets that will immediately be discarded.
    if (!allDay && sanitizedProperties?.length) {
      const chips = document.createElement("div");
      chips.className = "bases-calendar-event-properties";
      Object.assign(chips.style, { flex: "1 1 0", minHeight: "0", overflow: "hidden" });
      for (const prop of sanitizedProperties) {
        if (isTitleProperty(prop)) continue;
        try {
          let value: unknown;
          if (entry) value = tryGetValue(entry, prop);
          else if (props.isExternal) {
            const parsed = parsePropertyId(prop);
            const name = String(parsed.name || (parsed as any).property || prop).toLowerCase();
            const external = props.externalEvent;
            value = name === "allday" ? String(!!external?.isAllDay) : ["location", "organizer", "url", "description"].includes(name) ? external?.[name] : null;
          }
          if (value == null || (typeof (value as any).isTruthy === "function" ? !(value as any).isTruthy() : !String(value).trim())) continue;
          const chip = document.createElement("span");
          chip.className = "bases-calendar-event-property-value";
          Object.assign(chip.style, { display: "inline-flex", alignItems: "center" });
          if (typeof (value as Value).renderTo === "function" && app?.renderContext) (value as Value).renderTo(chip, app.renderContext);
          else chip.textContent = String(value);
          chips.appendChild(chip);
        } catch { /* A single unsupported value must not hide the event. */ }
      }
      if (chips.childNodes.length) node.appendChild(chips);
    }
    return { domNodes: [node] };
  }, [app, sanitizedProperties, basesEntryMap]);
  return { renderEventContent };
}

function isTitleProperty(prop: BasesPropertyId): boolean {
  try {
    const parsed = parsePropertyId(prop);
    return String(parsed.name || (parsed as any).property || prop).replace(/^note\./i, "").toLowerCase().replace(/[\s_.-]+/g, "") === "title";
  } catch {
    return String(prop).replace(/^note\./i, "").toLowerCase().replace(/[\s_.-]+/g, "") === "title";
  }
}

function createEventIcon(iconName: string, color?: string): HTMLElement {
  const node = document.createElement("span");
  node.className = "bases-calendar-event-frontmatter-icon";
  Object.assign(node.style, { display: "inline-flex", alignItems: "center", justifyContent: "center", width: "12px", height: "12px", flexShrink: "0", marginRight: "0", color: color || "currentColor", opacity: "0.95" });
  const normalized = String(iconName || "").replace(/^(lucide|icon):/i, "").trim() || "file-text";
  try { setIcon(node, normalized); if (!node.querySelector("svg")) renderFallbackIcon(node, normalized); }
  catch { renderFallbackIcon(node, normalized); }
  return node;
}

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

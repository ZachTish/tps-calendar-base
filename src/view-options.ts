import { ViewOption } from "obsidian";
import { CalendarPluginBridge } from "./plugin-interface";
import { DEFAULT_CONDENSE_LEVEL } from "./utils";

export const FOLLOW_ACTIVE_NOTE_DAY_CONFIG_KEY = "followActiveNoteDay";
export const LEGACY_CONTEXT_DATE_CONFIG_KEY = "contextDateEnabled";

export function getCalendarViewOptions(plugin?: CalendarPluginBridge): ViewOption[] {
  const externalCalendarItems = getExternalCalendarViewOptions(plugin);
  const externalCalendarsGroup: ViewOption | null = externalCalendarItems.length
    ? {
      displayName: "External calendars",
      type: "group",
      items: externalCalendarItems as any,
    }
    : null;

  const options: ViewOption[] = [
    {
      displayName: "Properties",
      type: "group",
      items: [
        {
          displayName: "Start date",
          type: "property",
          key: "startDate",
          placeholder: "note.scheduled",
        },
        {
          displayName: "Duration (minutes, optional)",
          type: "text",
          key: "primaryDurationMinutes",
          placeholder: "Blank = minimum time",
        },
        {
          displayName: "Use duration for end date",
          type: "dropdown",
          key: "useEndDuration",
          default: "true",
          options: {
            false: "No (Use End DateTime)",
            true: "Yes (Use Duration)",
          },
        },
        {
          displayName: "End property",
          type: "property",
          key: "endDate",
          placeholder: "note.timeEstimate or note.due",
        },
        {
          displayName: "Title",
          type: "property",
          key: "titleProperty",
          placeholder: "note.title",
        },
        {
          displayName: "Priority field",
          type: "property",
          key: "priorityField",
          default: "priority",
          placeholder: "priority",
        },
        {
          displayName: "Status",
          type: "property",
          key: "statusField",
          placeholder: "note.status",
        },
        {
          displayName: "All-day",
          type: "property",
          key: "allDayProperty",
          placeholder: "note.allDay",
        },
      ],
    },
    {
      displayName: "Display",
      type: "group",
      items: [
        {
          displayName: "View mode",
          type: "dropdown",
          key: "tps_viewMode",
          default: plugin?.settings?.viewMode || "week",
          options: {
            day: "Day",
            "3d": "3 Day",
            "4d": "4 Day",
            "5d": "5 Day",
            "7d": "7 Day",
            week: "Week",
            month: "Month",
            continuous: "Continuous",
            "filter-based": "Filter-based (Auto)",
          },
        },
        {
          displayName: "Start on host note day",
          type: "dropdown",
          key: FOLLOW_ACTIVE_NOTE_DAY_CONFIG_KEY,
          default: plugin?.settings?.contextDateEnabled ? "true" : "false",
          options: {
            true: "Use host note date",
            false: "Use saved calendar date",
          },
        },
        {
          displayName: "Zoom Level",
          type: "slider",
          key: "condenseLevel",
          default: DEFAULT_CONDENSE_LEVEL,
          min: 0,
          max: 220,
          step: 10,
        },
        {
          displayName: "Embedded height (px)",
          type: "text",
          key: "embeddedHeight",
          default: "520",
          placeholder: "520",
        },
        {
          displayName: "Show full day slot",
          type: "dropdown",
          key: "showFullDay",
          default: "true",
          options: {
            true: "Show",
            false: "Hide",
          },
        },
        {
          displayName: "Note events",
          type: "dropdown",
          key: "noteEventVisibility",
          default: "all",
          options: {
            all: "Show all",
            "hide-daily-notes": "Hide daily notes",
            none: "Hide all notes",
          },
        },
        {
          displayName: "Time format",
          type: "dropdown",
          key: "timeFormat",
          default: plugin?.settings?.timeFormat || "12h",
          options: {
            "12h": "12-hour",
            "24h": "24-hour",
          },
        },
        {
          displayName: "Slot duration",
          type: "dropdown",
          key: "slotDuration",
          default: String(plugin?.settings?.slotDuration || 30),
          options: {
            "15": "15 minutes",
            "30": "30 minutes",
            "60": "60 minutes",
          },
        },
        {
          displayName: "Event text size",
          type: "dropdown",
          key: "eventFontSize",
          default: plugin?.settings?.eventFontSize || "default",
          options: {
            small: "Small",
            default: "Default",
            large: "Large",
          },
        },
        {
          displayName: "Completed event opacity",
          type: "slider",
          key: "pastEventOpacity",
          default: plugin?.settings?.pastEventOpacity ?? 50,
          min: 0,
          max: 100,
          step: 5,
        },
        {
          displayName: "Minimum event height",
          type: "text",
          key: "minEventHeight",
          default: String(plugin?.settings?.minEventHeight || 20),
          placeholder: "20",
        },
        {
          displayName: "Show now indicator",
          type: "dropdown",
          key: "showNowIndicator",
          default: plugin?.settings?.showNowIndicator === false ? "false" : "true",
          options: {
            true: "Show",
            false: "Hide",
          },
        },
      ],
    },
  ];

  if (externalCalendarsGroup) {
    options.splice(3, 0, externalCalendarsGroup);
  }

  return options;
}

function getExternalCalendarViewOptions(plugin?: CalendarPluginBridge): any[] {
  const calendars = plugin?.getEffectiveExternalCalendars() ?? [];
  const enabledCalendars = calendars.filter(
    (calendar: any) => calendar?.url && calendar.enabled !== false,
  );

  return enabledCalendars.map((calendar: any) => {
    const label = formatExternalCalendarLabel(calendar.url, calendar.id);
    return {
      displayName: label,
      type: "dropdown",
      key: `externalCalendar:${calendar.id}`,
      default: "true",
      options: {
        true: "Show",
        false: "Hide",
      },
    };
  });
}

function formatExternalCalendarLabel(url: string, fallback: string): string {
  if (!url) return fallback || "External calendar";
  try {
    const parsed = new URL(url);
    return parsed.hostname ? `${parsed.hostname}${parsed.pathname || ""}` : url;
  } catch {
    return url;
  }
}

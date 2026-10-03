import type { NewEventCreationOptions } from "../services/new-event-service";

export type CalendarCreationDefaults = {
  folderPath: string | null;
  frontmatter: Record<string, any>;
};

export type CalendarCreateOptionOverrides = Pick<
  NewEventCreationOptions,
  "allDay" | "typeFolderOverride" | "templateOverride" | "templateTypeOverride" | "titleOverride" | "taskAssociatedNotePath"
>;

export function buildCalendarNewEventOptions(args: {
  creationDefaults: CalendarCreationDefaults;
  overrides?: CalendarCreateOptionOverrides;
}): NewEventCreationOptions & { createMode: "note" } {
  const {
    allDay,
    typeFolderOverride,
    templateOverride,
    templateTypeOverride,
    titleOverride,
    taskAssociatedNotePath,
  } = args.overrides || {};
  return {
    allDay,
    templateOverride,
    templateTypeOverride,
    titleOverride,
    taskAssociatedNotePath,
    createMode: "note",
    useBaseDefaults: true,
    frontmatterDefaults: args.creationDefaults.frontmatter,
    typeFolderOverride: typeFolderOverride !== undefined ? typeFolderOverride : args.creationDefaults.folderPath,
  };
}

export type CalendarDropCreateKind = "template-file" | "unscheduled-note";

export type CalendarDropCreateRequest = {
  start: Date;
  end: Date;
  options: NewEventCreationOptions & { createMode: "note" };
};

export function buildCalendarDropCreateRequest(args: {
  kind: CalendarDropCreateKind;
  start: Date;
  allDay: boolean;
  defaultEventDurationMinutes: number;
  droppedFilePath: string;
  droppedFileTitle?: string | null;
  creationDefaults: CalendarCreationDefaults;
}): CalendarDropCreateRequest {
  const end = args.allDay
    ? new Date(args.start.getTime() + 24 * 60 * 60 * 1000)
    : new Date(args.start.getTime() + Math.max(0, args.defaultEventDurationMinutes || 0) * 60 * 1000);
  const overrides: CalendarCreateOptionOverrides = args.kind === "template-file"
    ? {
      allDay: args.allDay,
      templateOverride: args.droppedFilePath,
      templateTypeOverride: "file",
    }
    : {
      allDay: args.allDay,
      titleOverride: args.droppedFileTitle || undefined,
      taskAssociatedNotePath: args.droppedFilePath,
    };

  return {
    start: args.start,
    end,
    options: buildCalendarNewEventOptions({
      creationDefaults: args.creationDefaults,
      overrides,
    }),
  };
}

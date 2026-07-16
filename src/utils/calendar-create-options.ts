import type { NewEventCreationOptions } from "../services/new-event-service";
import {
  extractCalendarCreationModeFromFilters,
  type CalendarTaskLineDefaults,
} from "./filter-creation-defaults";

export type CalendarCreationDefaults = {
  folderPath: string | null;
  frontmatter: Record<string, any>;
};

export type CalendarCreateOptionOverrides = Omit<
  NewEventCreationOptions,
  "createMode" | "useBaseDefaults" | "frontmatterDefaults" | "taskTags" | "taskStatus" | "taskTargetPath"
>;

export function buildCalendarNewEventOptions(args: {
  filters: unknown[];
  initialCreateMode?: "note" | "task" | null;
  creationDefaults: CalendarCreationDefaults;
  taskDefaults: CalendarTaskLineDefaults;
  overrides?: CalendarCreateOptionOverrides;
}): NewEventCreationOptions & { createMode: "note" | "task" } {
  const createMode = extractCalendarCreationModeFromFilters(args.filters) ?? args.initialCreateMode ?? "note";
  return {
    createMode,
    useBaseDefaults: true,
    frontmatterDefaults: args.creationDefaults.frontmatter,
    taskTags: args.taskDefaults.tags,
    taskStatus: args.taskDefaults.status,
    taskTargetPath: args.taskDefaults.targetPath,
    typeFolderOverride: args.creationDefaults.folderPath,
    ...(args.overrides || {}),
  };
}

export type CalendarDropCreateKind = "template-file" | "unscheduled-note";

export type CalendarDropCreateRequest = {
  start: Date;
  end: Date;
  options: NewEventCreationOptions & { createMode: "note" | "task" };
};

export function buildCalendarDropCreateRequest(args: {
  kind: CalendarDropCreateKind;
  start: Date;
  allDay: boolean;
  defaultEventDurationMinutes: number;
  droppedFilePath: string;
  droppedFileTitle?: string | null;
  filters: unknown[];
  initialCreateMode?: "note" | "task" | null;
  creationDefaults: CalendarCreationDefaults;
  taskDefaults: CalendarTaskLineDefaults;
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
      filters: args.filters,
      initialCreateMode: args.initialCreateMode,
      creationDefaults: args.creationDefaults,
      taskDefaults: args.taskDefaults,
      overrides,
    }),
  };
}

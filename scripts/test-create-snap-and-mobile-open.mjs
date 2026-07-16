import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Buffer } from "node:buffer";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const reactViewSource = readFileSync(new URL("../src/CalendarReactView.tsx", import.meta.url), "utf8");
const calendarViewSource = readFileSync(new URL("../src/calendar-view.tsx", import.meta.url), "utf8");
const eventRendererSource = readFileSync(new URL("../src/components/EventRenderer.tsx", import.meta.url), "utf8");
const migrationSource = readFileSync(new URL("../src/settings-migration.ts", import.meta.url), "utf8");
const continuousSource = readFileSync(new URL("../src/components/ContinuousScrollView.tsx", import.meta.url), "utf8");
const calendarEventsHookSource = readFileSync(new URL("../src/hooks/useCalendarEvents.ts", import.meta.url), "utf8");
const zoomHookSource = readFileSync(new URL("../src/hooks/useCalendarZoom.ts", import.meta.url), "utf8");
const settingsTabSource = readFileSync(new URL("../src/settings-tab.ts", import.meta.url), "utf8");
const newEventServiceSource = readFileSync(new URL("../src/services/new-event-service.ts", import.meta.url), "utf8");
const taskAssociatedNoteSource = readFileSync(new URL("../src/utils/task-associated-note.ts", import.meta.url), "utf8");
const inlineTaskLineUpdateSource = readFileSync(new URL("../src/utils/inline-task-line-update.ts", import.meta.url), "utf8");
const taskTargetPathSource = readFileSync(new URL("../src/utils/task-target-path.ts", import.meta.url), "utf8");
const viewOptionsSource = readFileSync(new URL("../src/view-options.ts", import.meta.url), "utf8");
const utilsSource = readFileSync(new URL("../src/utils.ts", import.meta.url), "utf8");
const calendarDayCountSource = readFileSync(new URL("../src/utils/calendar-day-count.ts", import.meta.url), "utf8");
const calendarCss = readFileSync(new URL("../src/calendar.css", import.meta.url), "utf8");
const embedCalendarCss = readFileSync(new URL("../src/embed-calendar.css", import.meta.url), "utf8");

async function importFrontmatterInsertUtility() {
  const build = await esbuild.build({
    entryPoints: [fileURLToPath(new URL("../src/utils/frontmatter-insert.ts", import.meta.url))],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
  });
  const bundled = build.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(bundled).toString("base64")}`);
}

async function importTaskAssociatedNoteUtility() {
  const build = await esbuild.build({
    entryPoints: [fileURLToPath(new URL("../src/utils/task-associated-note.ts", import.meta.url))],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
  });
  const bundled = build.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(bundled).toString("base64")}`);
}

async function importInlineTaskLineUpdateUtility() {
  const build = await esbuild.build({
    entryPoints: [fileURLToPath(new URL("../src/utils/inline-task-line-update.ts", import.meta.url))],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
  });
  const bundled = build.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(bundled).toString("base64")}`);
}

async function importTaskTargetPathUtility() {
  const build = await esbuild.build({
    entryPoints: [fileURLToPath(new URL("../src/utils/task-target-path.ts", import.meta.url))],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
  });
  const bundled = build.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(bundled).toString("base64")}`);
}

async function importFilterCreationDefaultsUtility() {
  const build = await esbuild.build({
    entryPoints: [fileURLToPath(new URL("../src/utils/filter-creation-defaults.ts", import.meta.url))],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
  });
  const bundled = build.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(bundled).toString("base64")}`);
}

async function importCalendarCreateOptionsUtility() {
  const build = await esbuild.build({
    entryPoints: [fileURLToPath(new URL("../src/utils/calendar-create-options.ts", import.meta.url))],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
    plugins: [
      {
        name: "obsidian-stub",
        setup(build) {
          build.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian-stub", namespace: "stub" }));
          build.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
            loader: "js",
            contents: `
              export function normalizePath(value) {
                return String(value || "")
                  .replace(/\\\\/g, "/")
                  .replace(/\\/{2,}/g, "/")
                  .replace(/^\\.\\//, "")
                  .replace(/\\/\\.\\//g, "/")
                  .replace(/\\/$/, "");
              }
              export function parsePropertyId(value) {
                const raw = String(value || "");
                const match = raw.match(/^(note|file|task)\\.(.+)$/i);
                if (match) return { type: match[1].toLowerCase(), name: match[2], property: match[2] };
                return { type: "note", name: raw, property: raw };
              }
            `,
          }));
        },
      },
    ],
  });
  const bundled = build.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(bundled).toString("base64")}`);
}

async function importCalendarExternalDropUtility() {
  const build = await esbuild.build({
    entryPoints: [fileURLToPath(new URL("../src/utils/calendar-external-drop.ts", import.meta.url))],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
  });
  const bundled = build.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(bundled).toString("base64")}`);
}

async function importCalendarDayCountUtility() {
  const build = await esbuild.build({
    entryPoints: [fileURLToPath(new URL("../src/utils/calendar-day-count.ts", import.meta.url))],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
  });
  const bundled = build.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(bundled).toString("base64")}`);
}

function dataTransferFrom(values, files = []) {
  return {
    getData(type) {
      return values[type] || "";
    },
    files,
  };
}

test("drag-create selections snap to separate configured gates before creation", () => {
  assert.match(migrationSource, /snapCreateSelections: true/);
  assert.match(migrationSource, /createSnapDuration: 15/);
  assert.match(reactViewSource, /const normalizeCreateSelectionRange = \(/);
  assert.match(reactViewSource, /snapDateToMinuteGate\(start, interval, "floor"\)/);
  assert.match(reactViewSource, /snapDateToMinuteGate\(end, interval, "ceil"\)/);
  assert.match(reactViewSource, /await onCreateSelection\(start, end, allDay\)/);
  assert.match(calendarViewSource, /snapCreateSelections=\{this\.plugin\.settings\.snapCreateSelections !== false\}/);
  assert.match(calendarViewSource, /createSnapDurationMinutes=\{this\.plugin\.settings\.createSnapDuration \|\| 15\}/);
});

test("creation callsites pass resolved create mode and explicit task target overrides", () => {
  assert.match(calendarViewSource, /private resolveEffectiveCreateMode\(filters: unknown\[\]\): "note" \| "task"/);
  assert.match(calendarViewSource, /return this\.extractCreationModeFromFilters\(filters\) \?\? this\.plugin\.settings\.initialCreateMode \?\? "note";/);
  assert.match(calendarViewSource, /from "\.\/utils\/calendar-create-options"/);
  assert.match(calendarViewSource, /private buildCalendarNewEventOptions\(/);
  assert.match(calendarViewSource, /const filteredFolder = normalizePath\(String\(createOptions\.typeFolderOverride \|\| ""\)\)/);
  assert.match(calendarViewSource, /frontmatter\[endField\] = this\.useEndDuration[\s\S]*Math\.max\(1, Math\.round\(\(nowRange\.end\.getTime\(\) - nowRange\.start\.getTime\(\)\) \/ 60000\)\)[\s\S]*formatDateTimeForFrontmatter\(nowRange\.end\)/);
  assert.match(calendarViewSource, /if \(filteredFolder\) await this\.ensureCalendarCreationFolder\(filteredFolder\)/);
  assert.match(calendarViewSource, /const resolvedBaseFileName = baseFileName \|\| \(filteredFolder \? `\$\{filteredFolder\}\/Untitled` : undefined\)/);
  assert.match(calendarViewSource, /private async ensureCalendarCreationFolder\(folderPath: string\): Promise<void>/);
  assert.match(calendarViewSource, /if \(!existing\) await this\.app\.vault\.createFolder\(current\)/);
  assert.match(calendarViewSource, /buildCalendarNewEventOptionsFromFilters\(\{/);
  assert.match(calendarViewSource, /initialCreateMode: this\.plugin\.settings\.initialCreateMode/);
  assert.match(calendarViewSource, /creationDefaults: this\.getFilterCreationDefaults\(filterSources\)/);
  assert.match(calendarViewSource, /taskDefaults: this\.extractTaskLineDefaultsFromFilters\(filterSources\)/);
  assert.match(calendarViewSource, /const createOptions = this\.buildCalendarNewEventOptions\(filterSources\);[\s\S]*?createEvent\(nowRange\.start, nowRange\.end, undefined, createOptions\)/);
  assert.match(calendarViewSource, /const createOptions = this\.buildCalendarNewEventOptions\(filterSources, \{[\s\S]*?titleOverride: title,[\s\S]*?templateOverride: titlePrompt\.templatePath \|\| undefined/);
  assert.match(calendarViewSource, /createEvent\(createRange\.start, createRange\.end, undefined, createOptions\)/);
  assert.match(calendarViewSource, /const createMode = this\.resolveEffectiveCreateMode\(filterSources\);[\s\S]*?Scheduling note for time tracking from drag-create[\s\S]*?createMode,[\s\S]*?if \(createMode === "task"\) \{/);
  assert.match(calendarViewSource, /buildCalendarDropCreateRequest as buildCalendarDropCreateRequestFromFilters/);
  assert.match(calendarViewSource, /private buildCalendarDropCreateRequest\(/);
  assert.match(calendarViewSource, /this\.buildCalendarDropCreateRequest\("template-file", file, start, allDay, filterSources\)/);
  assert.match(calendarViewSource, /this\.buildCalendarDropCreateRequest\("unscheduled-note", file, start, allDay, filterSources\)/);
  assert.match(calendarViewSource, /createEvent\(request\.start, request\.end, undefined, request\.options\)/);
  assert.match(calendarViewSource, /if \(createMode === "note"\) await this\.linkExistingNoteToEvent\(created, file\)/);
  assert.match(calendarViewSource, /const overrides: Record<string, any> = \{ associatedNotePath: file\.path \}/);
  assert.match(calendarViewSource, /createTaskInDailyNote\(file\.basename, start, end, filterDefaults\.tags, overrides/);
  assert.doesNotMatch(calendarViewSource, /buildTaskLinkForFile/);
  assert.match(calendarViewSource, /this\.buildCalendarNewEventOptions\(filterSources, \{[\s\S]*?taskTitleOverride: taskTitle,[\s\S]*?typeFolderOverride: finalFolderPath/);
  assert.match(calendarViewSource, /const createMode = this\.resolveEffectiveCreateMode\(filterSources\);[\s\S]*?if \(createMode === "task"\) \{/);
  assert.match(newEventServiceSource, /const optionTaskTargetPath = normalizeCalendarTaskTargetPath\(options\?\.taskTargetPath\);/);
  assert.match(newEventServiceSource, /const resolvedTaskTargetPath = optionTaskTargetPath \|\| normalizeCalendarTaskTargetPath\(this\.config\.taskTargetPath\) \|\| null;/);
  assert.match(newEventServiceSource, /interface NewEventPromptContext/);
  assert.match(newEventServiceSource, /taskTargetPath: resolvedTaskTargetPath/);
  assert.match(newEventServiceSource, /hasTaskTargetPathOverride: !!optionTaskTargetPath/);
  assert.match(newEventServiceSource, /await this\.promptForTitle\(options\?\.typeFolderOverride, promptContext\)/);
  assert.match(newEventServiceSource, /private getPromptDestinationDisplay\(typeFolderOverride: string \| null \| undefined, context: NewEventPromptContext\): string/);
  assert.match(newEventServiceSource, /return `\$\{context\.taskTargetPath\} \(\$\{context\.hasTaskTargetPathOverride \? "from filter" : "from settings"\}\)`/);
  assert.match(newEventServiceSource, /if \(context\.taskDestination === "daily-note"\) return "Scheduled day's daily note";/);
  assert.match(newEventServiceSource, /typeRow\.createSpan\(\{ text: isTaskMode \? "Task target:" : "Type:" \}\)/);
  assert.match(newEventServiceSource, /if \(!isTaskMode\) \{[\s\S]*const typeBtn = buttons\.createEl\("button", \{ text: "Type\.\.\.", type: "button" \}\)/);
  assert.doesNotMatch(newEventServiceSource, /hasOwnProperty\.call\(options, "taskTargetPath"\)/);
});

test("calendar external drop utilities parse native drag payloads deterministically", async () => {
  const {
    KANBAN_TASK_MIME,
    TPS_TASK_LINE_MIME,
    buildCalendarExternalDropRequest,
    buildCalendarExternalDropPreviewRange,
    extractCalendarExternalDropPayload,
    hasCalendarExternalDropData,
  } = await importCalendarExternalDropUtility();

  assert.deepEqual(
    extractCalendarExternalDropPayload(dataTransferFrom({ "obsidian/file": "Inbox/Plan" })),
    { type: "file", filePath: "Inbox/Plan.md" },
  );
  assert.deepEqual(
    extractCalendarExternalDropPayload(dataTransferFrom({ "obsidian/files": JSON.stringify(["Inbox/A.md", "Inbox/B.md"]) })),
    { type: "file", filePath: "Inbox/A.md" },
  );
  assert.deepEqual(
    extractCalendarExternalDropPayload(dataTransferFrom({ "text/plain": "obsidian://open?file=Inbox%2FEncoded%20Note" })),
    { type: "file", filePath: "Inbox/Encoded Note.md" },
  );
  assert.deepEqual(
    extractCalendarExternalDropPayload(dataTransferFrom({ "text/plain": "[[Projects/Roadmap|Roadmap]]" })),
    { type: "file", filePath: "Projects/Roadmap.md" },
  );
  assert.deepEqual(
    extractCalendarExternalDropPayload(dataTransferFrom({ "text/plain": "[Roadmap](Projects/Roadmap.md)" })),
    { type: "file", filePath: "Projects/Roadmap.md" },
  );
  assert.deepEqual(
    extractCalendarExternalDropPayload(dataTransferFrom({ [TPS_TASK_LINE_MIME]: JSON.stringify({
      path: "Inbox/Tasks.md",
      line: 7,
      rawLine: "- [ ] Call Alex",
      checkboxState: " ",
      text: "Call Alex",
    }) })),
    {
      type: "task",
      filePath: "Inbox/Tasks.md",
      line: 7,
      rawLine: "- [ ] Call Alex",
      checkboxState: " ",
      text: "Call Alex",
    },
  );
  assert.deepEqual(
    extractCalendarExternalDropPayload(dataTransferFrom({ [KANBAN_TASK_MIME]: JSON.stringify({
      filePath: "Inbox/Kanban.md",
      line: "3",
    }) })),
    {
      type: "task",
      filePath: "Inbox/Kanban.md",
      line: 3,
      rawLine: "",
      checkboxState: "",
      text: "",
    },
  );
  assert.deepEqual(
    extractCalendarExternalDropPayload(dataTransferFrom({}, [{ name: "Dropped.md", path: "/tmp/Dropped.md" }])),
    { type: "file", filePath: "/tmp/Dropped.md" },
  );
  assert.equal(extractCalendarExternalDropPayload(dataTransferFrom({ "text/plain": "not a note" })), null);

  assert.equal(hasCalendarExternalDropData(["text/plain"]), true);
  assert.equal(hasCalendarExternalDropData([KANBAN_TASK_MIME]), true);
  assert.equal(hasCalendarExternalDropData(["text/html"]), false);

  const dropTarget = { date: new Date("2027-02-03T10:15:00"), allDay: false };
  assert.deepEqual(
    buildCalendarExternalDropRequest(dataTransferFrom({ "obsidian/file": "Inbox/Plan.md" }), dropTarget),
    {
      payload: { type: "file", filePath: "Inbox/Plan.md" },
      date: dropTarget.date,
      allDay: false,
    },
  );
  assert.equal(buildCalendarExternalDropRequest(dataTransferFrom({ "text/plain": "not a note" }), dropTarget), null);
  assert.equal(buildCalendarExternalDropRequest(dataTransferFrom({ "obsidian/file": "Inbox/Plan.md" }), null), null);

  const start = new Date("2027-02-03T10:15:00");
  assert.deepEqual(buildCalendarExternalDropPreviewRange({
    date: start,
    allDay: false,
    snapDurationMinutes: 45,
    defaultEventDurationMinutes: 30,
  }), {
    start,
    end: new Date("2027-02-03T11:00:00"),
    allDay: false,
  });
  assert.equal(buildCalendarExternalDropPreviewRange({
    date: start,
    allDay: false,
    snapDurationMinutes: 0,
    defaultEventDurationMinutes: 0,
  }).end.getTime(), start.getTime() + 5 * 60 * 1000);
  assert.equal(buildCalendarExternalDropPreviewRange({
    date: start,
    allDay: true,
    snapDurationMinutes: 45,
    defaultEventDurationMinutes: 30,
  }).end.getTime(), start.getTime() + 24 * 60 * 60 * 1000);
});

test("calendar wrapper create options are deterministic across modal and drop callsites", async () => {
  const {
    buildCalendarDropCreateRequest,
    buildCalendarNewEventOptions,
  } = await importCalendarCreateOptionsUtility();
  const options = buildCalendarNewEventOptions({
    filters: [
      {
        and: [
          { property: "task.kind", operator: "is", value: "task" },
          { property: "task.path", operator: "is", value: "[[Inbox/Calendar Tasks|Tasks]]" },
          { property: "task.status", operator: "is", value: "Next" },
          { property: "task.tags", operator: "contains", value: "#deep work" },
        ],
      },
    ],
    initialCreateMode: "note",
    creationDefaults: {
      folderPath: "Meetings",
      frontmatter: { priority: "medium" },
    },
    taskDefaults: {
      tags: ["deep-work"],
      status: "next",
      targetPath: "Inbox/Calendar Tasks.md",
    },
    overrides: {
      allDay: true,
      titleOverride: "Planning",
      templateOverride: "Templates/Event.md",
      templateTypeOverride: "file",
    },
  });

  assert.deepEqual(options, {
    createMode: "task",
    useBaseDefaults: true,
    frontmatterDefaults: { priority: "medium" },
    taskTags: ["deep-work"],
    taskStatus: "next",
    taskTargetPath: "Inbox/Calendar Tasks.md",
    typeFolderOverride: "Meetings",
    allDay: true,
    titleOverride: "Planning",
    templateOverride: "Templates/Event.md",
    templateTypeOverride: "file",
  });

  assert.equal(
    buildCalendarNewEventOptions({
      filters: [],
      initialCreateMode: null,
      creationDefaults: { folderPath: null, frontmatter: {} },
      taskDefaults: { tags: [], status: null, targetPath: null },
    }).createMode,
    "note",
  );

  const start = new Date("2027-01-03T14:00:00");
  const templateRequest = buildCalendarDropCreateRequest({
    kind: "template-file",
    start,
    allDay: false,
    defaultEventDurationMinutes: 45,
    droppedFilePath: "Templates/Event.md",
    filters: [{ property: "task.kind", operator: "is", value: "task" }],
    initialCreateMode: "note",
    creationDefaults: { folderPath: "Meetings", frontmatter: { area: "ops" } },
    taskDefaults: { tags: ["ops"], status: "next", targetPath: "Inbox/Calendar Tasks.md" },
  });

  assert.equal(templateRequest.start, start);
  assert.equal(templateRequest.end.getTime(), start.getTime() + 45 * 60 * 1000);
  assert.deepEqual(templateRequest.options, {
    createMode: "task",
    useBaseDefaults: true,
    frontmatterDefaults: { area: "ops" },
    taskTags: ["ops"],
    taskStatus: "next",
    taskTargetPath: "Inbox/Calendar Tasks.md",
    typeFolderOverride: "Meetings",
    allDay: false,
    templateOverride: "Templates/Event.md",
    templateTypeOverride: "file",
  });

  const noteRequest = buildCalendarDropCreateRequest({
    kind: "unscheduled-note",
    start,
    allDay: true,
    defaultEventDurationMinutes: 45,
    droppedFilePath: "Inbox/Project.md",
    droppedFileTitle: "Project kickoff",
    filters: [],
    initialCreateMode: "task",
    creationDefaults: { folderPath: null, frontmatter: {} },
    taskDefaults: { tags: [], status: null, targetPath: null },
  });

  assert.equal(noteRequest.end.getTime(), start.getTime() + 24 * 60 * 60 * 1000);
  assert.deepEqual(noteRequest.options, {
    createMode: "task",
    useBaseDefaults: true,
    frontmatterDefaults: {},
    taskTags: [],
    taskStatus: null,
    taskTargetPath: null,
    typeFolderOverride: null,
    allDay: true,
    titleOverride: "Project kickoff",
    taskAssociatedNotePath: "Inbox/Project.md",
  });
});

test("settings include a Base-native query guide", () => {
  assert.match(settingsTabSource, /Base query guide/);
  assert.match(settingsTabSource, /Keep filters Base-native/);
  assert.match(settingsTabSource, /positive folder\/path filters as creation location hints/);
  assert.match(settingsTabSource, /Task creation in daily-note mode writes scheduled inline tasks/);
  assert.match(settingsTabSource, /unless task\.path chooses a target note/);
  assert.match(settingsTabSource, /task\.path == \\"Collections\/Toget\.md\\"/);
  assert.match(settingsTabSource, /Use task\.tags for inline task tags/);
  assert.match(settingsTabSource, /Scheduled tasks tagged #todo without notes tagged #todo/);
  assert.match(settingsTabSource, /task\.tags\.contains/);
  assert.match(settingsTabSource, /#todo/);
  assert.match(settingsTabSource, /Negative filters and ambiguous OR branches constrain matching but are not guessed as creation defaults/);
});

test("reading-mode embedded calendars stay compact and preserve Bases chrome by default", () => {
  assert.doesNotMatch(calendarCss.split("\n")[0], /}\.[\w-]/);
  assert.doesNotMatch(calendarCss, /\.bases-calendar-wrapper\.bases-calendar-embedded \.fc-bg-event\{opacity:\.16!important\}/);
  assert.doesNotMatch(calendarCss, /\.bases-calendar-wrapper\.bases-calendar-embedded \.fc \.fc-timegrid-axis-chunk\{display:none!important\}/);
  assert.match(embedCalendarCss, /\.markdown-reading-view \.internal-embed \.bases-calendar-scroll/);
  assert.match(embedCalendarCss, /\.markdown-rendered \.internal-embed \.bases-calendar-scroll/);
  assert.match(embedCalendarCss, /width: min\(100%, 760px\) !important;/);
  assert.match(embedCalendarCss, /--tps-calendar-embedded-height, 520px/);
  assert.match(embedCalendarCss, /\.fc-timegrid-col\.fc-day-today/);
  assert.match(embedCalendarCss, /\.fc-timegrid-axis-frame/);
  assert.match(embedCalendarCss, /align-items: center !important;/);
  assert.match(embedCalendarCss, /var\(--interactive-accent\)/);
  assert.match(calendarViewSource, /private embeddedHeight: number = 520/);
  assert.match(calendarViewSource, /private showEmbeddedHeader: boolean = true/);
  assert.match(calendarViewSource, /displayName: "Embedded height \(px\)"/);
  assert.match(viewOptionsSource, /displayName: "Embedded Base header"/);
  assert.match(viewOptionsSource, /max: MAX_CONDENSE_LEVEL/);
  assert.match(calendarViewSource, /max: MAX_CONDENSE_LEVEL/);
  assert.match(utilsSource, /const MIN_SLOT_ZOOM = 0\.08/);
  assert.match(utilsSource, /export const MAX_CONDENSE_LEVEL = 300/);
  assert.match(calendarViewSource, /this\.embeddedHeight = this\.normalizeEmbeddedHeight\(this\.config\.get\("embeddedHeight"\)\)/);
  assert.match(calendarViewSource, /this\.showEmbeddedHeader = this\.parseBooleanLike\(this\.config\.get\("showEmbeddedHeader"\), true\)/);
  assert.match(calendarViewSource, /embeddedHeight=\{this\.embeddedHeight\}/);
  assert.match(reactViewSource, /embeddedHeight\?: number/);
  assert.match(reactViewSource, /--tps-calendar-embedded-height/);
  assert.match(reactViewSource, /const \[isCanvasEmbed, setIsCanvasEmbed\] = useState\(false\)/);
  assert.match(reactViewSource, /const useCanvasEmbedSizing = isEmbedMode && isCanvasEmbed/);
  assert.match(reactViewSource, /const resolvedViewHeight = !useCanvasEmbedSizing && typeof embeddedHeight === "number"/);
  assert.match(reactViewSource, /const resolvedEmbedHeight = isEmbedMode \? resolvedViewHeight : undefined/);
  assert.match(reactViewSource, /\(!isEmbedMode \|\| isCanvasEmbed\) &&/);
  assert.match(reactViewSource, /showNavButtons=\{isCanvasEmbed \? true : showNavButtons\}/);
  assert.match(reactViewSource, /const mutedEventOpacity = isCanvasEmbed/);
  assert.match(reactViewSource, /isCanvasEmbed \? "none" : "0 1px 1px rgba\(0, 0, 0, 0\.28\)"/);
  assert.match(reactViewSource, /bases-calendar-canvas-embedded/);
  assert.doesNotMatch(reactViewSource, /const resolvedDedicatedHeight = !isEmbedMode \? resolvedViewHeight : undefined/);
  assert.match(reactViewSource, /const dedicatedCalendarHeight = \(calendarBodyHeight > 0/);
  assert.match(reactViewSource, /const fullCalendarContentHeight: number \| "auto" \| "100%" = isEmbedMode/);
  assert.match(reactViewSource, /height: isEmbedMode \? scrollSurfaceHeight : isMobile \? "auto" : `\$\{dedicatedCalendarHeight\}px`/);
  assert.match(reactViewSource, /flex: isEmbedMode \? "1 1 0%" : isMobile \? "1 1 auto" : "1 1 0%"/);
  assert.match(reactViewSource, /const effectiveZoom = isEmbedMode \? Math\.min\(zoom, isMobile \? 0\.75 : 0\.82\) : zoom/);
  assert.match(reactViewSource, /const computedSlotHeight = baseSlotHeight/);
  assert.match(reactViewSource, /slot\.style\.setProperty\("height", `\$\{slotHeight\}px`, "important"\)/);
  assert.match(zoomHookSource, /Math\.max\(5, Math\.min\(90, current \+ adjustment\)\)/);
  assert.match(zoomHookSource, /const MIN_SLOT_ZOOM = 0\.08/);
  assert.match(zoomHookSource, /const MAX_LEVEL = 300/);
  assert.match(reactViewSource, /slotLaneDidMount=\{handleSlotMount\}/);
  assert.match(reactViewSource, /slotLabelDidMount=\{handleSlotMount\}/);
  assert.match(reactViewSource, /expandRows=\{resolvedFilterViewMode === "month" && !isEmbedMode && !isMobile\}/);
  assert.match(zoomHookSource, /\.fc-timegrid-slot, \.fc-timegrid-slot-label/);
  assert.match(zoomHookSource, /slot\.style\.setProperty\("height", `\$\{newHeight\}px`, "important"\)/);
  assert.doesNotMatch(reactViewSource, /Math\.max\(baseSlotHeight, dedicatedStretchSlotHeight/);
  assert.match(reactViewSource, /: dedicatedCalendarHeight;/);
  assert.match(reactViewSource, /overflowY: scrollSurfaceOverflowY,/);
  assert.match(embedCalendarCss, /\.tps-calendar-embedded-hidden-header/);
  assert.doesNotMatch(embedCalendarCss, /\.tps-calendar-base-embed \.bases-header,[\s\S]*?display: none !important;/);
  assert.match(embedCalendarCss, /\.tps-calendar-embedded-visible-header\s*\{[\s\S]*?display: flex !important;/);
  assert.match(embedCalendarCss, /\.bases-calendar-container--embedded \.bases-calendar-wrapper\.bases-calendar-embedded \.bases-calendar-floating-nav/);
  assert.match(embedCalendarCss, /\.bases-calendar-container--embedded \.bases-calendar-wrapper\.bases-calendar-embedded \.fc \.fc-timegrid \.fc-daygrid-body/);
  assert.match(embedCalendarCss, /--tps-embed-grid-line/);
  assert.match(embedCalendarCss, /\.bases-calendar-container--embedded \.bases-calendar-wrapper\.bases-calendar-embedded \.fc \.fc-timegrid-divider/);
  assert.match(embedCalendarCss, /border-top: 1px solid color-mix/);
  assert.match(embedCalendarCss, /\.bases-calendar-container--embedded \.bases-calendar-wrapper\.bases-calendar-embedded \.fc \.fc-highlight/);
  assert.match(embedCalendarCss, /box-shadow: none !important;/);
  assert.match(embedCalendarCss, /\.bases-calendar-container--embedded \.bases-calendar-wrapper\.bases-calendar-embedded \.fc-bg-event,/);
  assert.match(embedCalendarCss, /\.bases-calendar-container--embedded \.bases-calendar-wrapper\.bases-calendar-embedded \.fc-bg-event\.bases-calendar-aux-date-marker,/);
  assert.match(embedCalendarCss, /\.bases-calendar-container--embedded \.bases-calendar-wrapper\.bases-calendar-embedded \.tps-calendar-aux-harness/);
  assert.doesNotMatch(embedCalendarCss, /\.bases-calendar-wrapper\.bases-calendar-embedded \.fc-bg-event:not\(\.bases-calendar-aux-date-marker\)/);
  assert.match(embedCalendarCss, /visibility: hidden !important;/);
  assert.match(embedCalendarCss, /\.bases-calendar-container--embedded \.bases-calendar-wrapper\.bases-calendar-embedded \.fc \.fc-timegrid-slot-lane/);
  assert.match(embedCalendarCss, /\.fc-timegrid-slot-label \{[\s\S]*?padding-top: 0 !important;[\s\S]*?line-height: 1 !important;/);
  assert.match(embedCalendarCss, /\.fc-timegrid-slot-label-cushion \{[\s\S]*?min-height: 0 !important;[\s\S]*?line-height: 1 !important;/);
  assert.match(embedCalendarCss, /\.bases-calendar-container--embedded \.bases-calendar-wrapper\.bases-calendar-embedded \.bases-calendar-scroll-hours-toggle/);
  assert.match(reactViewSource, /const hiddenTimeIndicatorEdges = useMemo/);
  assert.match(reactViewSource, /calEntry\.forceAllDay === true/);
  assert.match(reactViewSource, /!!calEntry\.externalEvent\?\.isAllDay/);
  assert.match(reactViewSource, /markEdge\(start, "after"\)/);
  assert.match(reactViewSource, /markEdge\(end, "before"\)/);
  assert.match(reactViewSource, /has-hidden-time-event-before/);
  assert.match(reactViewSource, /has-hidden-time-event-after/);
  assert.match(calendarCss, /\.fc-timegrid-col\.has-hidden-time-event-before \.fc-timegrid-col-frame::before/);
  assert.match(calendarCss, /\.fc-timegrid-col\.has-hidden-time-event-after \.fc-timegrid-col-frame::after/);
  assert.match(embedCalendarCss, /\.fc-timegrid-col\.has-hidden-time-event-before \.fc-timegrid-col-frame::before/);
  assert.match(calendarCss, /\.bases-calendar-container--dedicated \.fc-theme-standard td,/);
  assert.match(calendarCss, /--fc-border-color: color-mix/);
  assert.match(calendarCss, /\.bases-calendar-scroll--dedicated \{/);
  assert.match(calendarCss, /overflow: auto;/);
  assert.match(calendarCss, /\.bases-calendar-container--dedicated \.fc \.fc-col-header-cell,/);
  assert.match(calendarCss, /\.bases-calendar-container--dedicated \.fc \.fc-timegrid-col-frame \{/);
  assert.match(calendarCss, /\.bases-calendar-container--dedicated \.fc \.fc-day-today,/);
  assert.match(calendarCss, /\.bases-calendar-container--dedicated \.fc \.fc-timegrid-col\.fc-day-today::before \{/);
  assert.match(calendarCss, /\.bases-calendar-container--dedicated \.fc \.fc-timegrid-col\.fc-day-today \.fc-timegrid-col-bg,/);
  assert.match(calendarCss, /\.bases-calendar-container--dedicated \.fc \.fc-scroller-harness,/);
  assert.match(embedCalendarCss, /position: absolute !important;/);
  assert.match(embedCalendarCss, /width: 24px !important;/);
  assert.match(embedCalendarCss, /display: none !important;/);
  assert.match(embedCalendarCss, /\.fc-timegrid \.fc-daygrid-body,/);
  assert.match(embedCalendarCss, /\.fc-timegrid-axis-cushion/);
  assert.match(embedCalendarCss, /justify-content: center !important;/);
  assert.match(embedCalendarCss, /\.fc \.fc-timegrid \.fc-daygrid-body table/);
  assert.match(embedCalendarCss, /min-height: 36px !important;/);
  assert.match(embedCalendarCss, /--tps-embed-header-bg:/);
  assert.doesNotMatch(embedCalendarCss, /--tps-embed-header-height/);
  assert.doesNotMatch(embedCalendarCss, /--tps-embed-all-day-height/);
  assert.doesNotMatch(embedCalendarCss, /transform: translateY/);
  assert.doesNotMatch(embedCalendarCss, /max-height: 36px !important;/);
  assert.doesNotMatch(embedCalendarCss, /\.bases-calendar-wrapper\.bases-calendar-embedded \.fc \* \{/);
  const allDayBodyBlock = embedCalendarCss.match(
    /\.bases-calendar-wrapper\.bases-calendar-embedded \.fc \.fc-timegrid \.fc-daygrid-body \{[\s\S]*?\}/
  )?.[0] ?? "";
  assert.doesNotMatch(allDayBodyBlock, /display: none !important;/);
  assert.doesNotMatch(allDayBodyBlock, /max-height/);
  assert.doesNotMatch(allDayBodyBlock, /overflow:\s*hidden/);
  assert.match(embedCalendarCss, /\.fc \.fc-event\.bases-calendar-event \{/);
  assert.match(embedCalendarCss, /border-radius: 4px !important;/);
  assert.match(embedCalendarCss, /\.fc-timegrid-event\.bases-calendar-event \.bases-calendar-event-title/);
  assert.match(embedCalendarCss, /white-space: nowrap !important;/);
  assert.doesNotMatch(reactViewSource, /is-empty-embed-range/);
  assert.doesNotMatch(reactViewSource, /bases-calendar-embedded-empty-panel/);
  assert.doesNotMatch(embedCalendarCss, /No visible scheduled items/);
  assert.doesNotMatch(embedCalendarCss, /No scheduled items/);
  assert.doesNotMatch(embedCalendarCss, /is-empty-embed-range/);
  assert.doesNotMatch(embedCalendarCss, /bases-calendar-embedded-empty-panel/);
  assert.match(calendarViewSource, /if \(isEmbedded && !this\.showEmbeddedHeader\) \{/);
  assert.match(calendarViewSource, /tps-calendar-embedded-hidden-header/);
  assert.match(calendarViewSource, /tps-calendar-embedded-visible-header/);
  assert.match(calendarViewSource, /\.canvas-node-content, \.canvas-node/);
  assert.match(calendarViewSource, /bases-calendar-scroll--canvas-embedded/);
  assert.match(calendarViewSource, /bases-calendar-container--canvas-embedded/);
  assert.match(calendarViewSource, /\^task\\\./);
  assert.match(calendarViewSource, /startDateProperty\.type !== "note" && !isTaskDateProperty\(this\.startDateProp\)/);
  assert.match(calendarViewSource, /endDateProperty\.type !== "note" && !isTaskDateProperty\(this\.endDateProp\)/);
  assert.match(reactViewSource, /from "\.\/utils\/calendar-day-count"/);
  assert.match(calendarDayCountSource, /const EMBEDDED_TIMEGRID_MIN_DAY_WIDTH_PX = 230/);
  assert.match(calendarDayCountSource, /const CANVAS_TIMEGRID_MIN_DAY_WIDTH_PX = 230/);
  assert.match(calendarDayCountSource, /if \(!isConstrainedEmbed \|\|/);
  assert.match(reactViewSource, /getAdaptiveTimeGridDayCount/);
  assert.match(reactViewSource, /const _DRAG_EVENT_TYPES = \['mousedown','mousemove','mouseup'\] as const/);
  assert.doesNotMatch(reactViewSource, /new PointerEvent\(e\.type/);
  assert.match(reactViewSource, /Task events are handled directly by GCM's task-line menu/);
  assert.match(reactViewSource, /if \(isInlineTaskEntry \|\| !isEmbedModeRef\.current\) \{/);
  assert.match(reactViewSource, /const \[containerWidth, setContainerWidth\] = useState<number>\(0\)/);
  assert.match(reactViewSource, /const visualWidth = _origBCR\.call\(container\)\.width/);
  assert.match(reactViewSource, /closest<HTMLElement>\("\.canvas-node"\)/);
  assert.match(reactViewSource, /Number\.parseFloat\(canvasNode\.style\.width \|\| ""\)/);
  assert.match(reactViewSource, /return candidates\.length \? Math\.min\(\.\.\.candidates\) : layoutWidth/);
  assert.match(reactViewSource, /getAdaptiveTimeGridDayCount\(\s*configuredDayCount,\s*containerWidth,\s*isEmbedMode \|\| isCanvasEmbed,\s*isCanvasEmbed,/);
  assert.match(reactViewSource, /"timeGridRange-2": \{ type: "timeGrid", duration: \{ days: 2 \}, buttonText: "2d" \}/);
  assert.match(embedCalendarCss, /\.canvas-node-content \.bases-calendar-scroll--canvas-embedded/);
  assert.match(embedCalendarCss, /\.canvas-node-content \.bases-calendar-wrapper\.bases-calendar-canvas-embedded/);
  assert.match(embedCalendarCss, /\.bases-calendar-wrapper\.bases-calendar-canvas-embedded \.fc \.fc-timegrid-body/);
  assert.match(embedCalendarCss, /\.bases-calendar-wrapper\.bases-calendar-canvas-embedded \.fc \.fc-timegrid-cols table/);
  assert.match(embedCalendarCss, /width: 100% !important;\s*min-width: 100% !important;\s*max-width: none !important;/);
  assert.match(embedCalendarCss, /table-layout: auto !important;/);
  assert.match(embedCalendarCss, /table-layout: fixed !important;/);
  assert.match(reactViewSource, /slotEventOverlap=\{!isEmbedMode\}/);
  assert.match(embedCalendarCss, /\.bases-calendar-wrapper\.bases-calendar-canvas-embedded \.bases-calendar-floating-nav/);
  assert.match(embedCalendarCss, /\.bases-calendar-wrapper\.bases-calendar-canvas-embedded \.bases-calendar-event-title/);
  assert.match(embedCalendarCss, /text-shadow: none !important;/);
  assert.match(embedCalendarCss, /opacity: 1 !important;/);
  assert.doesNotMatch(embedCalendarCss, /padding-bottom: 44px !important;/);
  assert.doesNotMatch(embedCalendarCss, /--tps-embed-axis-width: 44px/);
  assert.match(embedCalendarCss, /fc-scrollgrid > colgroup > col:first-child/);
  assert.match(embedCalendarCss, /fc-scrollgrid tr > :first-child/);
  assert.match(embedCalendarCss, /fc-timegrid-slot-label-cushion \{[\s\S]*padding-inline: 8px !important;[\s\S]*text-align: end !important;/);
  assert.doesNotMatch(embedCalendarCss, /bases-calendar-today-button/);
  assert.match(reactViewSource, /if \(isEmbedMode\) \{/);
  assert.match(reactViewSource, /: priorityColor,/);
  assert.match(reactViewSource, /linear-gradient\(180deg, \$\{priorityColor\}, color-mix\(in srgb, \$\{priorityColor\}, black 10%\)\)/);
  assert.match(reactViewSource, /--tps-event-title-color", isNonActiveEvent \? "var\(--text-muted\)" : "white"/);
  assert.match(reactViewSource, /isNonActiveEvent\s+\?\s+`color-mix\(in srgb, \$\{priorityColor\} 24%, var\(--background-primary\) 76%\)`/);
  assert.match(reactViewSource, /element\.style\.setProperty\("filter", isNonActiveEvent \? "saturate\(0\.45\) brightness\(0\.82\)" : "none", "important"\)/);
  assert.match(reactViewSource, /color-mix\(in srgb, var\(--background-secondary\) 88%, var\(--background-primary-alt\)\)/);
  assert.match(reactViewSource, /element\.style\.setProperty\("opacity", isNonActiveEvent \? mutedEventOpacity : "1", "important"\)/);
  assert.match(reactViewSource, /: `2px solid \$\{priorityColor\}`/);
  assert.match(calendarCss, /\.fc \.fc-event\.bases-calendar-event\.is-non-active:not\(\.is-external\):not\(\.is-archived-external-placeholder\)/);
  assert.match(calendarCss, /filter: saturate\(0\.45\) brightness\(0\.82\) !important;/);
  assert.doesNotMatch(calendarCss, /body\.tps-tps-mobile-ui-keyboard-hidden \.bases-calendar-wrapper \.bases-calendar-floating-nav/);
  assert.doesNotMatch(calendarCss, /body\.tps-tps-mobile-ui-gesture-hidden \.bases-calendar-wrapper \.bases-calendar-floating-nav/);
  assert.match(calendarCss, /bottom: calc\(112px \+ env\(safe-area-inset-bottom, 0px\)\) !important;/);
  assert.match(calendarEventsHookSource, /priorityColor: explicitColor === "transparent" \? "" : explicitColor/);
  assert.doesNotMatch(calendarEventsHookSource, /priorityColor: backgroundColor/);
  assert.doesNotMatch(embedCalendarCss, /\.fc \.fc-event\.bases-calendar-event \{[\s\S]*?opacity: 0\.98 !important;/);
  assert.match(embedCalendarCss, /\.fc \.fc-event\.bases-calendar-event\.is-non-active/);
  assert.match(embedCalendarCss, /\.fc \.fc-event\.bases-calendar-event\.is-past/);
  assert.match(calendarEventsHookSource, /isNonActive \? "is-non-active is-past" : ""/);
  assert.match(calendarViewSource, /private resolveInlineTaskStatus\(checkboxState: string, inlineProperties: Map<string, string>\): string/);
  assert.match(calendarViewSource, /status: task\.status \|\| undefined/);
  assert.match(calendarViewSource, /completed: this\.isDoneStatusValue\(status\)/);
  assert.match(calendarViewSource, /if \(marker === "-" \|\| marker === "~"\) return "wont-do"/);
  assert.match(calendarViewSource, /private buildNonActiveStatuses\(\): string\[\]/);
  assert.match(calendarViewSource, /getInactiveStatuses/);
  assert.match(calendarViewSource, /const statuses = new Set<string>\(\["complete", "completed", "done"]\)/);
  assert.match(calendarViewSource, /statuses\.add\("wont do"\)/);
  assert.match(calendarViewSource, /const associatedFile = this\.findExplicitAssociatedNoteForInlineTask\(task\)\.file/);
  assert.match(calendarViewSource, /this\.resolveFrontmatterEventColor\(associatedFrontmatter\)[\s\S]*\|\| this\.resolveFrontmatterEventColor\(frontmatter\)/);
  assert.match(calendarViewSource, /const inlineTaskColor = applyColorToCard \? ruleColor \|\| frontmatterColor : ""/);
  assert.match(calendarViewSource, /if \(ruleColor && applyColorToCard\)/);
  assert.match(calendarViewSource, /backgroundColor: inlineTaskColor/);
  assert.doesNotMatch(embedCalendarCss, /\.markdown-reading-view \.internal-embed \.bases-toolbar/);
  assert.doesNotMatch(embedCalendarCss, /\.markdown-rendered \.internal-embed \.bases-controls/);
});

test("dedicated calendar tabs preserve configured day counts while constrained embeds adapt", async () => {
  const { getAdaptiveTimeGridDayCount } = await importCalendarDayCountUtility();

  assert.equal(getAdaptiveTimeGridDayCount(3, 570, false, false), 3);
  assert.equal(getAdaptiveTimeGridDayCount(3, 570, true, false), 2);
  assert.equal(getAdaptiveTimeGridDayCount(3, 570, true, true), 2);
  assert.equal(getAdaptiveTimeGridDayCount(3, 0, true, false), 3);
});

test("calendar keeps event drag snap separate and continuous view uses configured durations", () => {
  assert.match(reactViewSource, /snapDuration=\{formatFullCalendarDuration\(snapDurationMinutes, 5\)\}/);
  assert.match(reactViewSource, /slotDuration=\{formatFullCalendarDuration\(slotDurationMinutes, 30\)\}/);
  assert.match(continuousSource, /slotDuration=\{formatFullCalendarDuration\(slotDurationMinutes, 30\)\}/);
  assert.match(continuousSource, /snapDuration=\{formatFullCalendarDuration\(snapDurationMinutes, 5\)\}/);
  assert.doesNotMatch(continuousSource, /slotDuration="00:30:00"/);
});

test("external drag-create preview shows the resolved time without changing normal events", () => {
  assert.match(reactViewSource, /dropPreviewTimeLabel: formatSelectionPreview\(/);
  assert.match(reactViewSource, /externalDropPreview\.start,\s+externalDropPreview\.end,\s+externalDropPreview\.allDay,/);
  assert.match(reactViewSource, /\}, \[events, externalDropPreview, formatSelectionPreview\]\)/);
  assert.match(eventRendererSource, /const isExternalDropPreview = !!props\.isExternalDropPreview/);
  assert.match(eventRendererSource, /const dropPreviewTimeLabel = isExternalDropPreview/);
  assert.match(eventRendererSource, /className="bases-calendar-external-drop-preview-time"/);
  assert.doesNotMatch(eventRendererSource, /className="bases-calendar-event-time"/);
  assert.doesNotMatch(eventRendererSource, /formatTimedEventLabel/);
});

test("mobile quick double tap opens entries and inline tasks focus their task line", () => {
  assert.match(reactViewSource, /mobileEntryActionTimeoutRef/);
  assert.match(reactViewSource, /now - previousTap\.at < 450/);
  assert.match(reactViewSource, /onEntryClick\(entry, false, clickInfo\.jsEvent\)/);
  assert.match(reactViewSource, /setTimeout\(\(\) => \{[\s\S]*onEntryContextMenu\(syntheticEvent, entry\.entry\);[\s\S]*\}, 260\)/);
  assert.match(calendarViewSource, /const inlineTask = \(calEntry\.entry as any\)\?\.inlineTask as InlineScheduledTask \| undefined/);
  assert.match(calendarViewSource, /lineNumber: typeof inlineTask\?\.lineNumber === "number" \? inlineTask\.lineNumber : undefined/);
  assert.match(calendarViewSource, /revealCompleted: !!inlineTask && typeof inlineTask\.lineNumber === "number"/);
  assert.match(calendarViewSource, /revealCompletedCheckboxesForFile\(this\.app, file\.path, lineNumber\)/);
  assert.match(calendarViewSource, /private async focusLeafLine/);
  assert.match(calendarViewSource, /editor\.setCursor\(position\)/);
  assert.match(calendarViewSource, /editor\.scrollIntoView/);
  assert.match(calendarViewSource, /private highlightEditorLine/);
  assert.match(calendarViewSource, /scheduleEditorLineHighlight/);
  assert.match(calendarViewSource, /tps-calendar-source-line-highlight/);
  assert.match(calendarViewSource, /tps-gcm-line-highlight/);
  assert.match(calendarCss, /\.cm-line\.tps-calendar-source-line-highlight/);
});

test("calendar previews reveal hidden task lines before hover-link opens", () => {
  assert.match(reactViewSource, /revealCompletedCheckboxesForFile/);
  assert.match(reactViewSource, /const revealCompletedTaskForPreview = useCallback/);
  assert.match(reactViewSource, /if \(!inlineTask \|\| typeof inlineTask\.lineNumber !== "number"\) return/);
  assert.match(reactViewSource, /revealCompletedCheckboxesForFile\(app, entry\.entry\.file\.path, inlineTask\.lineNumber\)/);
  assert.match(reactViewSource, /revealCompletedTaskForPreview\(entry\);[\s\S]*workspace\.trigger\("hover-link"/);
  assert.match(reactViewSource, /workspace\.trigger\("hover-link"[\s\S]*window\.setTimeout\(\(\) => revealCompletedTaskForPreview\(entry\), 80\)/);
  assert.match(reactViewSource, /revealCompletedTaskForPreview\(calendarEntry\);[\s\S]*workspace\.trigger\("hover-link"/);
  assert.match(reactViewSource, /workspace\.trigger\("hover-link"[\s\S]*window\.setTimeout\(\(\) => revealCompletedTaskForPreview\(calendarEntry\), 80\)/);
});

test("calendar task clicks open an associated-note/source-line chooser", () => {
  assert.match(reactViewSource, /const isInlineTaskEntry = !!inlineTask && typeof inlineTask\.lineNumber === "number"/);
  assert.match(reactViewSource, /shouldForceBaseLinkPreview\(app\) &&\s+!isModEvent/);
  assert.match(reactViewSource, /const highlightTaskLineInHoverPreview = useCallback/);
  assert.match(reactViewSource, /const targetLineNumber = inlineTask\.lineNumber/);
  assert.match(reactViewSource, /scheduledValue\?: string/);
  assert.match(reactViewSource, /String\(inlineTask\.scheduledValue \|\| ""\)\.match\(\/\\d\{4\}-\\d\{2\}-\\d\{2\}\/\)\?\.\[0\]/);
  assert.match(reactViewSource, /const completedToggleClicked = new WeakSet<HTMLElement>\(\)/);
  assert.match(reactViewSource, /const getCandidateLineNumber = \(candidate: HTMLElement\): number \| null/);
  assert.match(reactViewSource, /candidate\.getAttribute\("data-line"\)/);
  assert.match(reactViewSource, /const revealCompletedRowsInPopover = \(popover: HTMLElement\)/);
  assert.match(reactViewSource, /tps-gcm-completed-checkboxes-revealed/);
  assert.match(reactViewSource, /tps-gcm-task-hiding-excluded/);
  assert.match(reactViewSource, /row\.style\.setProperty\("display", row\.tagName === "LI" \? "list-item" : "block", "important"\)/);
  assert.match(reactViewSource, /show completed/i);
  assert.match(reactViewSource, /completedToggle\.click\(\)/);
  assert.match(reactViewSource, /const scanRatios = \[/);
  assert.match(reactViewSource, /const scrollRatio = scanRatios\[Math\.min\(attempt, scanRatios\.length - 1\)\] \?\? lineRatio/);
  assert.match(reactViewSource, /scroller\.scrollTop = targetTop/);
  assert.match(reactViewSource, /const matchesLine = candidateLine === targetLineNumber \|\| candidateLine === targetLineNumber \+ 1/);
  assert.match(reactViewSource, /const effectiveTargetDate = targetDate \|\| String\(sourceLine \|\| ""\)\.match\(\/\\d\{4\}-\\d\{2\}-\\d\{2\}\/\)\?\.\[0\] \|\| ""/);
  assert.match(reactViewSource, /const matchesSource = normalizedSourcePrefix && text\.includes\(normalizedSourcePrefix\) && \(!effectiveTargetDate \|\| text\.includes\(effectiveTargetDate\)\)/);
  assert.doesNotMatch(reactViewSource, /markdown-preview-section > div/);
  assert.match(reactViewSource, /highlightTaskLineInHoverPreview\(entry\)/);
  assert.match(reactViewSource, /highlightTaskLineInHoverPreview\(calendarEntry\)/);
  assert.doesNotMatch(reactViewSource, /visibleText\.includes\(normalizeTaskPreviewText\(file\.basename\)\)/);
  assert.match(reactViewSource, /if \(!isInlineTaskEntry\) \{[\s\S]*?element\.setAttribute\('data-href', entryPath\);[\s\S]*?element\.classList\.add\('internal-link'\);[\s\S]*?\}/);
  assert.match(reactViewSource, /element\.classList\.remove\("internal-link"\)/);
  assert.match(reactViewSource, /element\.removeAttribute\("data-href"\)/);
  assert.match(reactViewSource, /element\.removeAttribute\("href"\)/);
  assert.match(reactViewSource, /element\.setAttribute\("role", "button"\)/);
  assert.match(reactViewSource, /titleEl\.classList\.remove\("internal-link"\)/);
  assert.match(reactViewSource, /_tpsCalendarTaskClickHandler/);
  assert.match(reactViewSource, /element\.addEventListener\("click", taskClickHandler, true\)/);
  assert.match(reactViewSource, /const renderedCalendarEntry = calendarEntry && event\.start[\s\S]*?startDate: new Date\(event\.start\)/);
  assert.match(reactViewSource, /const taskCalendarEntry = renderedCalendarEntry \?\? calendarEntry/);
  assert.match(reactViewSource, /onEntryClick\(taskCalendarEntry, e\.ctrlKey \|\| e\.metaKey, e\)/);
  assert.doesNotMatch(reactViewSource, /openEntryClickPreview\(e, element, taskCalendarEntry\)/);
  assert.match(reactViewSource, /element\.removeEventListener\("click", taskClickHandler, true\)/);
  assert.match(reactViewSource, /clearEventClickPreview\(\);\s+onEntryClick\(entry, isModEvent, clickInfo\.jsEvent\);/);
  assert.match(calendarViewSource, /private showInlineTaskOpenMenu/);
  assert.match(calendarViewSource, /Open associated note:/);
  assert.match(calendarViewSource, /Create associated note/);
  assert.match(calendarViewSource, /Open source task line/);
  assert.match(calendarViewSource, /private getGcmTaskLineContextMenuService\(\): any/);
  assert.match(calendarViewSource, /private addGcmInlineTaskMenuItems\(menu: Menu, inlineTask: InlineScheduledTask, calEntry: CalendarEntry\): boolean/);
  assert.match(calendarViewSource, /taskLineContextMenuService\.addTaskLineMenuItems\(/);
  assert.match(calendarViewSource, /lineNumber: lineIndex \+ 1/);
  assert.match(calendarViewSource, /rawLine: inlineTask\.line/);
  assert.match(calendarViewSource, /checkboxToken: inlineTask\.checkboxState \|\| "\[ \]"/);
  assert.match(calendarViewSource, /isCalendarTask: true/);
  assert.match(calendarViewSource, /calendarAllDay: this\.isInlineTaskCalendarAllDay\(inlineTask, calEntry\)/);
  assert.match(calendarViewSource, /\{ includeNoteActions: false \}/);
  assert.match(calendarViewSource, /dailyInboxLineService[\s\S]*createNoteForLine\(\{/);
  assert.match(calendarViewSource, /this\.handleCreateMeetingNote\(externalEvent, \{ forceNoteMode: true \}\)/);
  assert.match(calendarViewSource, /private isInlineTaskCalendarAllDay\(inlineTask: InlineScheduledTask, calEntry: CalendarEntry\): boolean/);
  assert.doesNotMatch(calendarViewSource, /Edit task properties/);
  assert.doesNotMatch(calendarViewSource, /CalendarInlineTaskPropertiesModal/);
  assert.match(calendarViewSource, /private async openCalendarInlineTaskSource/);
  assert.match(calendarViewSource, /private findAssociatedNoteForInlineTask/);
  assert.match(calendarViewSource, /private findLinkedNoteForExternalEventInstance/);
  assert.match(calendarViewSource, /private findExplicitAssociatedNoteForInlineTask/);
  assert.match(calendarViewSource, /private findTaskChildNoteForInlineTask/);
  assert.match(calendarViewSource, /private findUniqueParentLinkedNoteForInlineTask/);
  assert.match(calendarViewSource, /getTaskAssociatedNoteCandidates\(task\.inlineProperties, task\.line\)/);
  assert.match(calendarViewSource, /selectUniqueParentLinkedTaskNote\(/);
  assert.match(calendarViewSource, /"parent",\s+"parents",\s+"childOf"/);
  assert.match(calendarViewSource, /this\.calendarLinkReferencesFile\(value, candidate\.path, task\.file\)/);
  assert.match(calendarViewSource, /leftDate\.getUTCFullYear\(\) === rightDate\.getUTCFullYear\(\)/);
  assert.match(calendarViewSource, /leftDate\.getUTCMonth\(\) === rightDate\.getUTCMonth\(\)/);
  assert.match(calendarViewSource, /this\.findExternalEventForInlineTask\(task, this\.loadedExternalEvents\)/);
  assert.match(calendarViewSource, /this\.findAssociatedNoteForInlineTask\(inlineTask, calEntry\.startDate\)/);
  assert.match(calendarViewSource, /this\.findLinkedNoteForExternalEventInstance\(externalEvent, task, occurrenceDate\)/);
  assert.match(calendarViewSource, /const taskDate = occurrenceDate \|\| this\.parseFrontmatterDateValue\(task\.scheduledValue\)/);
  assert.match(calendarViewSource, /if \(!this\.areDatesLikelySameSlot\(noteDate, taskDate \|\| event\.startDate\)\) continue/);
  const inlineAssociationHelper = calendarViewSource.match(/private findLinkedNoteForExternalEventInstance[\s\S]*?private findExplicitAssociatedNoteForInlineTask/)?.[0] || "";
  assert.doesNotMatch(inlineAssociationHelper, /const storedUid = uidKey/);
  assert.doesNotMatch(inlineAssociationHelper, /storedUid === uid/);
  assert.match(calendarViewSource, /this\.app\.metadataCache\.getFirstLinkpathDest\(normalized, task\.file\.path\)/);
  assert.match(calendarViewSource, /this\.showInlineTaskOpenMenu\(mouseEvent, calEntry\)/);
});

test("calendar storage notes do not steal clicks from matching inline task events", () => {
  assert.match(calendarViewSource, /const inlineTaskEntries = await this\.collectInlineScheduledTaskEntries\(\)/);
  assert.match(calendarViewSource, /const hasMatchingInlineTaskEntry = shouldRenderEntry\s+\? this\.hasMatchingInlineScheduledTaskEntry\(inlineTaskEntries, entryFile, startDate, endDate, title, externalMatch\)/);
  assert.match(calendarViewSource, /else if \(shouldRenderEntry && !hasMatchingInlineTaskEntry\)/);
  assert.match(calendarViewSource, /if \(shouldRenderEntry && !hasMatchingInlineTaskEntry\) \{/);
  assert.match(calendarViewSource, /private hasMatchingInlineScheduledTaskEntry/);
  assert.match(calendarViewSource, /this\.buildExternalEventIdentityKey\(taskExternalId, taskSourceUrl\) === externalKey/);
  assert.match(calendarViewSource, /this\.normalizeExternalMatchTitle\(task\.title\) === normalizedTitle/);
});

test("calendar inline task events expose the GCM task context contract", () => {
  assert.match(reactViewSource, /data-tps-gcm-context", "calendar-task"/);
  assert.match(reactViewSource, /data-task-path", entryPath/);
  assert.match(reactViewSource, /data-task-line", taskLineNumber/);
  assert.match(reactViewSource, /data-tps-calendar-all-day", event\.allDay \? "true" : "false"/);
  assert.match(reactViewSource, /data-tps-calendar-start", event\.start \? event\.start\.toISOString\(\) : ""/);
  assert.match(reactViewSource, /lineNumber!? \+ 1/);
  assert.match(reactViewSource, /tps-calendar-task-entry/);
});

test("calendar inline task context menus cannot fall through to note rename actions", () => {
  const contextMenuSource = calendarViewSource.match(/private showEntryContextMenu[\s\S]*?private isDoneStatus/)?.[0] || "";
  const taskRouteSource = contextMenuSource.match(/const inlineTask[\s\S]*?if \(calEntry\?\.isArchivedExternalPlaceholder/)?.[0] || "";

  assert.match(taskRouteSource, /if \(calEntry && inlineTask && typeof inlineTask\.lineNumber === "number"\)/);
  assert.match(taskRouteSource, /"CalendarTaskMenu", "context-menu:task-route"/);
  assert.match(taskRouteSource, /route: "task-specific"/);
  assert.match(taskRouteSource, /this\.showInlineTaskOpenMenu\(evt, calEntry\);\s+return;/);
  assert.doesNotMatch(taskRouteSource, /openTaskLineContextMenu/);
  assert.doesNotMatch(taskRouteSource, /addGcmItemsToNativeMenu|workspace\.trigger\("file-menu"/);
});

test("calendar inline task events preserve checkbox states for event icons", () => {
  assert.match(calendarViewSource, /checkboxState: string/);
  assert.match(calendarViewSource, /line\.match\(\/\^\\s\*\[-\*\]\\s\+\\\[\(\[\^\\\]\]\*\)\\\]\\s\+\(\.\+\)\$\/\)/);
  assert.match(calendarViewSource, /iconName: this\.getInlineTaskCheckboxIconName\(task\.checkboxState\)/);
  assert.match(calendarViewSource, /\["checkboxState", task\.checkboxState\]/);
  assert.match(eventRendererSource, /getCheckboxStateIconName/);
  assert.match(eventRendererSource, /const inlineTask = \(\(props\.calendarEntry as any\)\?\.entry as any\)\?\.inlineTask/);
  assert.match(eventRendererSource, /const iconColor = inlineTask \? "" :/);
});

test("calendar inline task events dedupe by source task line", () => {
  assert.match(calendarViewSource, /const inlineTask = \(entry\.entry as any\)\?\.inlineTask as InlineScheduledTask \| undefined/);
  assert.match(calendarViewSource, /typeof inlineTask\.lineNumber === "number"/);
  assert.match(calendarViewSource, /`inline-task:\$\{inlineTask\.file\.path\}:\$\{inlineTask\.lineNumber\}:\$\{startTs\}:\$\{endTs\}`/);
  assert.match(calendarViewSource, /return `local:\$\{\(entry\.entry as any\)\.file\?\.path \|\| entry\.title \|\| "unknown"\}:\$\{startTs\}:\$\{endTs\}`/);
  assert.match(calendarViewSource, /const groupedCurrentEntries = this\.groupNearbyArchivedExternalPlaceholders\(/);
  assert.match(calendarViewSource, /private groupNearbyArchivedExternalPlaceholders\(entries: CalendarEntry\[\]\): CalendarEntry\[\]/);
  assert.match(calendarEventsHookSource, /const inlineTask = \(calEntry\.entry as any\)\?\.inlineTask as \{ lineNumber\?: number \} \| undefined/);
  assert.match(calendarEventsHookSource, /`inline-task-\$\{entryPath\}-\$\{inlineTask\.lineNumber\}-\$\{startDate\.getTime\(\)\}-\$\{endDate\.getTime\(\)\}`/);
  assert.match(calendarEventsHookSource, /inlineTaskEventId \?\? localEventId/);
});

test("calendar task drop confirmation labels the resolved task title", () => {
  assert.match(calendarViewSource, /const taskLine = await this\.resolveDraggedTaskLineInfo\(file, payload\);/);
  assert.match(calendarViewSource, /const taskLabel = taskLine\?\.title \|\| String\(payload\.text \|\| ""\)\.trim\(\) \|\| `\$\{file\.path\}:\$\{payload\.line\}`;/);
  assert.match(calendarViewSource, /`Task: \$\{taskLabel\}`/);
  assert.match(calendarViewSource, /private async resolveDraggedTaskLineInfo/);
  assert.match(calendarViewSource, /const title = this\.cleanInlineTaskTitle\(taskText\);/);
});

test("calendar drag-created daily-note tasks append to the note body", async () => {
  const newEventServiceSource = readFileSync(new URL("../src/services/new-event-service.ts", import.meta.url), "utf8");
  assert.match(newEventServiceSource, /createTaskInDailyNote/);
  assert.match(newEventServiceSource, /vault\.process\(dailyFile, \(content\) => \{/);
  assert.match(newEventServiceSource, /if \(externalId && this\.hasTaskWithExternalId\(content, externalId\)\)/);
  assert.match(newEventServiceSource, /return insertLineAfterFrontmatter\(content, taskLine\)/);
  assert.match(newEventServiceSource, /"task-line:skip-duplicate"/);
  assert.match(newEventServiceSource, /from "\.\.\/utils\/frontmatter-insert"/);
  assert.doesNotMatch(newEventServiceSource, /\$\{content\}\$\{taskLine\}\\n/);

  const { insertLineAfterFrontmatter } = await importFrontmatterInsertUtility();
  assert.equal(
    insertLineAfterFrontmatter("---\ntitle: Daily\n---\n\nExisting body\n", "- [ ] new task"),
    "---\ntitle: Daily\n---\n\nExisting body\n- [ ] new task\n",
  );
  assert.equal(
    insertLineAfterFrontmatter("Existing body\n", "- [ ] new task"),
    "Existing body\n- [ ] new task\n",
  );
});

test("calendar reschedules the current task line atomically without dropping concurrent metadata", async () => {
  const updateMethod = calendarViewSource.match(/private async updateInlineScheduledTask[\s\S]*?private replaceOrAppendInlineProperty/)?.[0] || "";
  assert.match(updateMethod, /this\.app\.vault\.process\(task\.file/);
  assert.match(updateMethod, /patchInlineTaskLineContent\(/);
  assert.match(updateMethod, /tpsId: task\.inlineProperties\.get\("tpsid"\)/);
  assert.match(updateMethod, /subitemId: task\.inlineProperties\.get\("subitemid"\)/);
  assert.doesNotMatch(updateMethod, /vault\.read|vault\.modify/);
  assert.match(inlineTaskLineUpdateSource, /"exact" \| "tpsId" \| "subitemId" \| "title"/);

  const { patchInlineTaskLineContent } = await importInlineTaskLineUpdateUtility();
  const inspectLine = (line) => {
    const match = line.match(/^\s*[-*]\s+\[[^\]]*]\s+(.+)$/);
    if (!match) return null;
    const read = (key) => line.match(new RegExp(`\\[${key}::\\s*([^\\]]+)]`, "i"))?.[1]?.trim();
    return {
      title: match[1]
        .replace(/\s*%%\s*tps-inline-props:[\s\S]*?\s*%%/g, "")
        .replace(/\s*\[[^\[\]:]+::\s*[^\]]+]/g, "")
        .trim(),
      tpsId: read("tpsId"),
      subitemId: read("subitemId"),
    };
  };
  const patchSchedule = (line) => line.replace(/\[scheduled::\s*[^\]]+]/i, "[scheduled:: 2026-07-15 09:30:00]");

  const staleLine = "- [ ] Write report [scheduled:: 2026-07-14 09:00:00] [tpsId:: task-1]";
  const liveLine = `${staleLine} %% tps-inline-props:{"associatedNotePath":"Notes/Write report.md"} %%`;
  const byId = patchInlineTaskLineContent(
    `Inserted concurrently\r\n${liveLine}\r\n`,
    { preferredLineIndex: 0, rawLine: staleLine, title: "Write report", tpsId: "task-1" },
    inspectLine,
    patchSchedule,
  );
  assert.equal(byId?.matchedBy, "tpsId");
  assert.equal(byId?.lineIndex, 1);
  assert.equal(
    byId?.content,
    `Inserted concurrently\r\n- [ ] Write report [scheduled:: 2026-07-15 09:30:00] [tpsId:: task-1] %% tps-inline-props:{"associatedNotePath":"Notes/Write report.md"} %%\r\n`,
  );

  const bySubitem = patchInlineTaskLineContent(
    "Header\n- [ ] Child task [scheduled:: 2026-07-14] [subitemId:: child-7]",
    { preferredLineIndex: 0, rawLine: "stale", title: "Child task", subitemId: "child-7" },
    inspectLine,
    patchSchedule,
  );
  assert.equal(bySubitem?.matchedBy, "subitemId");
  assert.equal(bySubitem?.content.endsWith("\n"), false);

  const exact = patchInlineTaskLineContent(
    `Header\n${staleLine}\n`,
    { preferredLineIndex: 0, rawLine: staleLine, title: "Write report" },
    inspectLine,
    patchSchedule,
  );
  assert.equal(exact?.matchedBy, "exact");
  assert.equal(exact?.lineIndex, 1);

  const mixedNewlines = patchInlineTaskLineContent(
    `Header\r\n${staleLine}\nTail`,
    { preferredLineIndex: 1, rawLine: staleLine, title: "Write report" },
    inspectLine,
    patchSchedule,
  );
  assert.equal(
    mixedNewlines?.content,
    "Header\r\n- [ ] Write report [scheduled:: 2026-07-15 09:30:00] [tpsId:: task-1]\nTail",
  );

  const byTitle = patchInlineTaskLineContent(
    "Header\n- [ ] Write report [scheduled:: 2026-07-14] %% tps-inline-props:{\"associatedNotePath\":\"Moved.md\"} %%",
    { preferredLineIndex: 0, rawLine: "stale", title: "Write report" },
    inspectLine,
    patchSchedule,
  );
  assert.equal(byTitle?.matchedBy, "title");
  assert.match(byTitle?.content || "", /associatedNotePath/);

  const ambiguous = patchInlineTaskLineContent(
    "- [ ] Same title [scheduled:: 2026-07-14]\n- [ ] Same title [scheduled:: 2026-07-15]",
    { preferredLineIndex: 8, rawLine: "stale", title: "Same title" },
    inspectLine,
    patchSchedule,
  );
  assert.equal(ambiguous, null);
});

test("calendar task titles stay plain and associations resolve hidden metadata before legacy links", async () => {
  assert.doesNotMatch(newEventServiceSource, /from "\.\.\/utils\/task-title-link"/);
  assert.match(newEventServiceSource, /const visibleTitle = String\(title \|\| this\.config\.defaultTitle \|\| "Untitled"\)/);
  assert.match(newEventServiceSource, /const parts = \[`- \[ \] \$\{visibleTitle\}`]/);
  assert.doesNotMatch(calendarViewSource, /amendScheduledTaskLineTitleAsContextLink/);
  assert.match(taskAssociatedNoteSource, /associatedNotePath/);
  assert.match(taskAssociatedNoteSource, /extractAssociatedNotePathFromHiddenMetadata/);

  const {
    getTaskAssociatedNoteCandidates,
    normalizeTaskAssociatedNotePath,
    selectUniqueParentLinkedTaskNote,
  } = await importTaskAssociatedNoteUtility();
  assert.deepEqual(
    getTaskAssociatedNoteCandidates(
      new Map([["associatednotepath", "Notes/Hidden Task.md"]]),
      "- [ ] [[Notes/Legacy Task#2026-06-26|Legacy Task]] [scheduled:: 2026-06-26]",
    ),
    [
      { path: "Notes/Hidden Task.md", source: "hidden" },
      { path: "Notes/Legacy Task", source: "legacy-link" },
    ],
  );
  assert.deepEqual(
    getTaskAssociatedNoteCandidates(
      new Map(),
      '- [ ] Plain task [scheduled:: 2026-06-26] %% tps-inline-props:{"associatedNotePath":"Notes/Comment Task.md"} %%',
    ),
    [{ path: "Notes/Comment Task.md", source: "hidden" }],
  );
  const encoded = encodeURIComponent(JSON.stringify({ associatedNotePath: "Notes/Encoded Task.md" }));
  assert.deepEqual(
    getTaskAssociatedNoteCandidates(new Map(), `- [ ] Plain task [tpsInlineProps:: ${encoded}]`),
    [{ path: "Notes/Encoded Task.md", source: "hidden" }],
  );
  assert.deepEqual(
    getTaskAssociatedNoteCandidates(new Map(), "- [ ] [Legacy Task](Notes/Legacy%20Task.md) [scheduled:: 2026-06-26]"),
    [{ path: "Notes/Legacy Task.md", source: "legacy-link" }],
  );
  assert.deepEqual(
    getTaskAssociatedNoteCandidates(new Map(), "- [ ] Review [[Reference]] later [scheduled:: 2026-06-26]"),
    [],
  );
  assert.deepEqual(
    getTaskAssociatedNoteCandidates(new Map(), "- [ ] [Website](https://example.com) [scheduled:: 2026-06-26]"),
    [],
  );
  assert.equal(normalizeTaskAssociatedNotePath("[[Notes/Task.md#Details|Task]]"), "Notes/Task.md");

  const movedChild = {
    path: "Archive/Renamed child.md",
    frontmatterTitle: "[[Write report#Notes|Write report]]",
    basename: "Renamed child",
    parentPath: "Daily/2026-07-14.md",
  };
  assert.equal(
    selectUniqueParentLinkedTaskNote(
      [movedChild],
      "Write report",
      (candidate) => [candidate.frontmatterTitle, candidate.basename],
      (candidate) => candidate.parentPath === "Daily/2026-07-14.md",
    ),
    movedChild,
  );
  assert.equal(
    selectUniqueParentLinkedTaskNote(
      [movedChild, { ...movedChild, path: "Archive/Other child.md" }],
      "Write report",
      (candidate) => [candidate.frontmatterTitle, candidate.basename],
      () => true,
    ),
    null,
  );
  assert.equal(
    selectUniqueParentLinkedTaskNote(
      [movedChild],
      "Write report",
      (candidate) => [candidate.frontmatterTitle, candidate.basename],
      () => false,
    ),
    null,
  );
});

test("external calendar task titles stay plain while the URL remains task metadata", () => {
  const titleBuilder = calendarViewSource.match(/private buildExternalEventTaskTitle[\s\S]*?private buildExternalEventTaskOverrides/)?.[0] || "";
  assert.match(titleBuilder, /return this\.escapeMarkdownLinkText\(event\.title \|\| "External calendar event"\)/);
  assert.doesNotMatch(titleBuilder, /event\.url|encodeMarkdownLinkTarget|`\[\$\{title\}\]/);
  assert.match(calendarViewSource, /if \(event\.url\) overrides\.url = event\.url/);
});

test("calendar creation uses Base task filters as task defaults without leaking them to note frontmatter", async () => {
  const newEventServiceSource = readFileSync(new URL("../src/services/new-event-service.ts", import.meta.url), "utf8");
  assert.match(newEventServiceSource, /taskTargetPath\?: string \| null/);
  assert.match(newEventServiceSource, /taskTags\?: string\[\]/);
  assert.match(newEventServiceSource, /taskStatus\?: string \| null/);
  assert.match(newEventServiceSource, /taskAssociatedNotePath\?: string \| null/);
  assert.match(newEventServiceSource, /createTaskInDailyNote\(taskTitle, start, end, taskTags, taskOverrides, resolvedTaskTargetPath, options\?\.allDay\)/);
  assert.match(newEventServiceSource, /normalized === "associatednotepath"/);
  assert.match(newEventServiceSource, /private async ensureTaskTargetFile\(rawPath: string\): Promise<TFile>/);
  assert.match(newEventServiceSource, /normalizeCalendarTaskTargetPath\(this\.config\.taskTargetPath\)/);

  assert.match(calendarViewSource, /from "\.\/utils\/filter-creation-defaults"/);
  const createOptionsSource = readFileSync(new URL("../src/utils/calendar-create-options.ts", import.meta.url), "utf8");
  assert.match(createOptionsSource, /frontmatterDefaults: args\.creationDefaults\.frontmatter/);
  assert.match(createOptionsSource, /taskTags: args\.taskDefaults\.tags/);
  assert.match(createOptionsSource, /taskStatus: args\.taskDefaults\.status/);
  assert.match(createOptionsSource, /taskTargetPath: args\.taskDefaults\.targetPath/);
  assert.match(createOptionsSource, /typeFolderOverride: args\.creationDefaults\.folderPath/);
  assert.match(calendarViewSource, /return extractCalendarCreationModeFromFilters\(filters\)/);
  assert.match(calendarViewSource, /extractCalendarTaskLineDefaultsFromFilters\(filters,/);
  assert.match(calendarViewSource, /private buildCalendarNewEventOptions\(/);
  assert.match(calendarViewSource, /private extractCreationModeFromFilters\(filters: unknown\[\]\): "note" \| "task" \| null/);
  assert.match(calendarViewSource, /private resolveEffectiveCreateMode\(filters: unknown\[\]\): "note" \| "task"/);
  assert.match(calendarViewSource, /const createMode = this\.resolveEffectiveCreateMode\(filterSources\)/);
  assert.match(calendarViewSource, /if \(createMode === "task"\) \{/);
  assert.match(calendarViewSource, /property\.startsWith\("task\."\)/);
  assert.match(calendarViewSource, /property\.startsWith\("line\."\)/);
  assert.match(calendarViewSource, /property\.startsWith\("block\."\)/);
  assert.match(calendarViewSource, /this\.plugin\.settings\.taskCreateDestination/);
  assert.match(calendarViewSource, /this\.plugin\.settings\.taskCreateTargetPath/);

  const {
    extractCalendarCreationModeFromFilters,
    extractCalendarTaskLineDefaultsFromFilters,
  } = await importFilterCreationDefaultsUtility();

  assert.equal(
    extractCalendarCreationModeFromFilters([
      { and: [{ property: "note.kind", operator: "is", value: "note" }] },
      { and: [{ property: "task.kind", operator: "is", value: "task" }] },
    ]),
    "note",
    "the active-view mode should win before lower-priority all-view defaults",
  );
  assert.equal(
    extractCalendarCreationModeFromFilters([
      { and: [{ property: "task.kind", operator: "is", value: "task-item" }] },
    ]),
    "task",
  );
  for (const semanticKind of ["run", "workout", "food", "log", "meeting"]) {
    assert.equal(
      extractCalendarCreationModeFromFilters([
        { and: [{ property: "kind", operator: "is", value: semanticKind }] },
      ]),
      "note",
      `bare semantic kind ${semanticKind} should create a note record`,
    );
  }
  assert.equal(
    extractCalendarCreationModeFromFilters([
      { and: [{ property: "task.kind", operator: "is", value: "workout" }] },
    ]),
    "task",
    "an explicit task namespace remains task-line mode even with a semantic value",
  );
  assert.equal(
    extractCalendarCreationModeFromFilters([
      { and: [{ property: "kind", operator: "is", value: "mixed" }] },
    ]),
    null,
    "mixed/all structural kinds continue to defer to the configured default",
  );
  assert.equal(
    extractCalendarCreationModeFromFilters([
      {
        or: [
          { property: "note.kind", operator: "is", value: "note" },
          { property: "task.kind", operator: "is", value: "task" },
        ],
      },
    ]),
    "note",
    "the first matching or/any branch supplies the creation mode",
  );

  assert.deepEqual(
    extractCalendarTaskLineDefaultsFromFilters([
      {
        or: [
          {
            and: [
              { property: "task.status", operator: "is", value: "Next" },
              { property: "task.path", operator: "is", value: "[[Inbox/Active Tasks|Active]]" },
            ],
          },
          {
            and: [
              { property: "task.status", operator: "is", value: "Later" },
              { property: "task.path", operator: "is", value: "Inbox/Later Tasks.md" },
            ],
          },
        ],
      },
      {
        and: [
          { property: "tags", operator: "is", value: "#deep work" },
          { property: "note.status", operator: "is", value: "draft" },
        ],
      },
    ]),
    {
      tags: ["deep-work"],
      status: "next",
      targetPath: "Inbox/Active Tasks.md",
    },
    "current-view branch defaults win first; lower-priority sources fill missing fields only",
  );

  assert.deepEqual(
    extractCalendarTaskLineDefaultsFromFilters([
      {
        any: [
          { property: "note.status", operator: "is", value: "draft" },
          { property: "task.path", operator: "is", value: "Inbox/Skipped.md" },
        ],
      },
      {
        and: [
          { property: "path", operator: "is", value: "Inbox/Fallback.md" },
          { property: "status", operator: "is", value: "open" },
        ],
      },
    ]),
    {
      tags: [],
      status: "open",
      targetPath: "Inbox/Fallback.md",
    },
    "ordered any/or branches should not borrow defaults from later alternate branches",
  );

  assert.deepEqual(
    extractCalendarTaskLineDefaultsFromFilters([
      {
        and: [
          { property: "task.path", operator: "is", value: "Inbox/A.md" },
          { property: "task.path", operator: "is", value: "Inbox/B.md" },
          { property: "note.tags", operator: "is", value: "#note-only" },
        ],
      },
      { property: "task.path", operator: "is", value: "Inbox/Resolved.md" },
    ]),
    {
      tags: [],
      status: null,
      targetPath: "Inbox/Resolved.md",
    },
    "ambiguous source paths are ignored so lower-priority unambiguous paths can fill the target",
  );
});

test("task target paths fall back to settings and normalize link-shaped values", async () => {
  assert.match(taskTargetPathSource, /export function normalizeCalendarTaskTargetPath/);
  assert.match(newEventServiceSource, /optionTaskTargetPath \|\| normalizeCalendarTaskTargetPath\(this\.config\.taskTargetPath\) \|\| null/);
  assert.match(calendarViewSource, /private async openCreatedFileIfConfigured\(file: TFile, createMode: "note" \| "task"\): Promise<void>/);
  assert.match(calendarViewSource, /createMode === "task" && this\.plugin\.settings\.openTaskDestinationAfterCreate === false/);
  assert.match(calendarViewSource, /private handleCalendarBaseToolbarCreateClick\(evt: MouseEvent\): void/);
  assert.match(calendarViewSource, /const createOwner = this\.getCalendarBaseToolbarCreateOwner\(target\)/);
  assert.match(calendarViewSource, /private getCalendarBaseToolbarCreateOwner\(target: HTMLElement\): HTMLElement \| null/);
  assert.match(calendarViewSource, /"\.tps-home-panel"/);
  assert.match(calendarViewSource, /if \(owner\) return owner\.contains\(this\.containerEl\) \? owner : null/);
  assert.match(calendarViewSource, /const calendarRoots = Array\.from\(leaf\.querySelectorAll<HTMLElement>\("\.bases-calendar-container"\)\)/);
  assert.match(calendarViewSource, /calendarRoots\.length !== 1 \|\| calendarRoots\[0\] !== this\.containerEl/);
  assert.match(calendarViewSource, /!headerEl \|\| !createOwner\.contains\(headerEl\)/);
  assert.match(calendarViewSource, /"toolbar-owner-claimed"/);
  assert.match(calendarViewSource, /this\.registerDomEvent\(document, "click", \(evt: MouseEvent\) => \{/);
  assert.match(calendarViewSource, /void this\.handleCalendarBaseToolbarCreateClick\(evt\)/);
  assert.match(calendarViewSource, /evt\.stopImmediatePropagation\(\)/);
  assert.match(calendarViewSource, /this\.createFileForView\(\)/);
  assert.doesNotMatch(calendarViewSource, /this\.containerEl\.contains\(target\)\) return/);
  assert.doesNotMatch(calendarViewSource, /leaf\.openFile\(created\)/);

  const { normalizeCalendarTaskTargetPath } = await importTaskTargetPathUtility();
  assert.equal(normalizeCalendarTaskTargetPath("Inbox/Tasks"), "Inbox/Tasks.md");
  assert.equal(normalizeCalendarTaskTargetPath("[[Inbox/Tasks|Task Inbox]]"), "Inbox/Tasks.md");
  assert.equal(normalizeCalendarTaskTargetPath("[Task Inbox](Inbox/Tasks.md#Today)"), "Inbox/Tasks.md");
  assert.equal(normalizeCalendarTaskTargetPath("/Inbox/Tasks#Today"), "Inbox/Tasks.md");
  assert.equal(normalizeCalendarTaskTargetPath(""), null);
});

test("follow-active-note jumps only when a focused markdown file changes", () => {
  assert.match(calendarViewSource, /this\.app\.workspace\.on\("active-leaf-change"/);
  assert.match(calendarViewSource, /this\.app\.workspace\.on\("file-open"/);
  assert.match(calendarViewSource, /this\.registerDomEvent\(this\.containerEl, "pointerdown"/);
  assert.match(calendarViewSource, /private cancelPendingActiveNoteFollow\(\): void/);
  assert.match(calendarViewSource, /window\.clearTimeout\(this\.activeNoteFollowTimer\);/);
  assert.match(calendarViewSource, /private scheduleFollowActiveNoteDay\(file\?: TFile \| null/);
  assert.match(calendarViewSource, /private followActiveNoteDay\(file: TFile \| null \| undefined\)/);
  assert.match(calendarViewSource, /const followKey = `\$\{file\.path\}::\$\{dateKey\}`;/);
  assert.match(calendarViewSource, /if \(this\.activeNoteFollowLastAppliedKey === followKey\) return;/);
  assert.match(calendarViewSource, /this\.jumpTargetDate = new Date\(detectedDate\);/);
  assert.match(calendarViewSource, /private resolveFocusedNoteDate\(file: TFile\): Date \| null/);
  assert.match(calendarViewSource, /this\.extractContextDateFromFrontmatter\(file\.path\)/);
  assert.match(calendarViewSource, /this\.extractDateFromPath\(file\.path\)/);
  assert.match(calendarViewSource, /onDateChange=\{\(date\) => \{[\s\S]*this\.cancelPendingActiveNoteFollow\(\);[\s\S]*this\.currentDate = date;[\s\S]*this\.persistCurrentDate\(date\);/);
});

import fs from "node:fs";
import path from "node:path";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const includeWorkouts = args.has("--include-workouts");
const explicitSources = process.argv
  .slice(2)
  .filter((arg) => !arg.startsWith("--"))
  .map((arg) => arg.replace(/^\/+/, ""));

const pluginDir = path.resolve(new URL(".", import.meta.url).pathname, "..");
const vaultRoot = path.resolve(pluginDir, "../../..");
const dailyConfigPath = path.join(vaultRoot, ".obsidian", "daily-notes.json");

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

const dailyConfig = readJson(dailyConfigPath, {});
const dailyFormat = String(dailyConfig.format || "YYYY-MM-DD").trim() || "YYYY-MM-DD";
const dailyFolder = normalizeVaultPath(String(dailyConfig.folder || "").trim());

function normalizeVaultPath(value) {
  return String(value || "").replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, "");
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function formatDailyName(date) {
  const replacements = {
    YYYY: String(date.getFullYear()),
    MMM: MONTH_NAMES[date.getMonth()],
    MM: pad2(date.getMonth() + 1),
    M: String(date.getMonth() + 1),
    ddd: DAY_NAMES[date.getDay()],
    DD: pad2(date.getDate()),
    D: String(date.getDate()),
  };

  return dailyFormat.replace(/YYYY|MMM|MM|M|ddd|DD|D/g, (token) => replacements[token] ?? token);
}

function dailyPathForDate(dateKey) {
  const [year, month, day] = dateKey.split("-").map((part) => Number.parseInt(part, 10));
  if (!year || !month || !day) return null;
  const date = new Date(year, month - 1, day);
  if (!Number.isFinite(date.getTime())) return null;
  const filename = `${formatDailyName(date)}.md`;
  return normalizeVaultPath(dailyFolder ? `${dailyFolder}/${filename}` : filename);
}

function isDailyNotePath(vaultPath) {
  const basename = path.basename(vaultPath, ".md");
  const dateKey = extractDateFromTaskLine(`- [ ] probe [scheduled:: ${basename}]`);
  if (dateKey) return true;

  for (let year = 2025; year <= 2027; year += 1) {
    for (let month = 0; month < 12; month += 1) {
      for (let day = 1; day <= 31; day += 1) {
        const date = new Date(year, month, day);
        if (date.getMonth() !== month) continue;
        const candidate = normalizeVaultPath(dailyFolder ? `${dailyFolder}/${formatDailyName(date)}.md` : `${formatDailyName(date)}.md`);
        if (candidate === vaultPath) return true;
      }
    }
  }
  return false;
}

function walkMarkdownFiles(dir, result = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === "node_modules") continue;
    if (entry.name === ".obsidian" || entry.name === "Archive") continue;
    if (entry.name.startsWith(".") && dir === vaultRoot) continue;
    const absolutePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkMarkdownFiles(absolutePath, result);
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      result.push(absolutePath);
    }
  }
  return result;
}

function extractDateFromTaskLine(line) {
  const inline = line.match(/\[(?:scheduled|scheduleddate|scheduled-date|due|duedate|due-date|start|startdate|start-date)::\s*(\d{4}-\d{2}-\d{2})/i);
  if (inline) return inline[1];
  const emoji = line.match(/[⏳📅]\s*(\d{4}-\d{2}-\d{2})/);
  if (emoji) return emoji[1];
  const kanban = line.match(/@\{(\d{4}-\d{2}-\d{2})\}/);
  if (kanban) return kanban[1];
  return null;
}

function calendarTaskIdentity(line) {
  const externalId = line.match(/\[externalEventId::\s*([^\]]+)\]/i)?.[1]?.trim();
  if (externalId) return `external:${externalId}`;
  const uid = line.match(/\[tpsCalendarUid::\s*([^\]]+)\]/i)?.[1]?.trim();
  const scheduled = line.match(/\[scheduled::\s*([^\]]+)\]/i)?.[1]?.trim();
  if (uid && scheduled) return `uid:${uid}:${scheduled}`;
  return `line:${line.trim()}`;
}

function isCalendarTaskLine(line) {
  return /^- \[[^\]]*\]\s+/.test(line)
    && /\[(?:externalEventId|tpsCalendarUid|tpsCalendarSourceUrl|scheduled|scheduleddate|scheduled-date)::/i.test(line)
    && !!extractDateFromTaskLine(line);
}

function ensureDailyNote(vaultPath, dateKey) {
  const absolutePath = path.join(vaultRoot, vaultPath);
  if (fs.existsSync(absolutePath)) return absolutePath;
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  const title = path.basename(vaultPath, ".md");
  const content = [
    "---",
    `title: ${title}`,
    `scheduled: ${dateKey}`,
    "tags:",
    "  - dailynote",
    "---",
    "",
  ].join("\n");
  fs.writeFileSync(absolutePath, content, "utf8");
  return absolutePath;
}

function appendLines(existingContent, lines) {
  const trimmedEnd = existingContent.replace(/\s*$/u, "");
  const prefix = trimmedEnd ? `${trimmedEnd}\n\n` : "";
  return `${prefix}${lines.join("\n")}\n`;
}

function collectSourceFiles() {
  if (explicitSources.length > 0) {
    return explicitSources.map((source) => path.join(vaultRoot, source));
  }
  return walkMarkdownFiles(vaultRoot).filter((absolutePath) => {
    const vaultPath = normalizeVaultPath(path.relative(vaultRoot, absolutePath));
    if (isDailyNotePath(vaultPath)) return false;
    if (!includeWorkouts && /^Workouts\.md$/i.test(vaultPath)) return false;
    const content = fs.readFileSync(absolutePath, "utf8");
    return content.split("\n").some(isCalendarTaskLine);
  });
}

const sourceFiles = collectSourceFiles();
const targetAdds = new Map();
const sourceRemovals = new Map();
const seenGlobal = new Set();

for (const sourceFile of sourceFiles) {
  if (!fs.existsSync(sourceFile)) {
    console.warn(`Missing source: ${path.relative(vaultRoot, sourceFile)}`);
    continue;
  }
  const vaultPath = normalizeVaultPath(path.relative(vaultRoot, sourceFile));
  const lines = fs.readFileSync(sourceFile, "utf8").split("\n");
  const removeLineIndexes = new Set();

  lines.forEach((line, index) => {
    if (!isCalendarTaskLine(line)) return;
    const dateKey = extractDateFromTaskLine(line);
    const targetPath = dateKey ? dailyPathForDate(dateKey) : null;
    if (!targetPath) return;
    const identity = calendarTaskIdentity(line);
    const globalIdentity = `${targetPath}:${identity}`;
    if (seenGlobal.has(globalIdentity)) {
      removeLineIndexes.add(index);
      return;
    }
    seenGlobal.add(globalIdentity);
    if (!targetAdds.has(targetPath)) targetAdds.set(targetPath, []);
    targetAdds.get(targetPath).push({ line, identity, source: vaultPath, index });
    removeLineIndexes.add(index);
  });

  if (removeLineIndexes.size > 0) {
    sourceRemovals.set(sourceFile, removeLineIndexes);
  }
}

let appendedCount = 0;
let skippedExistingCount = 0;
const createdTargets = [];

for (const [targetPath, items] of targetAdds.entries()) {
  const dateKey = extractDateFromTaskLine(items[0]?.line || "");
  const absoluteTarget = apply ? ensureDailyNote(targetPath, dateKey) : path.join(vaultRoot, targetPath);
  const existingContent = fs.existsSync(absoluteTarget) ? fs.readFileSync(absoluteTarget, "utf8") : "";
  const existingIdentities = new Set(
    existingContent
      .split("\n")
      .filter(isCalendarTaskLine)
      .map(calendarTaskIdentity),
  );
  const linesToAppend = [];
  for (const item of items) {
    if (existingIdentities.has(item.identity)) {
      skippedExistingCount += 1;
      continue;
    }
    existingIdentities.add(item.identity);
    linesToAppend.push(item.line);
  }
  if (linesToAppend.length === 0) continue;
  appendedCount += linesToAppend.length;
  if (!fs.existsSync(absoluteTarget)) createdTargets.push(targetPath);
  if (apply) {
    fs.writeFileSync(absoluteTarget, appendLines(existingContent, linesToAppend), "utf8");
  }
}

let removedCount = 0;
for (const [sourceFile, indexes] of sourceRemovals.entries()) {
  const lines = fs.readFileSync(sourceFile, "utf8").split("\n");
  const updatedLines = lines.filter((_line, index) => !indexes.has(index));
  removedCount += indexes.size;
  if (apply) {
    fs.writeFileSync(sourceFile, updatedLines.join("\n").replace(/\n*$/u, "\n"), "utf8");
  }
}

const sourceSummary = sourceFiles.map((file) => normalizeVaultPath(path.relative(vaultRoot, file)));
console.log(`${apply ? "Applied" : "Dry run"} calendar task migration`);
console.log(`Sources: ${sourceSummary.length ? sourceSummary.join(", ") : "(none)"}`);
console.log(`Target daily notes: ${targetAdds.size}`);
console.log(`Lines appended: ${appendedCount}`);
console.log(`Lines skipped because already present: ${skippedExistingCount}`);
console.log(`Source lines removed: ${removedCount}`);
if (createdTargets.length) {
  console.log(`Created daily notes: ${createdTargets.join(", ")}`);
}
if (!apply) {
  console.log("Run again with --apply to write changes.");
}

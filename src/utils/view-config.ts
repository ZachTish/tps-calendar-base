export function resolveShowNowIndicator(
  viewValue: unknown,
  globalValue: boolean | undefined,
): boolean {
  if (typeof viewValue === "boolean") return viewValue;
  if (typeof viewValue === "string") {
    const normalized = viewValue.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return globalValue !== false;
}

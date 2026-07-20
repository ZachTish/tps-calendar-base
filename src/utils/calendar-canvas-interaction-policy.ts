export interface CalendarCanvasInteractionPolicyInput {
  isCanvasEmbed: boolean;
  editable: boolean;
  canCreateSelection: boolean;
  canAcceptExternalDrop: boolean;
  showNowIndicator: boolean;
}

export interface CalendarCanvasInteractionPolicy {
  allowEdit: boolean;
  allowSelect: boolean;
  allowExternalDrop: boolean;
  allowNowIndicator: boolean;
  showCanvasReliabilityNotice: boolean;
}

/**
 * FullCalendar does not support a transformed ancestor coordinate space.
 * Keep Canvas embeds useful for navigation and identity-based actions, but
 * fail closed for interactions whose result is derived from pointer geometry.
 */
export function resolveCalendarCanvasInteractionPolicy(
  input: CalendarCanvasInteractionPolicyInput,
): CalendarCanvasInteractionPolicy {
  const coordinatesAreReliable = !input.isCanvasEmbed;
  return {
    allowEdit: coordinatesAreReliable && input.editable,
    allowSelect: coordinatesAreReliable && input.canCreateSelection,
    allowExternalDrop: coordinatesAreReliable && input.canAcceptExternalDrop,
    allowNowIndicator: coordinatesAreReliable && input.showNowIndicator,
    showCanvasReliabilityNotice: input.isCanvasEmbed,
  };
}

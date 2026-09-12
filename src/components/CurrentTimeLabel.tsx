import React, { useEffect, useState } from "react";
import type { NowIndicatorContentArg } from "@fullcalendar/core";
import { startCurrentTimeClock } from "../utils/current-time-clock";

export function renderCurrentTimeLabel(arg: NowIndicatorContentArg, hour12: boolean) {
  if (arg.isAxis) return null;
  // FullCalendar 6.1.19 passes the column's midnight as a line hook's date.
  // Keep our display clock independent of that value and of event refreshes.
  return <CurrentTimeLabel calendar={arg.view.calendar} hour12={hour12} />;
}

function CurrentTimeLabel({ calendar, hour12 }: {
  calendar: NowIndicatorContentArg["view"]["calendar"];
  hour12: boolean;
}) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => startCurrentTimeClock(setNow), []);
  return <span className="tps-calendar-current-time-label">{formatCurrentTimeLabel(calendar, now, hour12)}</span>;
}

export function formatCurrentTimeLabel(
  calendar: NowIndicatorContentArg["view"]["calendar"], now: Date, hour12: boolean,
) {
  return calendar.formatDate(now, {
    hour: "numeric",
    minute: "2-digit",
    hour12,
    meridiem: hour12 ? "short" : false,
  });
}

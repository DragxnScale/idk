"use client";

import { useEffect, useState } from "react";

interface DayData {
  date: string;
  minutes: number;
}

function getColor(minutes: number): string {
  if (minutes === 0) return "bg-gray-100 dark:bg-gray-800";
  if (minutes < 20) return "bg-blue-200 dark:bg-blue-900";
  if (minutes < 45) return "bg-blue-400 dark:bg-blue-700";
  if (minutes < 90) return "bg-blue-600 dark:bg-blue-500";
  return "bg-blue-800 dark:bg-blue-300";
}

const MONTH_LABELS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const DAY_LABELS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

export function HeatmapCalendar() {
  const [days, setDays] = useState<DayData[]>([]);
  const [tooltip, setTooltip] = useState<{ date: string; minutes: number } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/user/heatmap")
      .then((r) => r.ok ? r.json() : { days: [] })
      .then((data) => { setDays(data.days ?? []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="h-24 flex items-center justify-center text-sm text-gray-400 animate-pulse">Loading activity…</div>;
  }

  if (days.length === 0) return null;

  // Group into weeks (columns). First day may not start on Sunday, pad it.
  const firstDay = new Date(days[0].date);
  const startPad = firstDay.getDay(); // 0=Sun
  const weeks: (DayData | null)[][] = [];
  let week: (DayData | null)[] = Array(startPad).fill(null);

  for (const day of days) {
    week.push(day);
    if (week.length === 7) {
      weeks.push(week);
      week = [];
    }
  }
  if (week.length > 0) {
    while (week.length < 7) week.push(null);
    weeks.push(week);
  }

  // Determine where each month label should appear (column index of first occurrence)
  const monthPositions: { col: number; label: string }[] = [];
  let lastMonth = -1;
  weeks.forEach((w, col) => {
    const firstReal = w.find((d) => d !== null);
    if (firstReal) {
      const m = new Date(firstReal.date).getMonth();
      if (m !== lastMonth) {
        monthPositions.push({ col, label: MONTH_LABELS[m] });
        lastMonth = m;
      }
    }
  });

  return (
    <div className="relative overflow-x-auto">
      {/* Month labels */}
      <div className="flex gap-[3px] mb-1 pl-8">
        {weeks.map((_, col) => {
          const mp = monthPositions.find((m) => m.col === col);
          return (
            <div key={col} className="w-3 shrink-0 text-[9px] text-gray-400 dark:text-gray-500 whitespace-nowrap">
              {mp ? mp.label : ""}
            </div>
          );
        })}
      </div>
      <div className="flex gap-[3px]">
        {/* Day-of-week labels */}
        <div className="flex flex-col gap-[3px] mr-1">
          {DAY_LABELS.map((d, i) => (
            <div key={d} className={`w-6 h-3 flex items-center text-[9px] text-gray-400 dark:text-gray-500 ${i % 2 === 1 ? "" : "opacity-0"}`}>
              {d}
            </div>
          ))}
        </div>
        {/* Grid */}
        {weeks.map((w, col) => (
          <div key={col} className="flex flex-col gap-[3px]">
            {w.map((day, row) => (
              <div
                key={row}
                className={`w-3 h-3 rounded-[2px] cursor-default transition-opacity ${day ? getColor(day.minutes) : "opacity-0"}`}
                onMouseEnter={() => day && setTooltip(day)}
                onMouseLeave={() => setTooltip(null)}
              />
            ))}
          </div>
        ))}
      </div>
      {/* Tooltip */}
      {tooltip && (
        <div className="absolute top-0 right-0 bg-gray-900 text-white text-xs rounded px-2 py-1 pointer-events-none z-10">
          {tooltip.date}: {tooltip.minutes} min
        </div>
      )}
      {/* Legend */}
      <div className="flex items-center gap-1.5 mt-2 justify-end">
        <span className="text-[9px] text-gray-400">Less</span>
        {[0, 10, 30, 60, 100].map((m) => (
          <div key={m} className={`w-3 h-3 rounded-[2px] ${getColor(m)}`} />
        ))}
        <span className="text-[9px] text-gray-400">More</span>
      </div>
    </div>
  );
}

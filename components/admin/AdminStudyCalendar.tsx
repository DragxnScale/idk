"use client";

import { useEffect, useRef } from "react";
import { isTypingTarget } from "@/lib/is-typing-target";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

interface DayBucket {
  minutes: number;
  sessions: number;
}

interface DayCell {
  date: string;
  minutes: number;
  sessions: number;
}

function getColor(minutes: number): string {
  if (minutes === 0) return "bg-gray-800";
  if (minutes < 20) return "bg-blue-900/70";
  if (minutes < 45) return "bg-blue-700";
  if (minutes < 90) return "bg-blue-600";
  return "bg-blue-500";
}

function todayKey(): string {
  const t = new Date();
  t.setHours(0, 0, 0, 0);
  return t.toISOString().slice(0, 10);
}

function daysInMonth(
  year: number,
  month: number,
  minutesByDay: Record<string, DayBucket>
): DayCell[] {
  const days: DayCell[] = [];
  const d = new Date(Date.UTC(year, month - 1, 1));
  while (d.getUTCMonth() === month - 1) {
    const dateStr = d.toISOString().slice(0, 10);
    const bucket = minutesByDay[dateStr];
    days.push({
      date: dateStr,
      minutes: bucket?.minutes ?? 0,
      sessions: bucket?.sessions ?? 0,
    });
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return days;
}

/** Compact label for inside a calendar cell. */
function compactTime(minutes: number): string {
  if (minutes >= 60) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m > 0 ? `${h}h${m}m` : `${h}h`;
  }
  return `${minutes}m`;
}

export interface AdminStudyCalendarProps {
  minutesByDay: Record<string, DayBucket>;
  year: number;
  month: number;
  onMonthChange: (year: number, month: number) => void;
  minYear: number;
  minMonth: number;
  maxYear: number;
  maxMonth: number;
  fmtHms: (minutes: number) => string;
}

export function AdminStudyCalendar({
  minutesByDay,
  year,
  month,
  onMonthChange,
  minYear,
  minMonth,
  maxYear,
  maxMonth,
  fmtHms,
}: AdminStudyCalendarProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const monthDays = daysInMonth(year, month, minutesByDay);
  const firstOfMonth = new Date(Date.UTC(year, month - 1, 1));
  const leadPad = firstOfMonth.getUTCDay();
  const cells: (DayCell | null)[] = [];
  for (let i = 0; i < leadPad; i++) cells.push(null);
  for (const d of monthDays) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const canGoBack = year > minYear || (year === minYear && month > minMonth);
  const canGoForward = year < maxYear || (year === maxYear && month < maxMonth);

  const goPrev = () => {
    if (!canGoBack) return;
    if (month === 1) onMonthChange(year - 1, 12);
    else onMonthChange(year, month - 1);
  };
  const goNext = () => {
    if (!canGoForward) return;
    if (month === 12) onMonthChange(year + 1, 1);
    else onMonthChange(year, month + 1);
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      if (isTypingTarget(e.target)) return;
      if (!containerRef.current?.contains(document.activeElement)) return;

      e.preventDefault();
      if (e.key === "ArrowLeft") {
        if (!canGoBack) return;
        if (month === 1) onMonthChange(year - 1, 12);
        else onMonthChange(year, month - 1);
      } else {
        if (!canGoForward) return;
        if (month === 12) onMonthChange(year + 1, 1);
        else onMonthChange(year, month + 1);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [canGoBack, canGoForward, year, month, onMonthChange]);

  const totalMinutes = monthDays.reduce((s, d) => s + d.minutes, 0);
  const totalSessions = monthDays.reduce((s, d) => s + d.sessions, 0);
  const activeDays = monthDays.filter((d) => d.minutes > 0).length;
  const today0 = todayKey();

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      role="group"
      aria-label={`Study calendar for ${MONTH_NAMES[month - 1]} ${year}. Use arrow keys to change month.`}
      className="outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900 rounded-lg"
    >
      <div className="flex items-center justify-between mb-3">
        <button
          type="button"
          onClick={goPrev}
          disabled={!canGoBack}
          className="rounded-lg p-1.5 text-gray-400 hover:text-white hover:bg-gray-800 transition disabled:opacity-30 disabled:hover:bg-transparent"
          aria-label="Previous month"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
            <path fillRule="evenodd" d="M12.79 5.23a.75.75 0 0 1 0 1.06L9.06 10l3.73 3.71a.75.75 0 1 1-1.06 1.06l-4.25-4.24a.75.75 0 0 1 0-1.06l4.25-4.24a.75.75 0 0 1 1.06 0Z" clipRule="evenodd" />
          </svg>
        </button>
        <h4 className="text-sm font-semibold tabular-nums">
          {MONTH_NAMES[month - 1]} {year}
        </h4>
        <button
          type="button"
          onClick={goNext}
          disabled={!canGoForward}
          className="rounded-lg p-1.5 text-gray-400 hover:text-white hover:bg-gray-800 transition disabled:opacity-30 disabled:hover:bg-transparent"
          aria-label="Next month"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
            <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 0 1 0-1.06L10.94 10 7.21 6.29a.75.75 0 0 1 1.06-1.06l4.25 4.24a.75.75 0 0 1 0 1.06l-4.25 4.24a.75.75 0 0 1-1.06 0Z" clipRule="evenodd" />
          </svg>
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1 mb-1">
        {DAY_LABELS.map((d) => (
          <div key={d} className="text-[10px] text-gray-500 text-center font-medium">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((cell, i) => {
          if (!cell) {
            return <div key={i} className="aspect-square" />;
          }
          const isToday = cell.date === today0;
          const isFuture = cell.date > today0;
          return (
            <div
              key={i}
              className={`aspect-square rounded-md flex flex-col items-center justify-center text-[11px] relative ${
                isFuture
                  ? "bg-transparent text-gray-700"
                  : `${getColor(cell.minutes)} ${
                      cell.minutes >= 90 ? "text-white" : "text-gray-200"
                    }`
              } ${isToday ? "ring-2 ring-blue-400" : ""}`}
              title={
                isFuture
                  ? cell.date
                  : `${cell.date}: ${fmtHms(cell.minutes)} · ${cell.sessions} session${cell.sessions === 1 ? "" : "s"}`
              }
            >
              <span className="font-medium leading-none">
                {Number(cell.date.slice(8, 10))}
              </span>
              {!isFuture && cell.minutes > 0 && (
                <span className="text-[8px] leading-none mt-0.5 opacity-90 tabular-nums max-w-full truncate px-0.5">
                  {compactTime(cell.minutes)}
                </span>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-3 pt-3 border-t border-gray-800 flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="text-gray-500 tabular-nums">
          {activeDays} active day{activeDays === 1 ? "" : "s"} ·{" "}
          {totalSessions} session{totalSessions === 1 ? "" : "s"} ·{" "}
          {fmtHms(totalMinutes)}
        </span>
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-gray-600">Less</span>
          {[0, 10, 30, 60, 100].map((m) => (
            <div key={m} className={`w-3 h-3 rounded-[2px] ${getColor(m)}`} />
          ))}
          <span className="text-[10px] text-gray-600">More</span>
        </div>
      </div>
    </div>
  );
}

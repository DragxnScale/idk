"use client";

import { useEffect, useState } from "react";

interface DayData {
  date: string;
  minutes: number;
  sessions: number;
}

interface MonthResponse {
  year: number;
  month: number;
  days: DayData[];
  earliestDate: string | null;
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function getColor(minutes: number): string {
  if (minutes === 0) return "bg-gray-100 dark:bg-gray-800";
  if (minutes < 20) return "bg-blue-200 dark:bg-blue-900";
  if (minutes < 45) return "bg-blue-400 dark:bg-blue-700";
  if (minutes < 90) return "bg-blue-600 dark:bg-blue-500";
  return "bg-blue-800 dark:bg-blue-300";
}

function todayKey(): string {
  const t = new Date();
  t.setHours(0, 0, 0, 0);
  return t.toISOString().slice(0, 10);
}

export function ActivityMonthModal({ onClose }: { onClose: () => void }) {
  const now = new Date();
  const [year, setYear] = useState(now.getUTCFullYear());
  const [month, setMonth] = useState(now.getUTCMonth() + 1);
  const [data, setData] = useState<MonthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/user/activity-month?year=${year}&month=${month}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((json: MonthResponse) => {
        if (cancelled) return;
        setData(json);
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e?.message ?? "Failed to load");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [year, month]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") goPrev();
      else if (e.key === "ArrowRight") goNext();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, month, data]);

  const goPrev = () => {
    if (month === 1) {
      setYear(year - 1);
      setMonth(12);
    } else {
      setMonth(month - 1);
    }
  };
  const goNext = () => {
    const today = new Date();
    const isCurrentMonth =
      year === today.getUTCFullYear() && month === today.getUTCMonth() + 1;
    if (isCurrentMonth) return;
    if (month === 12) {
      setYear(year + 1);
      setMonth(1);
    } else {
      setMonth(month + 1);
    }
  };

  const today = new Date();
  const isCurrentMonth =
    year === today.getUTCFullYear() && month === today.getUTCMonth() + 1;
  const canGoBack = (() => {
    if (!data?.earliestDate) {
      // No prior history known yet — allow scrolling back a couple of years
      // before clamping, so an empty data set doesn't block exploration.
      return year > now.getUTCFullYear() - 5;
    }
    const [eY, eM] = data.earliestDate.split("-").map(Number);
    if (year > eY) return true;
    if (year < eY) return false;
    return month > eM;
  })();

  // Build the 6×7 grid: pad leading days from the previous month, then real
  // days, then trailing nulls (we render those as empty cells).
  const firstOfMonth = new Date(Date.UTC(year, month - 1, 1));
  const leadPad = firstOfMonth.getUTCDay();
  const cells: (DayData | null)[] = [];
  for (let i = 0; i < leadPad; i++) cells.push(null);
  if (data?.days) for (const d of data.days) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const totalMinutes = data?.days.reduce((s, d) => s + d.minutes, 0) ?? 0;
  const totalSessions = data?.days.reduce((s, d) => s + d.sessions, 0) ?? 0;
  const activeDays = data?.days.filter((d) => d.minutes > 0).length ?? 0;

  const today0 = todayKey();

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Activity calendar"
    >
      <div
        className="w-full max-w-md rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-200 dark:border-gray-700 px-4 py-3">
          <button
            onClick={goPrev}
            disabled={!canGoBack}
            className="rounded-lg p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 transition disabled:opacity-30 disabled:hover:bg-transparent"
            aria-label="Previous month"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
              <path fillRule="evenodd" d="M12.79 5.23a.75.75 0 0 1 0 1.06L9.06 10l3.73 3.71a.75.75 0 1 1-1.06 1.06l-4.25-4.24a.75.75 0 0 1 0-1.06l4.25-4.24a.75.75 0 0 1 1.06 0Z" clipRule="evenodd" />
            </svg>
          </button>
          <h2 className="text-sm font-semibold tabular-nums">
            {MONTH_NAMES[month - 1]} {year}
          </h2>
          <button
            onClick={goNext}
            disabled={isCurrentMonth}
            className="rounded-lg p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 transition disabled:opacity-30 disabled:hover:bg-transparent"
            aria-label="Next month"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
              <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 0 1 0-1.06L10.94 10 7.21 6.29a.75.75 0 0 1 1.06-1.06l4.25 4.24a.75.75 0 0 1 0 1.06l-4.25 4.24a.75.75 0 0 1-1.06 0Z" clipRule="evenodd" />
            </svg>
          </button>
        </div>

        <div className="px-4 pt-3 pb-4">
          <div className="grid grid-cols-7 gap-1 mb-1">
            {DAY_LABELS.map((d) => (
              <div key={d} className="text-[10px] text-gray-400 dark:text-gray-500 text-center font-medium">
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
                      ? "bg-transparent text-gray-300 dark:text-gray-700"
                      : `${getColor(cell.minutes)} ${
                          cell.minutes > 60
                            ? "text-white"
                            : "text-gray-700 dark:text-gray-200"
                        }`
                  } ${isToday ? "ring-2 ring-blue-500 dark:ring-blue-400" : ""}`}
                  title={
                    isFuture
                      ? cell.date
                      : `${cell.date}: ${cell.minutes} min · ${cell.sessions} session${cell.sessions === 1 ? "" : "s"}`
                  }
                >
                  <span className="font-medium leading-none">
                    {Number(cell.date.slice(8, 10))}
                  </span>
                  {!isFuture && cell.minutes > 0 && (
                    <span className="text-[9px] leading-none mt-0.5 opacity-80 tabular-nums">
                      {cell.minutes}m
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="border-t border-gray-200 dark:border-gray-700 px-4 py-3 flex items-center justify-between text-xs">
          {loading ? (
            <span className="text-gray-400 animate-pulse">Loading…</span>
          ) : error ? (
            <span className="text-red-500">Couldn&apos;t load activity: {error}</span>
          ) : (
            <span className="text-gray-500 dark:text-gray-400 tabular-nums">
              {activeDays} active day{activeDays === 1 ? "" : "s"} ·{" "}
              {totalSessions} session{totalSessions === 1 ? "" : "s"} ·{" "}
              {totalMinutes} min
            </span>
          )}
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-gray-400">Less</span>
            {[0, 10, 30, 60, 100].map((m) => (
              <div key={m} className={`w-3 h-3 rounded-[2px] ${getColor(m)}`} />
            ))}
            <span className="text-[10px] text-gray-400">More</span>
          </div>
        </div>
      </div>
    </div>
  );
}

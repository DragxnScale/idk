"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

export interface StudyTimeChartDay {
  date: string;
  totalMinutes: number;
  byUser: { userId: string; name: string; minutes: number }[];
}

const CHART_USER_COLORS = [
  "#818cf8",
  "#fb923c",
  "#34d399",
  "#f87171",
  "#60a5fa",
  "#c084fc",
  "#f472b6",
  "#2dd4bf",
  "#facc15",
  "#a3e635",
];
const OTHERS_COLOR = "#6b7280";
const TOP_N = 8;

function fmtMinutes(mins: number) {
  return mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`;
}

export function StudyTimeChartModal({
  days,
  onDaysChange,
  data,
  loading,
  onClose,
}: {
  days: 7 | 30 | 90;
  onDaysChange: (d: 7 | 30 | 90) => void;
  data: StudyTimeChartDay[] | null;
  loading: boolean;
  onClose: () => void;
}) {
  // Tally total minutes per user across the whole range
  const userTotals = new Map<string, { name: string; total: number }>();
  if (data) {
    for (const day of data) {
      for (const u of day.byUser) {
        const prev = userTotals.get(u.userId) ?? { name: u.name, total: 0 };
        userTotals.set(u.userId, {
          name: u.name || prev.name,
          total: prev.total + u.minutes,
        });
      }
    }
  }

  const sortedUsers = Array.from(userTotals.entries()).sort(
    (a, b) => b[1].total - a[1].total
  );
  const topUsers = sortedUsers.slice(0, TOP_N);
  const hasOthers = sortedUsers.length > TOP_N;
  const topUserIds = new Set(topUsers.map(([id]) => id));

  // Shape data for recharts — one object per day
  const chartRows = (data ?? []).map((day) => {
    const obj: Record<string, number | string> = {
      date: day.date.slice(5), // "MM-DD"
      fullDate: day.date,
    };
    let othersTotal = 0;
    for (const u of day.byUser) {
      if (topUserIds.has(u.userId)) {
        obj[u.userId] = ((obj[u.userId] as number) || 0) + u.minutes;
      } else {
        othersTotal += u.minutes;
      }
    }
    if (hasOthers) obj["Others"] = othersTotal;
    return obj;
  });

  const totalMinutes = data?.reduce((s, d) => s + d.totalMinutes, 0) ?? 0;

  function handleBackdrop(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target === e.currentTarget) onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={handleBackdrop}
    >
      <div className="w-full max-w-4xl mx-4 rounded-2xl bg-gray-900 border border-gray-700 p-6 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-base font-semibold">Study Time by Day</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              {fmtMinutes(totalMinutes)} total · last {days} days
            </p>
          </div>
          <div className="flex items-center gap-3">
            {/* Range selector */}
            <div className="flex gap-1 rounded-lg bg-gray-800 p-0.5">
              {([7, 30, 90] as const).map((d) => (
                <button
                  key={d}
                  onClick={() => onDaysChange(d)}
                  className={`px-3 py-1 text-xs rounded-md transition font-medium ${
                    days === d
                      ? "bg-indigo-600 text-white shadow"
                      : "text-gray-400 hover:text-gray-200"
                  }`}
                >
                  {d}d
                </button>
              ))}
            </div>
            <button
              onClick={onClose}
              className="rounded-lg bg-gray-800 px-3 py-1 text-xs text-gray-400 hover:bg-gray-700 hover:text-white transition"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Chart area */}
        {loading ? (
          <div className="h-72 flex items-center justify-center">
            <p className="text-gray-400 animate-pulse text-sm">Loading…</p>
          </div>
        ) : !data || data.length === 0 ? (
          <div className="h-72 flex items-center justify-center">
            <p className="text-gray-600 text-sm">No study sessions in this period.</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <BarChart
              data={chartRows}
              margin={{ top: 4, right: 4, left: -8, bottom: 4 }}
              barCategoryGap="20%"
            >
              <XAxis
                dataKey="date"
                tick={{ fill: "#6b7280", fontSize: 10 }}
                tickLine={false}
                axisLine={false}
                interval={days === 7 ? 0 : days === 30 ? 4 : 9}
              />
              <YAxis
                tick={{ fill: "#6b7280", fontSize: 10 }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v: number) => `${v}m`}
                width={38}
              />
              <Tooltip
                contentStyle={{
                  background: "#111827",
                  border: "1px solid #374151",
                  borderRadius: 8,
                  fontSize: 12,
                }}
                labelStyle={{ color: "#e5e7eb", fontWeight: 600 }}
                itemStyle={{ color: "#9ca3af" }}
                cursor={{ fill: "rgba(255,255,255,0.04)" }}
                formatter={
                  ((val: unknown, name: unknown) => [
                    `${Number(val)}m`,
                    (name as string) === "Others"
                      ? "Others"
                      : userTotals.get(name as string)?.name || (name as string),
                  // Type cast: recharts Formatter generic is overly strict
                  ]) as Parameters<typeof Tooltip>[0]["formatter"]
                }
                labelFormatter={(l: unknown) => {
                  const row = chartRows.find((d) => d.date === l);
                  return String(row?.fullDate ?? l);
                }}
              />
              {topUsers.map(([userId, u], i) => (
                <Bar
                  key={userId}
                  dataKey={userId}
                  name={u.name || userId}
                  stackId="a"
                  fill={CHART_USER_COLORS[i % CHART_USER_COLORS.length]}
                />
              ))}
              {hasOthers && (
                <Bar
                  dataKey="Others"
                  name="Others"
                  stackId="a"
                  fill={OTHERS_COLOR}
                />
              )}
            </BarChart>
          </ResponsiveContainer>
        )}

        {/* Legend */}
        {!loading && data && topUsers.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2">
            {topUsers.map(([userId, u], i) => (
              <div key={userId} className="flex items-center gap-1.5">
                <div
                  className="w-2.5 h-2.5 rounded-sm flex-shrink-0"
                  style={{
                    background: CHART_USER_COLORS[i % CHART_USER_COLORS.length],
                  }}
                />
                <span className="text-xs text-gray-400">
                  {u.name || userId}
                </span>
                <span className="text-xs text-gray-600">
                  {fmtMinutes(u.total)}
                </span>
              </div>
            ))}
            {hasOthers && (
              <div className="flex items-center gap-1.5">
                <div
                  className="w-2.5 h-2.5 rounded-sm flex-shrink-0"
                  style={{ background: OTHERS_COLOR }}
                />
                <span className="text-xs text-gray-400">Others</span>
                <span className="text-xs text-gray-600">
                  {fmtMinutes(
                    sortedUsers
                      .slice(TOP_N)
                      .reduce((s, [, u]) => s + u.total, 0)
                  )}
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

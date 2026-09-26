"use client";

/* ===========================================================
   components/charts.tsx - score sparkline + trend chart
   SVG only (no chart dependency): the same area sparkline the
   classic site drew, plus an axis-labelled trend card.
   =========================================================== */
import { fmtDate } from "@/lib/client/util";

export function Sparkline({
  values,
  width = 320,
  height = 90,
  className,
}: {
  values: number[];
  width?: number;
  height?: number;
  className?: string;
}) {
  if (!values.length) return <p className="text-sm text-muted-foreground">No data yet.</p>;
  const min = 0;
  const max = 100;
  const stepX = values.length > 1 ? width / (values.length - 1) : 0;
  const y = (v: number) => height - ((v - min) / (max - min)) * (height - 12) - 6;
  const pts = values.map((v, i) => i * stepX + "," + y(v));
  const area = "0," + height + " " + pts.join(" ") + " " + (values.length - 1) * stepX + "," + height;
  const last = values[values.length - 1];
  return (
    <svg
      className={className}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label="score trend"
      style={{ width: "100%", height }}
    >
      <polygon fill="var(--primary)" opacity="0.15" points={area} />
      <polyline fill="none" stroke="var(--primary)" strokeWidth="2.5" points={pts.join(" ")} />
      <circle
        cx={(values.length - 1) * stepX}
        cy={y(last)}
        r="3.5"
        fill="var(--primary)"
      />
    </svg>
  );
}

export function TrendChart({
  points,
}: {
  points: { at: number; percent: number; label: string }[];
}) {
  if (!points.length) return <p className="text-sm text-muted-foreground">No data yet.</p>;
  const values = points.map((p) => p.percent);
  const best = Math.max(...values);
  const worst = Math.min(...values);
  return (
    <div className="flex flex-col gap-2">
      <Sparkline values={values} height={110} />
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span title={fmtDate(points[0].at)}>
          {points[0].label} · {points[0].percent}%
        </span>
        <span>
          Best {best}% · Lowest {worst}%
        </span>
        <span title={fmtDate(points[points.length - 1].at)}>
          {points[points.length - 1].label} · {points[points.length - 1].percent}%
        </span>
      </div>
    </div>
  );
}

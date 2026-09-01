
import { motion, draw } from "@/lib/motion";
import { cn } from "@/lib/utils";

/**
 * Hand-rolled trend line, drawn on with the shared easing curve.
 *
 * Deliberately not `recharts`: the mockup's own Dashboard hand-rolls its bar and
 * donut charts in SVG and only references recharts from `components/ui/chart.tsx`,
 * a shadcn boilerplate file no screen imports. See SPO-193 for the bundle numbers.
 */
export function Sparkline({
  points,
  width = 96,
  height = 28,
  delay = 0.4,
  className,
}: {
  points: number[];
  width?: number;
  height?: number;
  delay?: number;
  className?: string;
}) {
  if (points.length < 2) return null;

  const max = Math.max(...points);
  const min = Math.min(...points);
  const range = max - min || 1;
  const step = width / (points.length - 1);
  const d = points
    .map((p, i) => {
      const x = (i * step).toFixed(1);
      const y = (height - 2 - ((p - min) / range) * (height - 4)).toFixed(1);
      return `${i === 0 ? "M" : "L"}${x},${y}`;
    })
    .join(" ");

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn("overflow-visible", className)}
      aria-hidden
    >
      <motion.path
        d={d}
        fill="none"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="stroke-pine"
        {...draw(delay)}
      />
    </svg>
  );
}

export default Sparkline;

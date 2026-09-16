"use client";

import { useId, useState } from "react";

export interface SignupDay {
  day: string;
  signups: number;
}

const WIDTH = 720;
const HEIGHT = 220;
const PAD_LEFT = 36;
const PAD_BOTTOM = 24;
const PAD_TOP = 12;

export function SignupsChart({ data }: { data: SignupDay[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const gradientId = useId();

  const max = Math.max(1, ...data.map((d) => d.signups));
  const plotWidth = WIDTH - PAD_LEFT - 8;
  const plotHeight = HEIGHT - PAD_TOP - PAD_BOTTOM;
  const slot = plotWidth / data.length;
  const barWidth = Math.min(24, slot - 2);

  const yTicks = [0, Math.ceil(max / 2), max];
  const total = data.reduce((sum, d) => sum + d.signups, 0);

  return (
    <div className="viz-root">
      <style>{`
        .viz-root {
          --surface-1: var(--card);
          --text-secondary: #52514e;
          --text-muted: #898781;
          --gridline: #e1e0d9;
          --baseline: #c3c2b7;
          --series-1: #2a78d6;
        }
        @media (prefers-color-scheme: dark) {
          :root:where(:not([data-theme="light"])) .viz-root {
            --text-secondary: #c3c2b7;
            --text-muted: #898781;
            --gridline: #2c2c2a;
            --baseline: #383835;
            --series-1: #3987e5;
          }
        }
        :root[data-theme="dark"] .viz-root {
          --text-secondary: #c3c2b7;
          --text-muted: #898781;
          --gridline: #2c2c2a;
          --baseline: #383835;
          --series-1: #3987e5;
        }
      `}</style>

      {total === 0 ? (
        <div className="flex h-[220px] flex-col items-center justify-center gap-1 text-center text-sm text-muted-foreground">
          <p>No signups in this 30-day window.</p>
          <p className="text-xs">
            (Seed data for this brand predates the window — see the dashboard note below.)
          </p>
        </div>
      ) : (
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="w-full" role="img" aria-label="Signups per day, last 30 days">
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--series-1)" />
              <stop offset="100%" stopColor="var(--series-1)" />
            </linearGradient>
          </defs>

          {yTicks.map((tick) => {
            const y = PAD_TOP + plotHeight - (tick / max) * plotHeight;
            return (
              <g key={tick}>
                <line x1={PAD_LEFT} x2={WIDTH - 8} y1={y} y2={y} stroke="var(--gridline)" strokeWidth={1} />
                <text x={PAD_LEFT - 6} y={y + 3} textAnchor="end" fontSize={10} fill="var(--text-muted)">
                  {tick.toLocaleString()}
                </text>
              </g>
            );
          })}
          <line
            x1={PAD_LEFT}
            x2={PAD_LEFT}
            y1={PAD_TOP}
            y2={PAD_TOP + plotHeight}
            stroke="var(--baseline)"
            strokeWidth={1}
          />

          {data.map((d, i) => {
            const barHeight = (d.signups / max) * plotHeight;
            const x = PAD_LEFT + i * slot + (slot - barWidth) / 2;
            const y = PAD_TOP + plotHeight - barHeight;
            const isHover = hover === i;
            const showDateLabel = i === 0 || i === data.length - 1 || i % 7 === 0;

            return (
              <g key={d.day}>
                <rect
                  x={x}
                  y={barHeight > 0 ? y : PAD_TOP + plotHeight - 1}
                  width={barWidth}
                  height={Math.max(barHeight, barHeight > 0 ? barHeight : 1)}
                  rx={4}
                  fill="var(--series-1)"
                  opacity={isHover ? 1 : 0.92}
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(null)}
                />
                <rect
                  x={x - 1}
                  y={PAD_TOP}
                  width={barWidth + 2}
                  height={plotHeight}
                  fill="transparent"
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(null)}
                />
                {showDateLabel && (
                  <text
                    x={x + barWidth / 2}
                    y={HEIGHT - 6}
                    textAnchor="middle"
                    fontSize={9}
                    fill="var(--text-muted)"
                  >
                    {d.day.slice(5)}
                  </text>
                )}
              </g>
            );
          })}

          {hover !== null && (
            <g>
              {(() => {
                const d = data[hover];
                const barHeight = (d.signups / max) * plotHeight;
                const x = PAD_LEFT + hover * slot + slot / 2;
                const y = PAD_TOP + plotHeight - barHeight;
                const labelWidth = 96;
                const boxX = Math.min(Math.max(x - labelWidth / 2, PAD_LEFT), WIDTH - labelWidth - 4);
                return (
                  <g transform={`translate(${boxX}, ${Math.max(y - 34, PAD_TOP)})`}>
                    <rect width={labelWidth} height={28} rx={4} fill="var(--popover, #1a1a19)" opacity={0.95} />
                    <text x={8} y={12} fontSize={9} fill="var(--text-secondary)">
                      {d.day}
                    </text>
                    <text x={8} y={23} fontSize={11} fontWeight={600} fill="var(--foreground, white)">
                      {d.signups} signup{d.signups === 1 ? "" : "s"}
                    </text>
                  </g>
                );
              })()}
            </g>
          )}
        </svg>
      )}
    </div>
  );
}

import React, { useRef, useEffect, useState, useCallback } from "react";
import { cn } from "../lib/utils";

export const TextHoverEffect = ({
  text,
  duration = 0.3,
  className,
}: {
  text: string;
  duration?: number;
  automatic?: boolean;
  className?: string;
}) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const animRef = useRef<number | null>(null);
  const [hovered, setHovered] = useState(false);
  const [maskPos, setMaskPos] = useState({ cx: 50, cy: 50 });
  const [drawProgress, setDrawProgress] = useState(0);

  // Smooth cursor tracking via lerp + rAF
  const targetRef = useRef({ cx: 50, cy: 50 });
  const currentRef = useRef({ cx: 50, cy: 50 });

  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const speed = Math.min(1, duration > 0 ? 1 / (duration * 60) : 1);

  const tick = useCallback(() => {
    const c = currentRef.current;
    const t = targetRef.current;
    c.cx = lerp(c.cx, t.cx, speed);
    c.cy = lerp(c.cy, t.cy, speed);
    setMaskPos({ cx: c.cx, cy: c.cy });
    animRef.current = requestAnimationFrame(tick);
  }, [speed]);

  useEffect(() => {
    animRef.current = requestAnimationFrame(tick);
    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, [tick]);

  // Draw-on animation (replaces motion.text strokeDashoffset)
  useEffect(() => {
    let start: number | null = null;
    const totalDuration = 4000;
    const step = (ts: number) => {
      if (!start) start = ts;
      const progress = Math.min((ts - start) / totalDuration, 1);
      setDrawProgress(progress);
      if (progress < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, []);

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    targetRef.current = {
      cx: ((e.clientX - rect.left) / rect.width) * 100,
      cy: ((e.clientY - rect.top) / rect.height) * 100,
    };
  };

  const dashOffset = 1000 - drawProgress * 1000;

  return (
    <svg
      ref={svgRef}
      width="100%"
      height="100%"
      viewBox="0 0 300 100"
      xmlns="http://www.w3.org/2000/svg"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onMouseMove={handleMouseMove}
      className={cn("select-none uppercase cursor-pointer", className)}
    >
      <defs>
        <linearGradient
          id="textGradient"
          gradientUnits="userSpaceOnUse"
          x1="0%"
          y1="0%"
          x2="100%"
          y2="0%"
        >
          <stop offset="0%" stopColor="#4953c2" />
          <stop offset="25%" stopColor="#7c83e0" />
          <stop offset="50%" stopColor="#05c46b" />
          <stop offset="75%" stopColor="#4953c2" />
          <stop offset="100%" stopColor="#f8f9fc" />
        </linearGradient>

        <radialGradient
          id="revealMask"
          gradientUnits="userSpaceOnUse"
          cx={`${maskPos.cx}%`}
          cy={`${maskPos.cy}%`}
          r="20%"
        >
          <stop offset="0%" stopColor="white" />
          <stop offset="100%" stopColor="black" />
        </radialGradient>

        <mask id="textMask">
          <rect
            x="0"
            y="0"
            width="100%"
            height="100%"
            fill="url(#revealMask)"
          />
        </mask>
      </defs>

      {/* Dim ghost outline — fades in on hover */}
      <text
        x="50%"
        y="50%"
        textAnchor="middle"
        dominantBaseline="middle"
        strokeWidth="0.3"
        style={{
          fill: "transparent",
          stroke: "rgba(248,249,252,0.12)",
          fontFamily: "helvetica",
          fontSize: "7rem",
          fontWeight: "bold",
          opacity: hovered ? 0.7 : 0,
          transition: "opacity 0.3s ease",
        }}
      >
        {text}
      </text>

      {/* Draw-on stroke — animates once on mount */}
      <text
        x="50%"
        y="50%"
        textAnchor="middle"
        dominantBaseline="middle"
        strokeWidth="0.3"
        style={{
          fill: "transparent",
          stroke: "#4953c2",
          fontFamily: "helvetica",
          fontSize: "7rem",
          fontWeight: "bold",
          strokeDasharray: 1000,
          strokeDashoffset: dashOffset,
        }}
      >
        {text}
      </text>

      {/* Gradient reveal — follows cursor via radial mask */}
      <text
        x="50%"
        y="50%"
        textAnchor="middle"
        dominantBaseline="middle"
        stroke="url(#textGradient)"
        strokeWidth="0.3"
        mask="url(#textMask)"
        style={{
          fill: "transparent",
          fontFamily: "helvetica",
          fontSize: "7rem",
          fontWeight: "bold",
          opacity: hovered ? 1 : 0,
          transition: "opacity 0.3s ease",
        }}
      >
        {text}
      </text>
    </svg>
  );
};

export const FooterBackgroundGradient = () => (
  <div
    className="absolute inset-0 z-0"
    style={{
      background:
        "radial-gradient(125% 125% at 50% 10%, #0c111766 50%, #4953c233 100%)",
    }}
  />
);

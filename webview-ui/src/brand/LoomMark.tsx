import React from "react";

interface LoomMarkProps {
    size?: number;
    strokeWidth?: number;
    weft?: boolean;
    mono?: boolean;
    className?: string;
}

export function LoomMark({ size = 24, strokeWidth, weft = false, mono = false, className }: LoomMarkProps) {
    const sw = strokeWidth ?? Math.max(1.5, size / 14);
    const id = React.useId().replace(/[:]/g, "");
    const grad = `loom-grad-${id}`;

    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 32 32"
            fill="none"
            aria-hidden="true"
            className={className}
        >
            {!mono && (
                <defs>
                    <linearGradient id={grad} x1="0" y1="0" x2="1" y2="1">
                        <stop offset="0%" stopColor="currentColor" stopOpacity="1" />
                        <stop offset="100%" stopColor="currentColor" stopOpacity="0.65" />
                    </linearGradient>
                </defs>
            )}
            <g
                stroke={mono ? "currentColor" : `url(#${grad})`}
                strokeWidth={sw}
                strokeLinecap="round"
                fill="none"
            >
                <path d="M7.5 5 C 13 12, 13 20, 7.5 27" />
                <path d="M16 4 L 16 28" />
                <path d="M24.5 5 C 19 12, 19 20, 24.5 27" />
            </g>
            {weft && (
                <g stroke="currentColor" strokeWidth={sw * 0.7} strokeLinecap="round" opacity="0.55">
                    <path d="M5 16 L 27 16" strokeDasharray="2 3" />
                </g>
            )}
        </svg>
    );
}

interface LoomWordmarkProps {
    size?: number;
    showMark?: boolean;
}

export function LoomWordmark({ size = 20, showMark = true }: LoomWordmarkProps) {
    return (
        <span
            style={{
                display: "inline-flex",
                alignItems: "center",
                gap: size * 0.32,
                color: "var(--text-strong)",
                fontWeight: 600,
                fontSize: size,
                letterSpacing: "-0.02em",
                lineHeight: 1,
            }}
        >
            {showMark && (
                <span style={{ color: "var(--accent)", display: "inline-flex" }}>
                    <LoomMark size={size * 1.05} />
                </span>
            )}
            <span>Loom</span>
        </span>
    );
}

import type { Commodity } from "../game/types";

interface IconProps {
  size?: number;
  className?: string;
}

const base = (size: number, className?: string) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none" as const,
  className,
  "aria-hidden": true,
});

/* ── 상품 아이콘 ── */

export function SpiceIcon({ size = 20, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <ellipse cx="12" cy="12.4" rx="7.4" ry="3.2" fill="#b4592c" />
      <circle cx="9" cy="11.2" r="1" fill="#d97a3f" />
      <circle cx="13.4" cy="10.9" r="0.9" fill="#8f3f1d" />
      <circle cx="15.4" cy="12.1" r="0.8" fill="#d97a3f" />
      <path d="M4.2 13h15.6c-.5 3.8-3.7 6.2-7.8 6.2s-7.3-2.4-7.8-6.2z" fill="#7c5a36" />
      <path d="M4.2 13h15.6c-.1.8-.4 1.6-.8 2.2H5c-.4-.6-.7-1.4-.8-2.2z" fill="#9a7346" />
    </svg>
  );
}

export function IronIcon({ size = 20, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M6.5 8.5 12 4.6l6.2 3.4 1.6 6.4-4.4 5-6.8-.6-3.4-5.8z" fill="#8b959d" />
      <path d="M12 4.6l6.2 3.4-5.4 3-6.3-2.5z" fill="#aeb8bf" />
      <path d="M12.8 11l5.4-3 1.6 6.4-4.4 5z" fill="#6e777e" />
      <path d="M6.5 8.5l6.3 2.5 2.6 8.4-6.8-.6-3.4-5.8z" fill="#79838b" />
    </svg>
  );
}

export function SilkIcon({ size = 20, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <rect x="2.6" y="8" width="15" height="8.6" rx="4.2" fill="#6a4d99" />
      <rect x="2.6" y="8" width="15" height="3.4" rx="1.7" fill="#7f61ad" />
      <circle cx="17.4" cy="12.3" r="4.3" fill="#8a6bb8" />
      <circle cx="17.4" cy="12.3" r="2.3" fill="#5b4187" />
      <circle cx="17.4" cy="12.3" r="0.9" fill="#8a6bb8" />
    </svg>
  );
}

export function RelicIcon({ size = 20, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <circle cx="12" cy="7.2" r="2.7" fill="#b3905a" />
      <path d="M8 12.2c0-2.2 1.8-3.4 4-3.4s4 1.2 4 3.4l-.6 4.2H8.6z" fill="#a5824c" />
      <path d="M6.2 17.4c0-1.5 2.6-2.4 5.8-2.4s5.8.9 5.8 2.4v1.4H6.2z" fill="#8c6c3d" />
      <circle cx="10.9" cy="6.9" r="0.5" fill="#5f4726" />
      <circle cx="13.1" cy="6.9" r="0.5" fill="#5f4726" />
    </svg>
  );
}

export function CommodityIcon({ commodity, size = 20, className }: IconProps & { commodity: Commodity }) {
  if (commodity === "SPICE") return <SpiceIcon size={size} className={className} />;
  if (commodity === "IRON") return <IronIcon size={size} className={className} />;
  if (commodity === "SILK") return <SilkIcon size={size} className={className} />;
  return <RelicIcon size={size} className={className} />;
}

/* ── 자원 아이콘 ── */

export function GoldIcon({ size = 20, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <circle cx="12" cy="12" r="9" fill="#8a6420" />
      <circle cx="12" cy="12" r="7.6" fill="#c99b3f" />
      <circle cx="12" cy="12" r="6" fill="#e0b95c" stroke="#8a6420" strokeWidth="0.6" />
      <AnchorGlyph stroke="#7a5518" />
    </svg>
  );
}

export function SuspicionIcon({ size = 20, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <circle cx="12" cy="12" r="9" fill="#3d454c" />
      <circle cx="12" cy="12" r="7.6" fill="#6b7680" />
      <circle cx="12" cy="12" r="6" fill="#87929c" stroke="#3d454c" strokeWidth="0.6" />
      <AnchorGlyph stroke="#39424a" />
    </svg>
  );
}

function AnchorGlyph({ stroke }: { stroke: string }) {
  return (
    <g stroke={stroke} strokeWidth="1.2" strokeLinecap="round" fill="none">
      <circle cx="12" cy="8.6" r="1.3" />
      <path d="M12 9.9v6.3" />
      <path d="M9.4 11.6h5.2" />
      <path d="M8.6 13.6c.2 1.9 1.6 2.9 3.4 2.9s3.2-1 3.4-2.9" />
    </g>
  );
}

export function AnchorIcon({ size = 20, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <g stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none">
        <circle cx="12" cy="5.4" r="2.1" />
        <path d="M12 7.5v11.6" />
        <path d="M7.8 10.4h8.4" />
        <path d="M5.2 13.2c.4 3.9 3.2 5.9 6.8 5.9s6.4-2 6.8-5.9" />
        <path d="M5.2 13.2 3.6 12m17.2 1.2 1.6-1.2" transform="translate(0 .4)" />
      </g>
    </svg>
  );
}

/* ── 장식 아이콘 ── */

export function EyeIcon({ size = 20, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path
        d="M2.6 12c2.4-4.2 5.6-6.3 9.4-6.3s7 2.1 9.4 6.3c-2.4 4.2-5.6 6.3-9.4 6.3s-7-2.1-9.4-6.3z"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <circle cx="12" cy="12" r="2.6" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="12" cy="12" r="0.9" fill="currentColor" />
    </svg>
  );
}

export function ScaleIcon({ size = 20, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <g stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" fill="none">
        <path d="M12 4v14.6" />
        <path d="M8.6 18.6h6.8" />
        <path d="M5 7.4h14" />
        <path d="M5 7.4 3 12.4c.4 1.5 1.4 2.2 3 2.2s2.6-.7 3-2.2z" />
        <path d="M19 7.4l-2 5c.4 1.5 1.4 2.2 3 2.2s2.6-.7 3-2.2z" transform="translate(-2 0)" />
      </g>
    </svg>
  );
}

export function SwordsIcon({ size = 20, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <g stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none">
        <path d="M4.6 4.6 17 17m2.4 2.4L17 17m0 0 2.6-1m-3.6 2-1 2.6" />
        <path d="M19.4 4.6 7 17m-2.4 2.4L7 17m0 0-2.6-1m3.6 2 1 2.6" />
      </g>
    </svg>
  );
}

export function EnvelopeIcon({ size = 20, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <rect x="3" y="5.6" width="18" height="12.8" rx="1.4" stroke="currentColor" strokeWidth="1.4" />
      <path d="m3.6 6.6 8.4 6.6 8.4-6.6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

export function DiceIcon({ size = 20, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <rect x="4" y="4" width="16" height="16" rx="3" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="9" cy="9" r="1.2" fill="currentColor" />
      <circle cx="15" cy="9" r="1.2" fill="currentColor" />
      <circle cx="9" cy="15" r="1.2" fill="currentColor" />
      <circle cx="15" cy="15" r="1.2" fill="currentColor" />
      <circle cx="12" cy="12" r="1.2" fill="currentColor" />
    </svg>
  );
}

export function GavelIcon({ size = 20, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <g stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none">
        <path d="m9.4 6.4 8.2 8.2" />
        <path d="m7.6 8.2 3.6-3.6" />
        <path d="m13.8 14.4 3.6-3.6" />
        <path d="M12.6 9.6 4 18.2" />
        <path d="M4 20.4h9.6" />
      </g>
    </svg>
  );
}

export function CompassIcon({ size = 20, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <circle cx="12" cy="12" r="8.6" stroke="currentColor" strokeWidth="1.4" />
      <path d="m15.4 8.6-2.2 5-5 2.2 2.2-5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <circle cx="12" cy="12" r="0.9" fill="currentColor" />
    </svg>
  );
}

export function LanternIcon({ size = 20, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <g stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" fill="none">
        <path d="M9 4.4h6" />
        <path d="M12 4.4V3" />
        <path d="M8.4 6.8h7.2l1 9H7.4z" />
        <path d="M9 18.8h6" />
        <path d="M12 9v4.6" strokeWidth="1.8" />
      </g>
    </svg>
  );
}

export function HandshakeIcon({ size = 20, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <g stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" fill="none">
        <path d="M2.8 8.2 7 6.4l5 1.8 4.6-1.8 4.6 2v6.8l-2.4.4" />
        <path d="m7 6.4-4.2 1.8v7l2.6.6 3.6 3 2.6.6 5.6-4.6" />
        <path d="m12 8.2-3.4 3c.8 1.2 2 1.4 3.2.6l2-1.4" />
      </g>
    </svg>
  );
}

export function ScrollIcon({ size = 20, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <g stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" fill="none">
        <path d="M6.6 4.8h11.8a2 2 0 0 1 2 2v.6h-3.2" />
        <path d="M17.2 4.8a2 2 0 0 0-2 2v11a2.6 2.6 0 0 1-2.6 2.6H5.2A2.2 2.2 0 0 1 3 18.2v-.8h9.6" />
        <path d="M7.4 9.4h4.8m-4.8 3.2h4.8" />
      </g>
    </svg>
  );
}

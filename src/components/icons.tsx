type P = { size?: number; className?: string };

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
});

export const IconCalendar = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}>
    <rect x="3" y="4" width="18" height="18" rx="2" />
    <path d="M16 2v4M8 2v4M3 10h18" />
  </svg>
);
export const IconClock = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}>
    <circle cx="12" cy="12" r="10" />
    <path d="M12 6v6l4 2" />
  </svg>
);
export const IconPin = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
    <circle cx="12" cy="10" r="3" />
  </svg>
);
export const IconId = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}>
    <rect x="2" y="5" width="20" height="14" rx="2" />
    <circle cx="8" cy="12" r="2.5" />
    <path d="M14 10h5M14 14h3" />
  </svg>
);
export const IconCheck = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M20 6 9 17l-5-5" />
  </svg>
);
export const IconX = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
);
export const IconAlert = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="m21.7 18-8-14a2 2 0 0 0-3.4 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3Z" />
    <path d="M12 9v4M12 17h.01" />
  </svg>
);
export const IconInfo = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}>
    <circle cx="12" cy="12" r="10" />
    <path d="M12 16v-4M12 8h.01" />
  </svg>
);
export const IconLock = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}>
    <rect x="3" y="11" width="18" height="11" rx="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
);
export const IconCard = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}>
    <rect x="2" y="5" width="20" height="14" rx="2" />
    <path d="M2 10h20M6 15h4" />
  </svg>
);
export const IconPix = ({ size = 18, className }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden className={className} fill="currentColor">
    <path d="M5.3 5.9a3 3 0 0 1 2.1.9l3.5 3.5a1.5 1.5 0 0 0 2.2 0l3.5-3.5a3 3 0 0 1 2.1-.9h.4L14.6 1.4a3.7 3.7 0 0 0-5.2 0L4.9 5.9h.4Zm13.4 12.2a3 3 0 0 1-2.1-.9l-3.5-3.5a1.5 1.5 0 0 0-2.2 0l-3.5 3.5a3 3 0 0 1-2.1.9h-.4l4.5 4.5a3.7 3.7 0 0 0 5.2 0l4.5-4.5h-.4Zm3.9-8.7-2.7-2.7a.6.6 0 0 1-.2 0h-1.2a2 2 0 0 0-1.4.6l-3.5 3.5a2.5 2.5 0 0 1-3.6 0L6.5 7.3a2 2 0 0 0-1.4-.6H3.6l-.2.1-2 2a3.7 3.7 0 0 0 0 5.2l2 2h1.7a2 2 0 0 0 1.4-.6l3.5-3.5a2.6 2.6 0 0 1 3.6 0l3.5 3.5a2 2 0 0 0 1.4.6h1.2l.2.1 2.7-2.7a3.7 3.7 0 0 0 0-5.2Z" />
  </svg>
);
export const IconCopy = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}>
    <rect x="9" y="9" width="13" height="13" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);
export const IconHourglass = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M5 22h14M5 2h14M17 22v-4.2a2 2 0 0 0-.6-1.4L12 12l-4.4 4.4a2 2 0 0 0-.6 1.4V22M7 2v4.2a2 2 0 0 0 .6 1.4L12 12l4.4-4.4a2 2 0 0 0 .6-1.4V2" />
  </svg>
);
export const IconBan = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}>
    <circle cx="12" cy="12" r="10" />
    <path d="m4.9 4.9 14.2 14.2" />
  </svg>
);
export const IconShield = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
  </svg>
);
export const IconList = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
  </svg>
);
export const IconExternal = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
  </svg>
);
export const IconRefresh = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5" />
  </svg>
);

/** Coroa rabiscada do cartaz. */
export const Crown = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 64 48" className={className} aria-hidden fill="none" stroke="currentColor" strokeWidth="4" strokeLinejoin="round" strokeLinecap="round">
    <path d="M6 40 4 10l16 16L32 4l12 22 16-16-2 30Z" />
    <path d="M8 44h48" />
  </svg>
);

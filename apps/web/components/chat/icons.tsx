// Small line icons for the chat (2px stroke, currentColor). Decorative: the words always say the same thing.
type P = { size?: number };
const base = (size: number) => ({ width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2.2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true, focusable: false });

export const SirenIcon = ({ size = 22 }: P) => (
  <svg {...base(size)}><path d="M6 19v-6a6 6 0 0 1 12 0v6" /><path d="M4 19h16" /><path d="M12 3v2M4.5 6.5l1.4 1.4M19.5 6.5l-1.4 1.4" /></svg>
);
export const CrossIcon = ({ size = 22 }: P) => (
  <svg {...base(size)}><circle cx="12" cy="12" r="9.5" /><path d="M12 7v10M7 12h10" /></svg>
);
export const ClockIcon = ({ size = 22 }: P) => (
  <svg {...base(size)}><circle cx="12" cy="12" r="9.5" /><path d="M12 7v5l3 2" /></svg>
);
export const CalendarIcon = ({ size = 22 }: P) => (
  <svg {...base(size)}><rect x="3.5" y="5" width="17" height="15" rx="2" /><path d="M3.5 10h17M8 3v4M16 3v4" /></svg>
);
export const HomeIcon = ({ size = 22 }: P) => (
  <svg {...base(size)}><path d="M4 11l8-7 8 7v9H4z" /><path d="M10 20v-6h4v6" /></svg>
);
export const BookIcon = ({ size = 18 }: P) => (
  <svg {...base(size)}><path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z" /><path d="M4 19V5M8 7h7" /></svg>
);
export const PillIcon = ({ size = 18 }: P) => (
  <svg {...base(size)}><rect x="2.5" y="8" width="19" height="8" rx="4" transform="rotate(-35 12 12)" /><path d="M9 15l6-6" /></svg>
);
export const ExternalIcon = ({ size = 14 }: P) => (
  <svg {...base(size)}><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></svg>
);
export const SendIcon = ({ size = 22 }: P) => (
  <svg {...base(size)}><path d="M4 12l16-8-6 16-3-7z" /></svg>
);
export const StopIcon = ({ size = 20 }: P) => (
  <svg {...base(size)}><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" /></svg>
);
export const CopyIcon = ({ size = 16 }: P) => (
  <svg {...base(size)}><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></svg>
);
export const ThumbUpIcon = ({ size = 16 }: P) => (
  <svg {...base(size)}><path d="M7 11v9H4v-9zM7 11l4-8a2 2 0 0 1 2 2v4h5.5a1.5 1.5 0 0 1 1.5 1.8l-1.3 6.5A2 2 0 0 1 16.8 19H7" /></svg>
);
export const ThumbDownIcon = ({ size = 16 }: P) => (
  <svg {...base(size)}><path d="M7 13V4H4v9zM7 13l4 8a2 2 0 0 0 2-2v-4h5.5a1.5 1.5 0 0 0 1.5-1.8l-1.3-6.5A2 2 0 0 0 16.8 5H7" /></svg>
);
export const PlusIcon = ({ size = 18 }: P) => (
  <svg {...base(size)}><path d="M12 5v14M5 12h14" /></svg>
);
export const ArrowDownIcon = ({ size = 18 }: P) => (
  <svg {...base(size)}><path d="M12 5v14M6 13l6 6 6-6" /></svg>
);
export const GearIcon = ({ size = 18 }: P) => (
  <svg {...base(size)}><circle cx="12" cy="12" r="3.2" /><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7" /></svg>
);
export const MenuIcon = ({ size = 20 }: P) => (
  <svg {...base(size)}><path d="M4 7h16M4 12h16M4 17h16" /></svg>
);
export const EditIcon = ({ size = 20 }: P) => (
  <svg {...base(size)}><path d="M12 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6" /><path d="M17.5 3.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4z" /></svg>
);
export const SearchIcon = ({ size = 20 }: P) => (
  <svg {...base(size)}><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
);
export const SidebarIcon = ({ size = 20 }: P) => (
  <svg {...base(size)}><rect x="3" y="4" width="18" height="16" rx="2.5" /><path d="M9 4v16" /></svg>
);
export const DocIcon = ({ size = 20 }: P) => (
  <svg {...base(size)}><path d="M7 3h7l5 5v13H7z" /><path d="M14 3v5h5M10 13h6M10 17h6" /></svg>
);
export const ThermometerIcon = ({ size = 20 }: P) => (
  <svg {...base(size)}><path d="M14 14.5V5a2 2 0 0 0-4 0v9.5a4 4 0 1 0 4 0z" /><path d="M12 9v6" /></svg>
);
export const MoonIcon = ({ size = 20 }: P) => (
  <svg {...base(size)}><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5z" /></svg>
);
export const ArrowUpIcon = ({ size = 20 }: P) => (
  <svg {...base(size)}><path d="M12 19V5M5 12l7-7 7 7" /></svg>
);
export const ChildIcon = ({ size = 20 }: P) => (
  <svg {...base(size)}><circle cx="12" cy="6" r="2.5" /><path d="M8 21v-6l-2-3 3-2h6l3 2-2 3v6M10 21v-4h4v4" /></svg>
);

export const ChevronRightIcon = ({ size = 20 }: P) => (
  <svg {...base(size)}><path d="M9 5l7 7-7 7" /></svg>
);
export const HeartIcon = ({ size = 22 }: P) => (
  <svg {...base(size)}><path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.4a4.3 4.3 0 0 1 7.5 2.4C19.5 15.4 12 20 12 20z" /></svg>
);
export const BookmarkIcon = ({ size = 22 }: P) => (
  <svg {...base(size)}><path d="M6 3.5h12v17l-6-4.2-6 4.2z" /></svg>
);
export const CloseIcon = ({ size = 18 }: P) => (
  <svg {...base(size)}><path d="M6 6l12 12M18 6L6 18" /></svg>
);
export const CheckIcon = ({ size = 18 }: P) => (
  <svg {...base(size)}><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
);
export const LockIcon = ({ size = 16 }: P) => (
  <svg {...base(size)}><rect x="5" y="10.5" width="14" height="10" rx="2" /><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" /></svg>
);
export const ArrowLeftIcon = ({ size = 20 }: P) => (
  <svg {...base(size)}><path d="M19 12H5M11 6l-6 6 6 6" /></svg>
);
export const PersonIcon = ({ size = 20 }: P) => (
  <svg {...base(size)}><circle cx="12" cy="8" r="4" /><path d="M4.5 20.5c1.2-3.9 4.1-6 7.5-6s6.3 2.1 7.5 6" /></svg>
);
export const RulerIcon = ({ size = 20 }: P) => (
  <svg {...base(size)}><rect x="3" y="8" width="18" height="8" rx="1.5" /><path d="M7 8v3M11 8v4M15 8v3M19 8v4" /></svg>
);
export const DropIcon = ({ size = 20 }: P) => (
  <svg {...base(size)}><path d="M12 3.5s6 6.4 6 10.5a6 6 0 0 1-12 0C6 9.9 12 3.5 12 3.5z" /></svg>
);
export const LeafIcon = ({ size = 20 }: P) => (
  <svg {...base(size)}><path d="M5 19c0-8 5-13 14-14 0 9-5 14-13 14z" /><path d="M5 19c3-4 6-6 9-7.5" /></svg>
);
export const FamilyIcon = ({ size = 20 }: P) => (
  <svg {...base(size)}><circle cx="8" cy="7.5" r="2.8" /><circle cx="16.5" cy="9" r="2.3" /><path d="M3.5 19.5c.6-3.4 2.4-5.3 4.5-5.3s3.9 1.9 4.5 5.3M13 19.5c.4-2.6 1.8-4.1 3.5-4.1s3.1 1.5 3.5 4.1" /></svg>
);
export const SpeakerIcon = ({ size = 18 }: P) => (
  <svg {...base(size)}><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" /><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" /></svg>
);
export const ShareIcon = ({ size = 18 }: P) => (
  <svg {...base(size)}><circle cx="18" cy="5.5" r="2.5" /><circle cx="6" cy="12" r="2.5" /><circle cx="18" cy="18.5" r="2.5" /><path d="M8.3 10.8l7.4-4M8.3 13.2l7.4 4" /></svg>
);
export const MapPinIcon = ({ size = 16 }: P) => (
  <svg {...base(size)}><path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11z" /><circle cx="12" cy="10" r="2.3" /></svg>
);
export const DownloadIcon = ({ size = 18 }: P) => (
  <svg {...base(size)}><path d="M12 4v11M7 10l5 5 5-5" /><path d="M5 20h14" /></svg>
);
// The iPhone Share button: a box with an arrow out of the top.
export const IosShareIcon = ({ size = 18 }: P) => (
  <svg {...base(size)}><path d="M12 3v12M8 7l4-4 4 4" /><path d="M8.5 10H6.5a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1v-9a1 1 0 0 0-1-1h-2" /></svg>
);
/** A bowl, for Thali (DESIGN.md 8.6g). */
export const BowlIcon = ({ size = 20 }: P) => (
  <svg {...base(size)}><path d="M3.5 11h17a8.5 8.5 0 0 1-17 0z" /><path d="M8 19.5h8" /><path d="M9 7.5c0-1.4 1-1.4 1-2.8M13 7.5c0-1.4 1-1.4 1-2.8" /></svg>
);

import { BookOpen } from "lucide-react";

/**
 * The canonical Samga.ai lockup: an amber `BookOpen`-filled tile followed by
 * the "Samga" wordmark with an `.ai` accent in `amber-600`.
 *
 * Previously this markup was re-inlined in at least six places (DashboardLayout
 * desktop + mobile, ChatPage empty state, AuthPages, landing Navbar + Footer).
 * Consolidating here means a single token shift or typographic tweak propagates
 * everywhere at once.
 *
 * Sizes:
 *   - "sm"  — mobile header / inline chrome (24px tile, 15px text)
 *   - "md"  — dashboard sidebar / auth pages (28px tile, 16px text)
 *   - "lg"  — chat empty-state hero           (48px tile, 20px text)
 */
export type LogoSize = "sm" | "md" | "lg";

interface LogoProps {
  size?: LogoSize;
  /** Wrap the lockup in a link to `/`. Defaults to true. */
  asLink?: boolean;
  /** Extra classes applied to the outer flex container. */
  className?: string;
  /** Render only the tile, no wordmark. Useful for collapsed states. */
  markOnly?: boolean;
}

const TILE_BY_SIZE: Record<LogoSize, { box: string; icon: number }> = {
  sm: { box: "w-6 h-6 rounded", icon: 11 },
  md: { box: "w-7 h-7 rounded-md", icon: 14 },
  lg: { box: "w-12 h-12 rounded-xl shadow-sm", icon: 22 },
};

const TEXT_BY_SIZE: Record<LogoSize, React.CSSProperties> = {
  sm: { fontSize: 15, fontWeight: 600 },
  md: { fontSize: 16, fontWeight: 600, letterSpacing: "-0.01em" },
  lg: { fontSize: 20, fontWeight: 700 },
};

export function Logo({
  size = "md",
  asLink = true,
  className = "",
  markOnly = false,
}: LogoProps) {
  const tile = TILE_BY_SIZE[size];
  const textStyle = TEXT_BY_SIZE[size];
  const gap = size === "lg" ? "gap-3" : "gap-2";

  const mark = (
    <div
      className={`${tile.box} bg-amber-700 flex items-center justify-center`}
      aria-hidden="true"
    >
      <BookOpen size={tile.icon} className="text-white" />
    </div>
  );

  const wordmark = (
    <span className="text-zinc-900" style={textStyle}>
      Samga<span className="text-amber-800">.ai</span>
    </span>
  );

  const inner = markOnly ? (
    mark
  ) : (
    <>
      {mark}
      {wordmark}
    </>
  );

  const outerClass = `flex items-center ${gap} ${className}`.trim();

  if (!asLink) {
    return (
      <span className={outerClass} aria-label="Samga.ai">
        {inner}
      </span>
    );
  }

  return (
    <a href="/" className={outerClass} aria-label="Samga.ai">
      {inner}
    </a>
  );
}

export default Logo;

import { useEffect, useMemo, useState } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router";
import {
  BookOpen,
  MessageSquareText,
  ClipboardCheck,
  RotateCcw,
  Dumbbell,
  Target,
  Library,
  GraduationCap,
  CreditCard,
  Crown,
  Lock,
  Menu,
  LayoutDashboard,
  LogOut,
  User,
  Zap,
  Compass,
  Lightbulb,
  ChevronDown,
  X,
  Activity,
} from "lucide-react";
import { usePlan } from "../billing/PlanContext";
import { PaywallModal } from "../billing/PaywallModal";
import { useLang } from "../LanguageContext";
import { useAuth, isSamgaAdminUser } from "../auth/AuthContext";
import { Logo } from "../shared/Logo";
import { sidebarGroupButtonAriaLabel } from "./sidebarGroupAria";
import { filterNavTreeForAdmin } from "./navTreeFilter";

type GatedFeature = "exams" | "mistakes" | "training" | "gap-analysis" | "quiz";

interface NavLeaf {
  kind: "leaf";
  labelKey: string;
  href: string;
  icon: typeof BookOpen;
  gated?: GatedFeature;
  /**
   * v3.37 (2026-05-01): when true, the leaf is only rendered for users
   * who satisfy `isSamgaAdminUser` (the same gate `AdminOnlyRoute`
   * uses). The route itself is still wrapped in `AdminOnlyRoute`
   * server-side, so this flag is purely a UI affordance — non-admins
   * never see the link, admins see it as a normal sidebar item.
   */
  adminOnly?: boolean;
}

interface NavGroup {
  kind: "group";
  key: string;
  labelKey: string;
  icon: typeof BookOpen;
  children: NavLeaf[];
  /**
   * v3.37: same semantics as NavLeaf.adminOnly — when true, the
   * entire group (and all its children) is hidden from non-admins.
   * Lets us add an "Ops" section without polluting the 6-row default
   * shown to students.
   */
  adminOnly?: boolean;
}

type NavNode = NavLeaf | NavGroup;

// "Less is gold" — 6 top-level items. Sub-items live under collapsible groups
// so the sidebar scans as 6 rows by default, expanding on click.
const navTree: NavNode[] = [
  {
    kind: "leaf",
    labelKey: "dash.nav.overview",
    href: "/dashboard",
    icon: LayoutDashboard,
  },
  {
    kind: "leaf",
    labelKey: "dash.nav.chat",
    href: "/dashboard/chat",
    icon: MessageSquareText,
  },
  {
    kind: "group",
    key: "practice",
    labelKey: "dash.nav.practice",
    icon: Dumbbell,
    children: [
      {
        kind: "leaf",
        labelKey: "dash.nav.exams",
        href: "/dashboard/exams",
        icon: ClipboardCheck,
        gated: "exams",
      },
      {
        kind: "leaf",
        labelKey: "dash.nav.quiz",
        href: "/dashboard/quiz",
        icon: Zap,
        gated: "quiz",
      },
      {
        kind: "leaf",
        labelKey: "dash.nav.mistakes",
        href: "/dashboard/mistakes",
        icon: RotateCcw,
        gated: "mistakes",
      },
      {
        kind: "leaf",
        labelKey: "dash.nav.training",
        href: "/dashboard/training",
        icon: Dumbbell,
        gated: "training",
      },
      {
        kind: "leaf",
        labelKey: "dash.nav.gap",
        href: "/dashboard/gap-analysis",
        icon: Target,
        gated: "gap-analysis",
      },
      {
        kind: "leaf",
        labelKey: "dash.nav.weakTopicMode",
        href: "/dashboard/weak-topic-mode",
        icon: Lightbulb,
        gated: "gap-analysis",
      },
    ],
  },
  {
    kind: "leaf",
    labelKey: "dash.nav.library",
    href: "/dashboard/library",
    icon: Library,
  },
  {
    kind: "group",
    key: "universities",
    labelKey: "dash.nav.universities",
    icon: GraduationCap,
    children: [
      {
        kind: "leaf",
        labelKey: "dash.nav.unisList",
        href: "/dashboard/universities",
        icon: GraduationCap,
      },
      {
        kind: "leaf",
        labelKey: "dash.nav.strategyLab",
        href: "/dashboard/strategy-lab",
        icon: Compass,
      },
      {
        kind: "leaf",
        labelKey: "dash.nav.parentReport",
        href: "/dashboard/parent-report",
        icon: Compass,
      },
      {
        kind: "leaf",
        labelKey: "dash.nav.retakeGuide",
        href: "/dashboard/retake-guide",
        icon: Compass,
      },
    ],
  },
  {
    kind: "group",
    key: "account",
    labelKey: "dash.nav.account",
    icon: User,
    children: [
      {
        kind: "leaf",
        labelKey: "dash.nav.profile",
        href: "/dashboard/profile",
        icon: User,
      },
      {
        kind: "leaf",
        labelKey: "dash.nav.billing",
        href: "/dashboard/billing",
        icon: CreditCard,
      },
    ],
  },
  // v3.37 (2026-05-01): admin-only "Ops" group surfaces the
  // existing AdminOnlyRoute pages (RagStatsPage at /rag-stats since
  // s17, TrustSignalsPage at /trust-signals since v3.15,
  // RetakeGuideFetchStatsPage at /retake-guide-fetch-stats since
  // v3.35) as proper sidebar links instead of url-only pages. The
  // entire group is hidden from non-admins; routes stay
  // server-side gated by AdminOnlyRoute, so this is purely a
  // discoverability affordance.
  {
    kind: "group",
    key: "ops",
    labelKey: "dash.nav.ops",
    icon: Activity,
    adminOnly: true,
    children: [
      {
        kind: "leaf",
        labelKey: "dash.nav.opsRagStats",
        href: "/dashboard/rag-stats",
        icon: Activity,
      },
      {
        kind: "leaf",
        labelKey: "dash.nav.opsTrustSignals",
        href: "/dashboard/trust-signals",
        icon: Activity,
      },
      {
        kind: "leaf",
        labelKey: "dash.nav.opsRetakeGuideFetch",
        href: "/dashboard/retake-guide-fetch-stats",
        icon: Activity,
      },
    ],
  },
];

export function DashboardLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { isPremium, canAccess, chatModel } = usePlan();
  const { logout, user } = useAuth();
  const isAdmin = isSamgaAdminUser(user);
  const { lang, setLang, t } = useLang();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [paywallOpen, setPaywallOpen] = useState(false);
  const [paywallFeature, setPaywallFeature] = useState<
    GatedFeature | undefined
  >();

  // Mobile drawer hardening (F-24 polish):
  // 1. Close drawer whenever the route changes.
  // 2. Allow Escape to close.
  // 3. Lock body scroll while open so the page underneath doesn't move.
  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!sidebarOpen) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSidebarOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [sidebarOpen]);

  const isActive = (href: string) => {
    if (href === "/dashboard") return location.pathname === "/dashboard";
    return location.pathname.startsWith(href);
  };

  // Auto-expand the group that owns the current route.
  const initiallyOpenGroups = useMemo(() => {
    const open: Record<string, boolean> = {};
    for (const node of navTree) {
      if (
        node.kind === "group" &&
        node.children.some((c) => isActive(c.href))
      ) {
        open[node.key] = true;
      }
    }
    return open;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  const [openGroups, setOpenGroups] =
    useState<Record<string, boolean>>(initiallyOpenGroups);

  function toggleGroup(key: string) {
    setOpenGroups((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function handleLeafClick(
    leaf: NavLeaf,
    event?: React.MouseEvent<HTMLAnchorElement>,
  ) {
    if (leaf.gated && !canAccess(leaf.gated)) {
      // F-07 fix: leaf is now a real <Link>, so we must prevent default
      // navigation when the user lacks access — otherwise React Router
      // would push the URL before we could surface the paywall.
      event?.preventDefault();
      setPaywallFeature(leaf.gated);
      setPaywallOpen(true);
      setSidebarOpen(false);
      return;
    }
    setSidebarOpen(false);
    // Honour middle-click / cmd-click — if a modifier key is held, let the
    // browser open the link in a new tab/window naturally instead of doing
    // an SPA push that would no-op in the new context.
    if (
      event &&
      (event.metaKey || event.ctrlKey || event.shiftKey || event.button === 1)
    ) {
      return;
    }
  }

  const sidebar = (
    <div className="flex h-full flex-col bg-white">
      {/* Logo */}
      <div className="border-b border-zinc-200/80 px-5 py-4">
        <Logo size="md" />
      </div>

      {/* Plan badge + lang toggle */}
      <div className="flex items-center gap-2 px-4 pb-2 pt-4">
        <div
          className={`flex flex-1 items-start gap-2 rounded-lg border px-3 py-2 ${
            isPremium
              ? "border-zinc-300 bg-zinc-50"
              : "border-zinc-200 bg-white"
          }`}
        >
          {isPremium ? (
            <Crown size={13} className="mt-0.5 text-zinc-700" />
          ) : (
            <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-zinc-400" />
          )}
          <div className="min-w-0">
            <p
              className={isPremium ? "text-zinc-900" : "text-zinc-700"}
              style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.04em" }}
            >
              {isPremium ? t("dash.plan.premium") : t("dash.plan.free")}
            </p>
            <p
              className="mt-0.5 truncate text-zinc-600"
              style={{ fontSize: 10.5, fontWeight: 600 }}
            >
              {chatModel}
            </p>
          </div>
        </div>
        {/* Language toggle */}
        <div className="flex shrink-0 items-center overflow-hidden rounded-lg border border-zinc-200 bg-white">
          <button
            onClick={() => setLang("ru")}
            className={`px-2 py-1 transition-colors ${lang === "ru" ? "bg-zinc-100 text-zinc-900" : "text-zinc-600 hover:text-zinc-900"}`}
            style={{ fontSize: 10, fontWeight: 600 }}
          >
            RU
          </button>
          <button
            onClick={() => setLang("kz")}
            className={`px-2 py-1 transition-colors ${lang === "kz" ? "bg-zinc-100 text-zinc-900" : "text-zinc-600 hover:text-zinc-900"}`}
            style={{ fontSize: 10, fontWeight: 600 }}
          >
            KZ
          </button>
        </div>
      </div>

      {/* Nav */}
      <nav
        className="flex-1 overflow-y-auto px-3 py-2.5"
        aria-label={t("dash.nav.overview")}
      >
        {filterNavTreeForAdmin(navTree, isAdmin).map((node) => {
          if (node.kind === "leaf") {
            const Icon = node.icon;
            const active = isActive(node.href);
            const locked = node.gated && !canAccess(node.gated);
            return (
              <Link
                key={node.href}
                to={node.href}
                onClick={(event) => handleLeafClick(node, event)}
                aria-current={active ? "page" : undefined}
                className={`mb-1 flex min-h-[44px] w-full touch-manipulation items-center gap-2.5 rounded-lg px-3 py-2 text-left transition-colors ${
                  active
                    ? "bg-zinc-950 text-white"
                    : locked
                      ? "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-800"
                      : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800"
                }`}
              >
                <Icon
                  size={16}
                  className={
                    active ? "text-white" : locked ? "text-zinc-500" : ""
                  }
                />
                <span
                  className="flex-1"
                  style={{ fontSize: 13, fontWeight: active ? 600 : 500 }}
                >
                  {t(node.labelKey)}
                </span>
                {locked && <Lock size={12} className="text-zinc-500" />}
              </Link>
            );
          }

          // Group
          const GroupIcon = node.icon;
          const open = !!openGroups[node.key];
          const childActive = node.children.some((c) => isActive(c.href));
          return (
            <div key={node.key} className="mb-0.5">
              <button
                type="button"
                onClick={() => toggleGroup(node.key)}
                aria-expanded={open}
                aria-label={sidebarGroupButtonAriaLabel({
                  label: t(node.labelKey),
                  childCount: node.children.length,
                  open,
                  lang,
                })}
                className={`flex min-h-[44px] w-full touch-manipulation items-center gap-2.5 rounded-lg px-3 py-2 text-left transition-colors ${
                  childActive && !open
                    ? "bg-zinc-100 text-zinc-950"
                    : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800"
                }`}
              >
                <GroupIcon
                  size={16}
                  className={childActive ? "text-zinc-900" : ""}
                />
                <span
                  className="flex-1"
                  style={{ fontSize: 13, fontWeight: childActive ? 600 : 500 }}
                >
                  {t(node.labelKey)}
                </span>
                <ChevronDown
                  size={14}
                  className={`text-zinc-600 transition-transform ${open ? "rotate-180" : ""}`}
                />
              </button>
              {open && (
                <div className="mb-1 ml-3 mt-1 border-l border-zinc-200 pl-3">
                  {node.children.map((leaf) => {
                    const Icon = leaf.icon;
                    const active = isActive(leaf.href);
                    const locked = leaf.gated && !canAccess(leaf.gated);
                    return (
                      <Link
                        key={leaf.href}
                        to={leaf.href}
                        onClick={(event) => handleLeafClick(leaf, event)}
                        aria-current={active ? "page" : undefined}
                        className={`mb-1 flex min-h-[40px] w-full touch-manipulation items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left transition-colors ${
                          active
                            ? "bg-zinc-950 text-white"
                            : locked
                              ? "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-800"
                              : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800"
                        }`}
                      >
                        <Icon
                          size={14}
                          className={
                            active
                              ? "text-white"
                              : locked
                                ? "text-zinc-500"
                                : ""
                          }
                        />
                        <span
                          className="flex-1"
                          style={{
                            fontSize: 12.5,
                            fontWeight: active ? 600 : 500,
                          }}
                        >
                          {t(leaf.labelKey)}
                        </span>
                        {locked && <Lock size={11} className="text-zinc-500" />}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* Bottom */}
      <div className="border-t border-zinc-200/80 px-4 py-3">
        {!isPremium && (
          <button
            onClick={() => {
              setPaywallFeature(undefined);
              setPaywallOpen(true);
            }}
            className="mb-2.5 flex min-h-[44px] w-full touch-manipulation items-center justify-center gap-2 rounded-lg bg-zinc-950 px-3 py-2 text-white transition-colors hover:bg-black"
            style={{ fontSize: 12, fontWeight: 600 }}
          >
            <Crown size={14} />
            {t("dash.upgrade")}
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            logout();
            navigate("/login");
          }}
          className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900"
          style={{ fontSize: 12 }}
        >
          <LogOut size={14} />
          {t("dash.logout")}
        </button>
      </div>
    </div>
  );

  const isChatRoute = location.pathname.startsWith("/dashboard/chat");

  return (
    <div className="flex h-dvh overflow-hidden bg-zinc-100">
      {/* F-25 (s23+): "Skip to main content" link for keyboard users.
          Visually hidden by default, becomes visible on focus. */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-zinc-950 focus:px-4 focus:py-2 focus:text-white focus:outline-none focus:ring-2 focus:ring-zinc-300"
        style={{ fontSize: 13, fontWeight: 700 }}
      >
        {lang === "kz"
          ? "Негізгі мазмұнға өту"
          : "Перейти к основному содержимому"}
      </a>

      {/* Desktop sidebar */}
      <aside
        className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-zinc-200 bg-white lg:flex"
        aria-label="Dashboard sidebar"
      >
        {sidebar}
      </aside>

      {/* Mobile sidebar — drawer with backdrop, focus trap-friendly markup,
          Escape-to-close + body-scroll-lock handled in useEffect above.
          v3.65 (B5, 2026-05-02): give the role=dialog wrapper an
          accessible name. Pre-fix, axe-core flagged it as a nameless
          modal — screen readers announced "dialog" with no context. */}
      {sidebarOpen && (
        <div
          className="lg:hidden fixed inset-0 z-40"
          role="dialog"
          aria-modal="true"
          aria-label={
            lang === "kz" ? "Мобильді бүйір мәзірі" : "Мобильное боковое меню"
          }
        >
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setSidebarOpen(false)}
            aria-hidden="true"
          />
          <aside
            className="relative h-full w-72 max-w-[85vw] border-r border-zinc-200 bg-white shadow-xl"
            aria-label={
              lang === "kz" ? "Мобильді бүйір мәзірі" : "Мобильное боковое меню"
            }
          >
            <button
              type="button"
              onClick={() => setSidebarOpen(false)}
              aria-label={lang === "kz" ? "Мәзірді жабу" : "Закрыть меню"}
              className="absolute right-3 top-3 z-10 flex min-h-[44px] min-w-[44px] touch-manipulation items-center justify-center rounded-xl text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
            >
              <X size={20} />
            </button>
            {sidebar}
          </aside>
        </div>
      )}

      <div className="flex-1 lg:ml-60 h-full flex flex-col overflow-hidden">
        <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-3 border-b border-zinc-200 bg-white/95 px-4 backdrop-blur lg:hidden">
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            className="flex min-h-[44px] min-w-[44px] touch-manipulation items-center justify-center rounded-xl text-zinc-500"
            aria-label={lang === "kz" ? "Мәзірді ашу" : "Открыть меню"}
          >
            <Menu size={20} />
          </button>
          <Logo size="sm" />
        </header>
        {/* Chat route uses the full main area without its own scrollbar so the
            input bar can stay pinned to the bottom. Every other route gets a
            scroll container so long pages (library, universities…) work. */}
        {isChatRoute ? (
          <main
            id="main-content"
            tabIndex={-1}
            className="min-h-0 flex-1 bg-zinc-50 px-4 pt-4 md:px-6 md:pt-6"
          >
            <div className="max-w-7xl mx-auto h-full">
              <Outlet />
            </div>
          </main>
        ) : (
          <main
            id="main-content"
            tabIndex={-1}
            className="flex-1 overflow-y-auto bg-zinc-50 p-4 md:p-6"
          >
            <div className="max-w-7xl mx-auto">
              <Outlet />
            </div>
          </main>
        )}
      </div>

      <PaywallModal
        open={paywallOpen}
        onClose={() => setPaywallOpen(false)}
        feature={paywallFeature}
      />
    </div>
  );
}

import { Link, Navigate, useLocation } from "react-router";
import { ShieldAlert } from "lucide-react";
import {
  isSamgaAdminUser,
  isUserOnboardingComplete,
  useAuth,
} from "./AuthContext";
import { Logo } from "../shared/Logo";
import { SamgaLoadingPanel } from "../ui/SamgaLoadingPanel";
import { useLang } from "../LanguageContext";

export function RouteLoadingScreen({
  label = "Samga is opening your workspace...",
}: {
  label?: string;
}) {
  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-3xl">
        <div className="mb-5 flex justify-center">
          <Logo size="md" asLink={false} />
        </div>
        <SamgaLoadingPanel
          lang="en"
          eyebrow="Workspace"
          title={label}
          description="Checking your session, plan, and profile state before the dashboard comes into focus."
          hint="secure handoff"
        />
      </div>
    </div>
  );
}

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const { isAuthenticated, loading, user } = useAuth();

  if (loading) {
    return <RouteLoadingScreen />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  const isOnboardingPath = location.pathname === "/dashboard/onboarding";
  if (user && isUserOnboardingComplete(user) && isOnboardingPath) {
    return <Navigate to="/dashboard" replace />;
  }

  if (user && !isUserOnboardingComplete(user) && !isOnboardingPath) {
    return <Navigate to="/dashboard/onboarding" replace />;
  }

  return <>{children}</>;
}

function AdminAccessDenied() {
  const { lang } = useLang();
  const copy =
    lang === "kz"
      ? {
          title: "Тек әкімшілерге арналған",
          body: "Бұл бет Samga әкімшілеріне ғана ашық. Егер сізге қолжетімділік керек болса, Samga командасына хабарласыңыз.",
          dashboard: "Дашбордқа қайту",
          profile: "Профильге өту",
        }
      : {
          title: "Только для администраторов",
          body: "Эта страница доступна только администраторам Samga. Если вам нужен доступ, обратитесь к команде Samga.",
          dashboard: "Вернуться в дашборд",
          profile: "Перейти в профиль",
        };

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-lg rounded-xl border border-zinc-200 bg-white px-7 py-8 ">
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-50 text-amber-700">
          <ShieldAlert size={22} />
        </div>
        <h1
          className="text-zinc-950"
          style={{ fontSize: 22, fontWeight: 760, lineHeight: 1.2 }}
        >
          {copy.title}
        </h1>
        <p
          className="mt-3 text-zinc-600"
          style={{ fontSize: 14, lineHeight: 1.6 }}
        >
          {copy.body}
        </p>
        <div className="mt-6 flex flex-wrap gap-2">
          <Link
            to="/dashboard"
            className="inline-flex h-11 items-center gap-2 rounded-xl bg-zinc-900 px-4 text-white transition-colors hover:bg-zinc-800"
            style={{ fontSize: 13, fontWeight: 700 }}
          >
            {copy.dashboard}
          </Link>
          <Link
            to="/dashboard/profile"
            className="inline-flex h-11 items-center gap-2 rounded-xl border border-zinc-200 bg-white px-4 text-zinc-700 transition-colors hover:border-zinc-300 hover:bg-zinc-50"
            style={{ fontSize: 13, fontWeight: 700 }}
          >
            {copy.profile}
          </Link>
        </div>
      </div>
    </div>
  );
}

export function AdminOnlyRoute({ children }: { children: React.ReactNode }) {
  const { user, loading, isAuthenticated } = useAuth();

  if (loading) {
    return <RouteLoadingScreen />;
  }

  // If not logged in, defer to the standard login flow instead of
  // showing "admin only" to an anonymous visitor.
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (!isSamgaAdminUser(user)) {
    // BUG #3 fix (2026-04-24): previously silently redirected to /dashboard
    // with zero feedback. Now render an explicit access-denied panel so the
    // user understands why the page didn't load.
    return <AdminAccessDenied />;
  }

  return <>{children}</>;
}

export function PublicOnlyRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, loading, user } = useAuth();

  if (loading) {
    return <RouteLoadingScreen />;
  }

  if (isAuthenticated) {
    return (
      <Navigate
        to={
          isUserOnboardingComplete(user)
            ? "/dashboard"
            : "/dashboard/onboarding"
        }
        replace
      />
    );
  }

  return <>{children}</>;
}

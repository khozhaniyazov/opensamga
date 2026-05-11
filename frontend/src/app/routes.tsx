import { Suspense } from "react";
import { createBrowserRouter, Navigate } from "react-router";
import { RouteErrorBoundary } from "./components/shared/ErrorBoundaries";
import {
  AdminOnlyRoute,
  ProtectedRoute,
  PublicOnlyRoute,
  RouteLoadingScreen,
} from "./components/auth/RouteGuards";
import { lazyRetry } from "./lazyRetry";

// PERF-1 (2026-04-26): every routable surface is now lazy so the
// landing-page initial bundle only contains the landing component +
// the route shell. Previously LandingPage / AuthPages / DashboardLayout
// were imported eagerly, which forced the bundler to pull
// DashboardLayout's transitive deps (PaywallModal, BillingContext, ...)
// into the entry chunk even for an unauthenticated landing visitor.
const LandingPage = lazyRetry(() =>
  import("./components/landing/LandingPage").then((m) => ({
    default: m.LandingPage,
  })),
);
const LoginPage = lazyRetry(() =>
  import("./components/AuthPages").then((m) => ({ default: m.LoginPage })),
);
const RegisterPage = lazyRetry(() =>
  import("./components/AuthPages").then((m) => ({ default: m.RegisterPage })),
);
const DashboardLayout = lazyRetry(() =>
  import("./components/dashboard/DashboardLayout").then((m) => ({
    default: m.DashboardLayout,
  })),
);

const DashboardHome = lazyRetry(
  () => import("./components/dashboard/DashboardHome"),
);
const ChatPage = lazyRetry(() => import("./components/dashboard/ChatPage"));
const ExamsPage = lazyRetry(() => import("./components/dashboard/ExamsPage"));
const MistakeReviewPage = lazyRetry(
  () => import("./components/dashboard/MistakeReviewPage"),
);
const TrainingPage = lazyRetry(
  () => import("./components/dashboard/TrainingPage"),
);
const GapAnalysisPage = lazyRetry(
  () => import("./components/dashboard/GapAnalysisPage"),
);
const LibraryPage = lazyRetry(
  () => import("./components/dashboard/LibraryPage"),
);
const PdfViewerPage = lazyRetry(
  () => import("./components/dashboard/PdfViewerPage"),
);
const UniversitiesPage = lazyRetry(
  () => import("./components/dashboard/UniversitiesPage"),
);
const StrategyLabPage = lazyRetry(
  () => import("./components/dashboard/StrategyLabPage"),
);
const ParentReportPage = lazyRetry(
  () => import("./components/dashboard/ParentReportPage"),
);
const RetakeGuidePage = lazyRetry(
  () => import("./components/dashboard/RetakeGuidePage"),
);
const ParentReportSharedPage = lazyRetry(
  () => import("./components/ParentReportSharedPage"),
);
const WeakTopicModePage = lazyRetry(
  () => import("./components/dashboard/WeakTopicModePage"),
);
const BillingPage = lazyRetry(
  () => import("./components/dashboard/BillingPage"),
);
const ProfilePage = lazyRetry(
  () => import("./components/dashboard/ProfilePage"),
);
const OnboardingPage = lazyRetry(
  () => import("./components/dashboard/OnboardingPage"),
);
const QuizPage = lazyRetry(() => import("./components/dashboard/QuizPage"));
// Session 17 (2026-04-21) — ops-only RAG observability dashboard.
const RagStatsPage = lazyRetry(
  () => import("./components/dashboard/RagStatsPage"),
);
// v3.15 (2026-04-30) — admin trust-signal roll-up dashboard (Phase I row I2).
const TrustSignalsPage = lazyRetry(
  () => import("./components/dashboard/TrustSignalsPage"),
);
// v3.35 (2026-05-01) — admin retake-guide fetch-stats page; renders
// the v3.34 GET /api/admin/retake-guide/fetch-stats endpoint so ops
// can confirm the live testing.kz fetch state without shelling in.
const RetakeGuideFetchStatsPage = lazyRetry(
  () => import("./components/dashboard/RetakeGuideFetchStatsPage"),
);
const ExamAnalyticsPage = lazyRetry(
  () => import("./components/dashboard/ExamAnalyticsPage"),
);
const NotFoundPage = lazyRetry(() => import("./components/NotFoundPage"));
const PrivacyPage = lazyRetry(() =>
  import("./components/LegalPages").then((m) => ({ default: m.PrivacyPage })),
);
const TermsPage = lazyRetry(() =>
  import("./components/LegalPages").then((m) => ({ default: m.TermsPage })),
);

function ProtectedDashboard() {
  return (
    <RouteErrorBoundary>
      <ProtectedRoute>
        <Suspense fallback={<RouteLoadingScreen />}>
          <DashboardLayout />
        </Suspense>
      </ProtectedRoute>
    </RouteErrorBoundary>
  );
}

function ProtectedOnboarding() {
  return (
    <RouteErrorBoundary>
      <ProtectedRoute>
        <Suspense fallback={<RouteLoadingScreen />}>
          <OnboardingPage />
        </Suspense>
      </ProtectedRoute>
    </RouteErrorBoundary>
  );
}

function LoginRoute() {
  return (
    <RouteErrorBoundary>
      <PublicOnlyRoute>
        <Suspense fallback={<RouteLoadingScreen />}>
          <LoginPage />
        </Suspense>
      </PublicOnlyRoute>
    </RouteErrorBoundary>
  );
}

function RegisterRoute() {
  return (
    <RouteErrorBoundary>
      <PublicOnlyRoute>
        <Suspense fallback={<RouteLoadingScreen />}>
          <RegisterPage />
        </Suspense>
      </PublicOnlyRoute>
    </RouteErrorBoundary>
  );
}

function LandingRoute() {
  return (
    <RouteErrorBoundary>
      <Suspense fallback={<RouteLoadingScreen />}>
        <LandingPage />
      </Suspense>
    </RouteErrorBoundary>
  );
}

export const router = createBrowserRouter([
  {
    path: "/",
    Component: LandingRoute,
  },
  {
    path: "/login",
    Component: LoginRoute,
  },
  {
    path: "/register",
    Component: RegisterRoute,
  },
  // Friendly redirects for stray top-level paths some users may type
  {
    path: "/privacy",
    element: (
      <RouteErrorBoundary>
        <Suspense fallback={<RouteLoadingScreen />}>
          <PrivacyPage />
        </Suspense>
      </RouteErrorBoundary>
    ),
  },
  {
    path: "/terms",
    element: (
      <RouteErrorBoundary>
        <Suspense fallback={<RouteLoadingScreen />}>
          <TermsPage />
        </Suspense>
      </RouteErrorBoundary>
    ),
  },
  { path: "/chat", element: <Navigate to="/dashboard/chat" replace /> },
  { path: "/exams", element: <Navigate to="/dashboard/exams" replace /> },
  { path: "/library", element: <Navigate to="/dashboard/library" replace /> },
  {
    path: "/universities",
    element: <Navigate to="/dashboard/universities" replace />,
  },
  {
    path: "/strategy",
    element: <Navigate to="/dashboard/strategy-lab" replace />,
  },
  { path: "/profile", element: <Navigate to="/dashboard/profile" replace /> },
  { path: "/billing", element: <Navigate to="/dashboard/billing" replace /> },
  // v3.27 — public parent-facing share landing. No auth, token in URL.
  {
    path: "/parent-report/:token",
    element: (
      <RouteErrorBoundary>
        <Suspense fallback={<RouteLoadingScreen />}>
          <ParentReportSharedPage />
        </Suspense>
      </RouteErrorBoundary>
    ),
  },
  {
    path: "/dashboard/onboarding",
    Component: ProtectedOnboarding,
  },
  {
    path: "/dashboard",
    Component: ProtectedDashboard,
    children: [
      { index: true, Component: DashboardHome },
      { path: "chat", Component: ChatPage },
      {
        path: "exams",
        children: [
          { index: true, Component: ExamsPage },
          { path: "take", element: <Navigate to="/dashboard/exams" replace /> },
          { path: "analytics", Component: ExamAnalyticsPage },
        ],
      },
      // v3.70 (B12, 2026-05-02): "Практика" / "Аккаунт" sidebar
      // groups have no index route — they're collapsible parents
      // whose only purpose is grouping the leaves below. A student
      // who manually edits the URL or follows an outdated link to
      // /dashboard/practice or /dashboard/account previously hit
      // the catch-all 404. We now redirect to the first child of
      // each group (boss-chosen: /dashboard/quiz and
      // /dashboard/profile), which matches the sidebar mental model.
      {
        path: "practice",
        element: <Navigate to="/dashboard/quiz" replace />,
      },
      {
        path: "account",
        element: <Navigate to="/dashboard/profile" replace />,
      },
      { path: "quiz", Component: QuizPage },
      { path: "mistakes", Component: MistakeReviewPage },
      { path: "training", Component: TrainingPage },
      { path: "gap-analysis", Component: GapAnalysisPage },
      { path: "library", Component: LibraryPage },
      { path: "library/books/:bookId", Component: PdfViewerPage },
      { path: "universities", Component: UniversitiesPage },
      { path: "strategy-lab", Component: StrategyLabPage },
      { path: "parent-report", Component: ParentReportPage },
      { path: "retake-guide", Component: RetakeGuidePage },
      { path: "weak-topic-mode", Component: WeakTopicModePage },
      { path: "billing", Component: BillingPage },
      { path: "profile", Component: ProfilePage },
      {
        path: "portfolio",
        element: <Navigate to="/dashboard/universities" replace />,
      },
      {
        path: "commuter",
        element: <Navigate to="/dashboard/training" replace />,
      },
      {
        path: "buddy",
        element: <Navigate to="/dashboard/universities" replace />,
      },
      {
        path: "rag-stats",
        element: (
          <AdminOnlyRoute>
            <RagStatsPage />
          </AdminOnlyRoute>
        ),
      },
      {
        path: "trust-signals",
        element: (
          <AdminOnlyRoute>
            <TrustSignalsPage />
          </AdminOnlyRoute>
        ),
      },
      {
        path: "retake-guide-fetch-stats",
        element: (
          <AdminOnlyRoute>
            <RetakeGuideFetchStatsPage />
          </AdminOnlyRoute>
        ),
      },
    ],
  },
  {
    path: "*",
    element: (
      <RouteErrorBoundary>
        <Suspense fallback={<RouteLoadingScreen />}>
          <NotFoundPage />
        </Suspense>
      </RouteErrorBoundary>
    ),
  },
]);

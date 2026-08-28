import { lazy, Suspense } from "react";
import { Routes, Route, Navigate } from "react-router";
import Layout from "./components/Layout";
import RequireAuth from "./components/RequireAuth";
import PageLoader from "./components/PageLoader";

const LoginPage = lazy(() => import("./pages/auth/LoginPage"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Pipeline = lazy(() => import("./pages/Pipeline"));
const DealDetail = lazy(() => import("./pages/DealDetail"));
const Payments = lazy(() => import("./pages/Payments"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));
const CalendarPage = lazy(() => import("./pages/CalendarPage"));
const NotFound = lazy(() => import("./pages/NotFound"));

export default function App() {
  return (
    <Routes>
      {/* Public routes — no auth required */}
      <Route
        path="/login"
        element={
          <Suspense fallback={<PageLoader message="Loading…" />}>
            <LoginPage />
          </Suspense>
        }
      />

      {/* Protected routes — wrapped in Layout + RequireAuth */}
      <Route element={<RequireAuth><Layout /></RequireAuth>}>
        <Route
          index
          element={
            <Suspense fallback={<PageLoader message="Loading dashboard…" />}>
              <Dashboard />
            </Suspense>
          }
        />
        <Route
          path="pipeline"
          element={
            <Suspense fallback={<PageLoader message="Loading pipeline…" />}>
              <Pipeline />
            </Suspense>
          }
        />
        <Route
          path="pipeline/:id"
          element={
            <Suspense fallback={<PageLoader message="Loading deal…" />}>
              <DealDetail />
            </Suspense>
          }
        />
        <Route
          path="payments"
          element={
            <Suspense fallback={<PageLoader message="Loading payments…" />}>
              <Payments />
            </Suspense>
          }
        />
        <Route
          path="calendar"
          element={
            <Suspense fallback={<PageLoader message="Loading calendar…" />}>
              <CalendarPage />
            </Suspense>
          }
        />
        <Route
          path="settings"
          element={
            <Suspense fallback={<PageLoader message="Loading settings…" />}>
              <SettingsPage />
            </Suspense>
          }
        />
        {/* Rate Calculator remains post-beta scope (SPO-5 §10). */}
        <Route path="calculator" element={<Navigate to="/" replace />} />
        <Route
          path="*"
          element={
            <Suspense fallback={<PageLoader message="Loading…" />}>
              <NotFound />
            </Suspense>
          }
        />
      </Route>
    </Routes>
  );
}

import { lazy, Suspense } from "react";
import { Routes, Route } from "react-router";
import Layout from "./components/Layout";
import RequireAuth from "./components/RequireAuth";

const Dashboard = lazy(() => import("./pages/Dashboard"));
const Pipeline = lazy(() => import("./pages/Pipeline"));
const DealDetail = lazy(() => import("./pages/DealDetail"));
const Payments = lazy(() => import("./pages/Payments"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));
const CalendarPage = lazy(() => import("./pages/CalendarPage"));
const Calculator = lazy(() => import("./pages/Calculator"));
const LoginPage = lazy(() => import("./pages/auth/LoginPage"));
const NotFound = lazy(() => import("./pages/NotFound"));

function PageSpinner() {
  return (
    <div className="flex h-64 items-center justify-center">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-pine border-t-transparent" />
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      {/* Public routes — no auth required */}
      <Route path="/login" element={<LoginPage />} />

      {/* Protected routes — wrapped in Layout + RequireAuth */}
      <Route element={<RequireAuth><Layout /></RequireAuth>}>
        <Route
          index
          element={
            <Suspense fallback={<PageSpinner />}>
              <Dashboard />
            </Suspense>
          }
        />
        <Route
          path="pipeline"
          element={
            <Suspense fallback={<PageSpinner />}>
              <Pipeline />
            </Suspense>
          }
        />
        <Route
          path="pipeline/:id"
          element={
            <Suspense fallback={<PageSpinner />}>
              <DealDetail />
            </Suspense>
          }
        />
        <Route
          path="payments"
          element={
            <Suspense fallback={<PageSpinner />}>
              <Payments />
            </Suspense>
          }
        />
        <Route
          path="calendar"
          element={
            <Suspense fallback={<PageSpinner />}>
              <CalendarPage />
            </Suspense>
          }
        />
        <Route
          path="settings"
          element={
            <Suspense fallback={<PageSpinner />}>
              <SettingsPage />
            </Suspense>
          }
        />
        {/* Pulled forward from post-beta into the ASAP build (SPO-53). */}
        <Route
          path="calculator"
          element={
            <Suspense fallback={<PageSpinner />}>
              <Calculator />
            </Suspense>
          }
        />
        <Route
          path="*"
          element={
            <Suspense fallback={<PageSpinner />}>
              <NotFound />
            </Suspense>
          }
        />
      </Route>
    </Routes>
  );
}

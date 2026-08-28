import { Routes, Route, Navigate } from "react-router";
import Layout from "./components/Layout";
import RequireAuth from "./components/RequireAuth";
import Dashboard from "./pages/Dashboard";
import Pipeline from "./pages/Pipeline";
import DealDetail from "./pages/DealDetail";
import Payments from "./pages/Payments";
import SettingsPage from "./pages/SettingsPage";
import LoginPage from "./pages/auth/LoginPage";

export default function App() {
  return (
    <Routes>
      {/* Public routes — no auth required */}
      <Route path="/login" element={<LoginPage />} />

      {/* Protected routes — wrapped in Layout + RequireAuth */}
      <Route element={<RequireAuth><Layout /></RequireAuth>}>
        <Route index element={<Dashboard />} />
        <Route path="pipeline" element={<Pipeline />} />
        <Route path="pipeline/:id" element={<DealDetail />} />
        <Route path="payments" element={<Payments />} />
        <Route path="settings" element={<SettingsPage />} />
        {/* Calendar and the full Rate Calculator are approved post-beta scope
            (SPO-5 §10) — no half-wired screens in beta (D-005). */}
        <Route path="calendar" element={<Navigate to="/" replace />} />
        <Route path="calculator" element={<Navigate to="/" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

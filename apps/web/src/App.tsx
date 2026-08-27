import { Routes, Route } from "react-router";
import Layout from "./components/Layout";
import RequireAuth from "./components/RequireAuth";
import Dashboard from "./pages/Dashboard";
import Pipeline from "./pages/Pipeline";
import DealDetail from "./pages/DealDetail";
import Calculator from "./pages/Calculator";
import CalendarPage from "./pages/CalendarPage";
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
        <Route path="calendar" element={<CalendarPage />} />
        <Route path="calculator" element={<Calculator />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
    </Routes>
  );
}

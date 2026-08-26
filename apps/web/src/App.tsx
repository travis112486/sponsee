import { Routes, Route } from "react-router";
import Layout from "./components/Layout";
import Dashboard from "./pages/Dashboard";
import Pipeline from "./pages/Pipeline";
import Calculator from "./pages/Calculator";
import CalendarPage from "./pages/CalendarPage";
import Payments from "./pages/Payments";
import SettingsPage from "./pages/SettingsPage";

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="pipeline" element={<Pipeline />} />
        <Route path="payments" element={<Payments />} />
        <Route path="calendar" element={<CalendarPage />} />
        <Route path="calculator" element={<Calculator />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
    </Routes>
  );
}

import { createTRPCRouter } from "../trpc.js";
import { healthRouter } from "./health.js";
import { dashboardRouter } from "./dashboard.js";
import { dealsRouter } from "./deals.js";
import { brandRouter } from "./brand.js";
import { deliverableRouter } from "./deliverable.js";
import { contractRouter } from "./contract.js";
import { proofRouter } from "./proof.js";
import { invoiceRouter } from "./invoice.js";
import { chaseRouter } from "./chase.js";
import { calculatorRouter } from "./calculator.js";
import { settingsRouter } from "./settings.js";
import { billingRouter } from "../billing/router.js";
import { activityRouter } from "./activity.js";
import { calendarRouter } from "./calendar.js";
import { storageRouter } from "./storage.js";
import { aiDraftRouter } from "./aiDraft.js";

export const appRouter = createTRPCRouter({
  health: healthRouter,
  dashboard: dashboardRouter,
  deals: dealsRouter,
  brand: brandRouter,
  deliverable: deliverableRouter,
  contract: contractRouter,
  proof: proofRouter,
  invoice: invoiceRouter,
  chase: chaseRouter,
  calculator: calculatorRouter,
  settings: settingsRouter,
  billing: billingRouter,
  activity: activityRouter,
  calendar: calendarRouter,
  storage: storageRouter,
  aiDraft: aiDraftRouter,
});

export type AppRouter = typeof appRouter;

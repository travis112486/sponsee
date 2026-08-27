import { createTRPCRouter } from "../trpc.js";
import { healthRouter } from "./health.js";
import { dealsRouter } from "./deals.js";
import { brandRouter } from "./brand.js";
import { deliverableRouter } from "./deliverable.js";
import { invoiceRouter } from "./invoice.js";
import { chaseRouter } from "./chase.js";
import { calculatorRouter } from "./calculator.js";
import { settingsRouter } from "./settings.js";

export const appRouter = createTRPCRouter({
  health: healthRouter,
  deals: dealsRouter,
  brand: brandRouter,
  deliverable: deliverableRouter,
  invoice: invoiceRouter,
  chase: chaseRouter,
  calculator: calculatorRouter,
  settings: settingsRouter,
});

export type AppRouter = typeof appRouter;

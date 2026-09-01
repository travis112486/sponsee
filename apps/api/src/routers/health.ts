import { createTRPCRouter, publicProcedure } from "../trpc.js";

export const healthRouter = createTRPCRouter({
  check: publicProcedure.query(() => {
    return { status: "ok", version: "0.1.0" };
  }),
});

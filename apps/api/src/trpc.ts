import { initTRPC, TRPCError } from "@trpc/server";
import { type Context } from "./context.js";
import superjson from "superjson";

const t = initTRPC.context<Context>().create({
  transformer: superjson,
});

export const createTRPCRouter = t.router;
export const publicProcedure = t.procedure;

export const authedProcedure = t.procedure.use(async ({ ctx, next }) => {
  if (!ctx.session) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({
    ctx: {
      ...ctx,
      session: ctx.session,
    },
  });
});

export const creatorScopedProcedure = authedProcedure.use(async ({ ctx, next }) => {
  if (!ctx.creatorId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "No creator workspace" });
  }
  return next({
    ctx: {
      ...ctx,
      creatorId: ctx.creatorId,
    },
  });
});

import { initTRPC, TRPCError } from "@trpc/server";
import { type Context } from "./context.js";
import { formatTRPCError } from "./error-formatter.js";
import superjson from "superjson";

const t = initTRPC.context<Context>().create({
  transformer: superjson,
  // Input-validation failures otherwise arrive at the client as a stringified
  // ZodError in `error.message`. See error-formatter.ts.
  errorFormatter: formatTRPCError,
});

export const createTRPCRouter = t.router;
export const publicProcedure = t.procedure;

export const authedProcedure = t.procedure.use(async ({ ctx, next }) => {
  if (!ctx.session?.user) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({
    ctx: {
      ...ctx,
      session: ctx.session,
      user: ctx.session.user,
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

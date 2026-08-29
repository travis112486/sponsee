# syntax=docker/dockerfile:1
FROM node:22-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

FROM base AS build
COPY . /app
WORKDIR /app
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
RUN pnpm run -r build
RUN pnpm deploy --legacy --filter=@sponsee/api --prod /prod/api

# The Render pre-deploy command runs the migrator out of this image (SPO-74), so
# fail the build here rather than at deploy time if --prod pruning ever drops it.
# The migrations folder is the fragile half: drizzle-kit is a devDependency, and
# @sponsee/db only keeps `drizzle/` because its package.json lists it in `files`.
RUN test -f /prod/api/node_modules/@sponsee/db/dist/migrate.js \
  && test -f /prod/api/node_modules/@sponsee/db/drizzle/meta/_journal.json

FROM base AS api
COPY --from=build /prod/api /prod/api
WORKDIR /prod/api
ENV PORT=8080
ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "dist/index.js"]

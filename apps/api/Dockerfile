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

FROM base AS api
COPY --from=build /prod/api /prod/api
WORKDIR /prod/api
ENV PORT=8080
ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "dist/index.js"]

FROM node:22-bookworm-slim AS build

WORKDIR /app
COPY . .
RUN npm install
RUN npm run build:api

FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8787

COPY --from=build /app/package*.json ./
COPY --from=build /app/apps ./apps
COPY --from=build /app/packages ./packages
COPY --from=build /app/node_modules ./node_modules

EXPOSE 8787

CMD ["node", "apps/api/dist/server.js"]

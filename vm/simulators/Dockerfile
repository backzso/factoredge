# One image for all simulators; docker-compose selects the entry point via `command`.
# --omit=optional skips serialport (native, optional in modbus-serial, unused here).

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=optional
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --omit=optional && npm cache clean --force
COPY --from=build /app/dist ./dist
# Docker copies this ownership into a fresh named volume mounted at /data.
RUN mkdir -p /data && chown node:node /data
USER node

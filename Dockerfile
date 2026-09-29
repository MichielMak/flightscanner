FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm test && npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8080 DATA_DIR=/data WEB_ROOT=/app/dist/web
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force && mkdir -p /data && chown node:node /data
COPY --from=build /app/dist ./dist
USER node
EXPOSE 8080
VOLUME /data
HEALTHCHECK --interval=1m --timeout=5s CMD wget -qO- http://localhost:8080/api/config > /dev/null || exit 1
CMD ["node", "dist/server/index.js"]

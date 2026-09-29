FROM node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402 AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm test && npm run build

FROM node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402
WORKDIR /app
ENV NODE_ENV=production PORT=8080 DATA_DIR=/data WEB_ROOT=/app/dist/web
COPY package.json package-lock.json ./
# npm, corepack and yarn are only needed to install dependencies, so drop them to keep their bundled CVEs out of the image.
RUN npm ci --omit=dev && npm cache clean --force && mkdir -p /data && chown node:node /data \
  && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
    /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
    /opt/yarn-* /usr/local/bin/yarn /usr/local/bin/yarnpkg /root/.npm
COPY --from=build /app/dist ./dist
USER node
EXPOSE 8080
VOLUME /data
HEALTHCHECK --interval=1m --timeout=5s CMD wget -qO- http://localhost:8080/api/health > /dev/null || exit 1
CMD ["node", "dist/server/index.js"]

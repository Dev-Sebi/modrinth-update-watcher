FROM node:22-alpine

WORKDIR /app

# Dependencies are copied first so editing the source does not reinstall them.
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

COPY src ./src

ENV NODE_ENV=production \
    StateFile=/data/state.json

RUN mkdir -p /data && chown -R node:node /data /app
USER node
VOLUME ["/data"]

CMD ["node", "src/index.js", "--watch"]

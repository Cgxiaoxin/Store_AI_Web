FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 DATABASE_PATH=/app/data/store.sqlite
RUN mkdir -p /app/data && chown node:node /app/data && chmod 700 /app/data
COPY --chown=node:node package.json ./
COPY --chown=node:node src ./src
COPY --chown=node:node public ./public
USER node
EXPOSE 3000
CMD ["node", "src/server.mjs"]

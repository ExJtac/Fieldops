FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4328 DATABASE_PATH=/app/data/fieldops.sqlite
COPY --from=build /app/package*.json ./
RUN npm ci --omit=dev && mkdir /app/data && chown node:node /app/data
COPY --from=build /app/server ./server
COPY --from=build /app/dist ./dist
USER node
EXPOSE 4328
VOLUME ["/app/data"]
CMD ["npm", "start"]

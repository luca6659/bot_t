FROM node:24-slim AS build
WORKDIR /opt/app
COPY package*.json tsconfig*.json ./
RUN npm ci
COPY src ./src
RUN npm run build

FROM node:24-slim
WORKDIR /opt/app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /opt/app/dist ./dist
USER node
CMD ["node", "dist/app.js"]

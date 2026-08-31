# ---- Build stage: produce static SPA ----
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json ./server/
COPY web/package.json ./web/
RUN npm ci
COPY web ./web
# Same-origin API in production (Nginx proxies /api and /uploads to the API).
ENV VITE_API_URL=/api
RUN npm run build --workspace web

# ---- Serve stage: Nginx ----
FROM nginx:alpine
COPY nginx/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/web/dist /usr/share/nginx/html
EXPOSE 80

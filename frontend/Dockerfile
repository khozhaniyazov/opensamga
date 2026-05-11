FROM node:22-alpine as build

WORKDIR /app

# Build context is `./frontend` (see docker-compose.yml). Session 16
# (2026-04-21) — drop the `frontend/` prefix; paths are relative to the
# build context, not the repo root.
COPY package*.json ./
RUN npm ci
COPY . ./

ARG VITE_API_URL=http://localhost:8000
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
# Nginx vhost config lives under repo-root `deploy/`. We bake it into
# the image via a relative path that works from the frontend context
# because the repo's deploy/ dir is included by docker build context
# WHEN the build is invoked with `context: .` Since our compose
# context is `./frontend`, copy the config from within the frontend
# tree. Keep a mirrored copy at `frontend/deploy/nginx_frontend.conf`.
COPY deploy/nginx_frontend.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]

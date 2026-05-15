FROM node:20-alpine as build

WORKDIR /app

# Build context is `./frontend`. Paths below are relative to that
# context, not the repo root.
COPY package*.json ./
RUN npm ci
COPY . ./

# opensamga round-3 (2026-05-15) audit: NO default for VITE_API_URL.
# `vite build` substitutes `import.meta.env.VITE_API_URL` at compile
# time; baking `http://localhost:8001` shipped a JS bundle that called
# the *visitor's* localhost when they hit a deploy that forgot to pass
# `--build-arg VITE_API_URL=…`. Empty string defaults to a same-origin
# call (handled by `import.meta.env.VITE_API_URL ?? ""` on the client),
# which is what nginx_frontend.conf assumes anyway.
ARG VITE_API_URL=
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

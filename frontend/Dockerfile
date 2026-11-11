# --- Build the Angular bundle ---------------------------------------------
# Only produces static files, so it runs natively on the CI runner instead of
# under QEMU; just the nginx stage below is built per platform.
FROM --platform=$BUILDPLATFORM node:24-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# --- Serve via nginx -------------------------------------------------------
FROM nginx:alpine

# nginx's entrypoint renders templates/*.template with envsubst at startup.
# Both variables need a value in the environment — envsubst only replaces
# variables that are *set*, so an unset one would be left in the config
# verbatim and nginx would refuse to start. Hence the defaults here rather
# than in the template.
ENV PORT=80
# host:port the /api/ location proxies to, as seen from *inside* this
# container (the container name on the deployment network).
ENV API_UPSTREAM=katakana-reading-backend:8000

COPY nginx.conf /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist/browser /usr/share/nginx/html

EXPOSE 80

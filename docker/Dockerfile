FROM caddy:2-builder AS builder

RUN xcaddy build \
    --with github.com/caddyserver/cache-handler

FROM caddy:2

RUN apk add --no-cache iproute2

COPY --from=builder /usr/bin/caddy /usr/bin/caddy
COPY docker/Caddyfile /etc/caddy/Caddyfile

EXPOSE 8443 8444

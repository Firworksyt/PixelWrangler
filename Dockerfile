FROM nginxinc/nginx-unprivileged:1.31.7-alpine@sha256:b5047b9b76845eac124358373c6852377c52e4b05834a47647e955dd91cb8f1e

ARG COMMIT_HASH=unknown
ARG COMMIT_DATE
ARG BUILD_TIMESTAMP

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY public/ /usr/share/nginx/html/

# version.json is shown in the page footer and used by the healthcheck.
USER root
RUN printf '{"commit":"%s","commitDate":"%s","built":"%s"}\n' "$COMMIT_HASH" "$COMMIT_DATE" "$BUILD_TIMESTAMP" \
        > /usr/share/nginx/html/version.json
USER 101

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/version.json || exit 1

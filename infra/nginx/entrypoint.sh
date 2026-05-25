#!/bin/sh
# nginx prod entrypoint — renders the envsubst template manually.
#
# The stock `nginx:alpine` image ships `/docker-entrypoint.d/20-envsubst-
# on-templates.sh` which iterates `/etc/nginx/templates/*` and substitutes
# `${VAR}` references against the container env, writing the result to
# `/etc/nginx/conf.d/`. `macbre/nginx-brotli` is a stripped build that
# doesn't include that script, so without this step nginx would start with
# an empty conf.d and reject every connection.
#
# We only have one template (`default.conf.template`) and two variables
# (`$DOMAIN`, `$ALLOWED_ORIGIN`), so the rendering is one envsubst call —
# no need to mirror the full upstream script.
set -e

envsubst '$DOMAIN $ALLOWED_ORIGIN' \
  < /etc/nginx/templates/default.conf.template \
  > /etc/nginx/conf.d/default.conf

exec "$@"

#!/bin/bash

echo "### Renewing SSL certificates ..."
docker-compose -f docker-compose.prod.yml run --rm certbot renew

echo "### Reloading nginx ..."
docker-compose -f docker-compose.prod.yml exec nginx nginx -s reload

echo "### SSL certificates renewed successfully!"

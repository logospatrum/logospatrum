FROM nginx:alpine

# Install OpenSSL for certificate generation
RUN apk add --no-cache openssl

# Copy nginx configuration
COPY nginx.conf /etc/nginx/nginx.conf

# Copy SSL generation script
COPY generate-ssl.sh /usr/local/bin/generate-ssl.sh
RUN chmod +x /usr/local/bin/generate-ssl.sh

# Create directories
RUN mkdir -p /etc/nginx/ssl /var/www/certbot

# Generate self-signed certificates on startup
RUN /usr/local/bin/generate-ssl.sh

EXPOSE 80 443

CMD ["nginx", "-g", "daemon off;"]

#!/bin/sh
set -e

# Default PORT to 8080 if not set (standard GCP Cloud Run port)
export PORT="${PORT:-8080}"

echo "=========================================================="
echo " Starting PugArch Connect Portal"
echo " Listening on PORT: ${PORT}"
echo " Backend internal port: 5001"
echo " Frontend internal port: 3000"
echo "=========================================================="

# Substitute PORT into nginx template
envsubst '${PORT}' < /etc/nginx/nginx.conf.template > /etc/nginx/nginx.conf

# Start supervisord to manage backend, frontend, and nginx
exec /usr/bin/supervisord -c /etc/supervisor/conf.d/supervisord.conf

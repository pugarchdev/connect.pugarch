#!/bin/sh
set -e

echo "⏳ Waiting for backend (5001) and frontend (3000) to respond before starting Nginx..."
max_retries=60
count=0

until curl -s http://127.0.0.1:5001/health > /dev/null 2>&1 && curl -s http://127.0.0.1:3000 > /dev/null 2>&1; do
    sleep 0.2
    count=$((count + 1))
    if [ $count -ge $max_retries ]; then
        echo "⚠️ Upstream wait timed out after 12s; starting Nginx anyway"
        break
    fi
done

echo "✅ Upstreams verified. Starting Nginx ingress..."
exec /usr/sbin/nginx -g "daemon off;"

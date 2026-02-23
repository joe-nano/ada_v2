#!/bin/bash
# Script to get the current Cloudflare Tunnel URL for JODA

echo "Getting current Cloudflare Tunnel URL..."
if [ -r /var/log/cloudflared-joda.log ]; then
    URL=$(tail -100 /var/log/cloudflared-joda.log 2>/dev/null | grep -oP 'https://[a-z0-9-]+\.trycloudflare\.com' | tail -1)
else
    URL=$(sudo tail -100 /var/log/cloudflared-joda.log 2>/dev/null | grep -oP 'https://[a-z0-9-]+\.trycloudflare\.com' | tail -1)
fi

if [ -z "$URL" ]; then
    echo "No tunnel URL found. Checking if service is running..."
    sudo systemctl status joda-tunnel.service --no-pager | head -5
    echo ""
    echo "Waiting for tunnel to initialize..."
    sleep 5
    if [ -r /var/log/cloudflared-joda.log ]; then
        URL=$(tail -100 /var/log/cloudflared-joda.log 2>/dev/null | grep -oP 'https://[a-z0-9-]+\.trycloudflare\.com' | tail -1)
    else
        URL=$(sudo tail -100 /var/log/cloudflared-joda.log 2>/dev/null | grep -oP 'https://[a-z0-9-]+\.trycloudflare\.com' | tail -1)
    fi
fi

if [ -n "$URL" ]; then
    echo "✅ JODA Frontend is accessible at:"
    echo "   $URL"
    echo ""
    echo "Note: This is a quick tunnel URL that will change if the service restarts."
    echo "For a permanent URL, set up a named tunnel with your Cloudflare account."
else
    echo "❌ Could not retrieve tunnel URL. Check the logs:"
    echo "   sudo journalctl -u joda-tunnel.service -n 50"
fi

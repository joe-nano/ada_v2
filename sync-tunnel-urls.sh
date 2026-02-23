#!/bin/bash

# Script to sync .env with current Cloudflare tunnel URLs
# Run this if tunnels restart independently of JODA services

echo "🔄 Syncing .env with current tunnel URLs..."
echo ""

# Get backend tunnel URL
if [ -r /var/log/cloudflared-backend.log ]; then
    BACKEND_TUNNEL_URL=$(tail -100 /var/log/cloudflared-backend.log 2>/dev/null | grep -oP 'https://[a-z0-9-]+\.trycloudflare\.com' | tail -1)
else
    BACKEND_TUNNEL_URL=$(sudo tail -100 /var/log/cloudflared-backend.log 2>/dev/null | grep -oP 'https://[a-z0-9-]+\.trycloudflare\.com' | tail -1)
fi

if [ -z "$BACKEND_TUNNEL_URL" ]; then
    echo "❌ Backend tunnel URL not found!"
    echo "   Make sure joda-backend-tunnel.service is running:"
    echo "   sudo systemctl status joda-backend-tunnel.service"
    exit 1
fi

echo "✅ Found backend tunnel: $BACKEND_TUNNEL_URL"

# Update .env file
cd /root/Desktop/joda_ai_local

if [ -f ".env" ]; then
    if grep -q "^VITE_SOCKET_URL=" .env; then
        # Update existing line
        sed -i "s|^VITE_SOCKET_URL=.*|VITE_SOCKET_URL=$BACKEND_TUNNEL_URL|" .env
        echo "✅ Updated VITE_SOCKET_URL in .env"
    else
        # Add new line
        echo "VITE_SOCKET_URL=$BACKEND_TUNNEL_URL" >> .env
        echo "✅ Added VITE_SOCKET_URL to .env"
    fi
else
    echo "⚠️  .env file not found, creating it..."
    echo "VITE_SOCKET_URL=$BACKEND_TUNNEL_URL" > .env
    echo "✅ Created .env with VITE_SOCKET_URL"
fi

echo ""
echo "📝 Current configuration:"
cat .env | grep VITE_SOCKET_URL
echo ""
echo "✅ Sync complete!"
echo ""
echo "⚠️  Note: You need to restart the frontend for changes to take effect:"
echo "   ./stop-joda.sh && ./start-joda.sh"

#!/bin/bash

echo "=================================================="
echo "  🌐 J.O.D.A Cloudflare Tunnel URLs"
echo "=================================================="
echo ""

# Get frontend tunnel URL
if [ -r /var/log/cloudflared-joda.log ]; then
    FRONTEND_URL=$(tail -100 /var/log/cloudflared-joda.log 2>/dev/null | grep -oP 'https://[a-z0-9-]+\.trycloudflare\.com' | tail -1)
else
    FRONTEND_URL=$(sudo tail -100 /var/log/cloudflared-joda.log 2>/dev/null | grep -oP 'https://[a-z0-9-]+\.trycloudflare\.com' | tail -1)
fi

# Get backend tunnel URL
if [ -r /var/log/cloudflared-backend.log ]; then
    BACKEND_URL=$(tail -100 /var/log/cloudflared-backend.log 2>/dev/null | grep -oP 'https://[a-z0-9-]+\.trycloudflare\.com' | tail -1)
else
    BACKEND_URL=$(sudo tail -100 /var/log/cloudflared-backend.log 2>/dev/null | grep -oP 'https://[a-z0-9-]+\.trycloudflare\.com' | tail -1)
fi

if [ -n "$FRONTEND_URL" ]; then
    echo "✅ Frontend (Access J.O.D.A here):"
    echo "   $FRONTEND_URL"
else
    echo "❌ Frontend tunnel not found"
fi

echo ""

if [ -n "$BACKEND_URL" ]; then
    echo "✅ Backend (WebSocket connection):"
    echo "   $BACKEND_URL"
else
    echo "❌ Backend tunnel not found"
fi

echo ""
echo "=================================================="
echo ""
echo "📝 Configuration:"
echo "   - Frontend tunnel points to: localhost:5173"
echo "   - Backend tunnel points to: localhost:8765"
echo "   - VITE_SOCKET_URL in .env: $BACKEND_URL"
echo ""
echo "Note: These are quick tunnel URLs that change on restart."
echo "For permanent URLs, set up named tunnels."

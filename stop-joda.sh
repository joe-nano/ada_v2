#!/bin/bash

# JODA Stop Script
# Gracefully stops JODA backend and frontend processes

echo "🛑 Stopping JODA..."

# Check if PID file exists
if [ ! -f ".joda.pid" ]; then
    echo "⚠️  No running JODA instance found (.joda.pid file missing)"
    echo "Searching for running processes..."

    # Try to find and kill any running JODA processes
    pkill -f "python3 server.py" && echo "✅ Stopped backend server"
    pkill -f "vite" && echo "✅ Stopped frontend dev server"

    exit 0
fi

# Read PIDs from file
BACKEND_PID=$(sed -n '1p' .joda.pid)
FRONTEND_PID=$(sed -n '2p' .joda.pid)

# Stop backend
if ps -p $BACKEND_PID > /dev/null 2>&1; then
    kill $BACKEND_PID
    echo "✅ Backend stopped (PID: $BACKEND_PID)"
else
    echo "⚠️  Backend process not found (PID: $BACKEND_PID)"
fi

# Stop frontend
if ps -p $FRONTEND_PID > /dev/null 2>&1; then
    kill $FRONTEND_PID
    echo "✅ Frontend stopped (PID: $FRONTEND_PID)"
else
    echo "⚠️  Frontend process not found (PID: $FRONTEND_PID)"
fi

# Clean up PID file
rm -f .joda.pid

echo ""
echo "🧹 Cleanup: stopping any stray JODA processes..."

# If the PID file contained a wrapper shell PID (older start script), the backend python may still be running.
pkill -f "/root/Desktop/joda_ai_local/venv/bin/python server.py" 2>/dev/null && echo "✅ Stopped backend server (fallback)" || true
pkill -f "node ./node_modules/vite/dist/node/cli.js" 2>/dev/null && echo "✅ Stopped frontend dev server (fallback)" || true
pkill -f "python3 -m http.server 5173" 2>/dev/null && echo "✅ Stopped frontend static server (fallback)" || true

echo ""
echo "✨ JODA has been stopped"

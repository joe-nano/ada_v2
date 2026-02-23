#!/bin/bash

# JODA Startup Script
# J.O.D.A - Jarvis's Operative Developer Assistant

set -e

echo "=================================================="
echo "  🤖 J.O.D.A - Jarvis's Operative Developer Assistant"
echo "=================================================="
echo ""

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
    echo "❌ Error: package.json not found. Please run this script from the joda_ai directory."
    exit 1
fi

# Check for Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Error: Node.js is not installed. Please install Node.js first."
    exit 1
fi

# Check for Python
if ! command -v python3 &> /dev/null; then
    echo "❌ Error: Python 3 is not installed. Please install Python 3 first."
    exit 1
fi

echo "📦 Checking dependencies..."

# Load environment variables from .env (if present)
if [ -f ".env" ]; then
    set -a
    # shellcheck disable=SC1091
    source ".env"
    set +a
fi

# Prefer binding locally when using Cloudflare tunnels (cloudflared forwards to localhost).
# Override if you need LAN/VPS direct access.
export JODA_BACKEND_HOST="${JODA_BACKEND_HOST:-0.0.0.0}"
export JODA_FRONTEND_HOST="${JODA_FRONTEND_HOST:-0.0.0.0}"

# Record project root for stable absolute paths (script may `cd` later).
ROOT_DIR="$(pwd)"

# Install npm dependencies if node_modules doesn't exist
if [ ! -d "node_modules" ]; then
    echo "📥 Installing npm dependencies..."
    npm install
else
    echo "✅ npm dependencies already installed"
fi

# Python environment:
# This workspace can live on a FUSE/rclone mount that doesn't preserve venv symlinks/executables.
# Prefer venv/bin/python when available; otherwise fall back to system python with PYTHONPATH pointed at venv site-packages.
PYTHON_CMD=""
PYTHON_ENV=()

if [ -d "venv" ] && [ -f "venv/pyvenv.cfg" ]; then
    if [ -x "venv/bin/python" ]; then
        echo "✅ Python venv python detected"
        PYTHON_CMD="$ROOT_DIR/venv/bin/python"
    else
        echo "⚠️  venv exists but venv/bin/python is missing/not executable."
        echo "   Falling back to system python + PYTHONPATH (FUSE venv workaround)."
        SITE_PACKAGES=$(ls -d venv/lib/python*/site-packages 2>/dev/null | head -n 1)
        if [ -z "$SITE_PACKAGES" ]; then
            echo "❌ Error: Could not find venv site-packages. Recreate venv on a local filesystem."
            exit 1
        fi
        SITE_PACKAGES="$ROOT_DIR/$SITE_PACKAGES"
        PYTHON_CMD="python3"
        # Avoid writing __pycache__ across the rclone/FUSE mount (very slow); use tmp instead.
        PYTHON_ENV=("PYTHONPATH=$SITE_PACKAGES" "PYTHONPYCACHEPREFIX=/tmp/joda_pycache")
    fi
else
    echo "📥 Creating Python virtual environment..."
    python3 -m venv venv
    echo "📥 Installing Python dependencies..."
    source venv/bin/activate
    pip install -r requirements.txt
    PYTHON_CMD="$ROOT_DIR/venv/bin/python"
fi

echo ""
echo "🚀 Starting JODA..."
echo ""
echo "Backend will run on: http://$JODA_BACKEND_HOST:8765"
echo "Frontend will run on: http://$JODA_FRONTEND_HOST:5173"
echo ""
echo "🌐 VPS Access:"
echo "   Backend:  http://72.62.165.102:8765"
echo "   Frontend: http://72.62.165.102:5173"
echo ""
echo "Press Ctrl+C to stop JODA"
echo ""

# Create log directory if it doesn't exist
mkdir -p logs

# Update .env with current backend tunnel URL
echo "🔗 Checking Cloudflare tunnel status..."
# If VITE_SOCKET_URL already points to a named tunnel domain (not trycloudflare), skip auto-detection.
CURRENT_SOCKET_URL=$(grep -oP '(?<=^VITE_SOCKET_URL=).*' .env 2>/dev/null || true)
if echo "$CURRENT_SOCKET_URL" | grep -qv 'trycloudflare\.com' && [ -n "$CURRENT_SOCKET_URL" ]; then
    echo "✅ Named tunnel URL already set: $CURRENT_SOCKET_URL (skipping quick tunnel detection)"
else
    if [ -r /var/log/cloudflared-backend.log ]; then
        BACKEND_TUNNEL_URL=$(tail -100 /var/log/cloudflared-backend.log 2>/dev/null | grep -oP 'https://[a-z0-9-]+\.trycloudflare\.com' | tail -1 || true)
    else
        BACKEND_TUNNEL_URL=$(sudo tail -100 /var/log/cloudflared-backend.log 2>/dev/null | grep -oP 'https://[a-z0-9-]+\.trycloudflare\.com' | tail -1 || true)
    fi

    if [ -n "$BACKEND_TUNNEL_URL" ]; then
        echo "✅ Backend tunnel detected: $BACKEND_TUNNEL_URL"

        # Update or add VITE_SOCKET_URL in .env
        if [ -f ".env" ]; then
            if grep -q "^VITE_SOCKET_URL=" .env; then
                # Update existing line
                sed -i "s|^VITE_SOCKET_URL=.*|VITE_SOCKET_URL=$BACKEND_TUNNEL_URL|" .env
            else
                # Add new line
                echo "VITE_SOCKET_URL=$BACKEND_TUNNEL_URL" >> .env
            fi
            echo "✅ Updated .env with backend tunnel URL"
        else
            echo "⚠️  Warning: .env file not found, creating it..."
            echo "VITE_SOCKET_URL=$BACKEND_TUNNEL_URL" > .env
        fi
    else
        echo "⚠️  Warning: Backend tunnel not detected. Using direct IP connection."
        echo "   If you're using Cloudflare tunnels, make sure joda-backend-tunnel.service is running:"
        echo "   sudo systemctl start joda-backend-tunnel.service"
    fi
fi

echo ""

# Start backend in background
echo "🔧 Starting backend server..."
cd backend
env "${PYTHON_ENV[@]}" "$PYTHON_CMD" server.py --host "$JODA_BACKEND_HOST" > ../logs/backend.log 2>&1 &
BACKEND_PID=$!
cd ..

# Wait for backend to start
echo "⏳ Waiting for backend to initialize..."
sleep 3

# Check if backend is running
if ! ps -p $BACKEND_PID > /dev/null; then
    echo "❌ Backend failed to start. Check logs/backend.log for details."
    exit 1
fi

echo "✅ Backend started (PID: $BACKEND_PID)"

# Start frontend (VPS mode - no Electron)
echo "🎨 Starting frontend..."
npm run dev:vps > logs/frontend-dev.log 2>&1 &
FRONTEND_PID=$!

# Wait a bit for frontend to start, then detect common failure modes.
sleep 3

DEV_FAILED=0
if ! ps -p $FRONTEND_PID > /dev/null; then
    DEV_FAILED=1
elif grep -q "listen EPERM" logs/frontend-dev.log 2>/dev/null; then
    DEV_FAILED=1
fi

if [ "$DEV_FAILED" -eq 1 ]; then
    echo "⚠️  Frontend dev server failed to start; falling back to static build."
    kill $FRONTEND_PID 2>/dev/null || true

    npm run build > logs/frontend-build.log 2>&1 || true
    python3 -m http.server 5173 --bind "$JODA_FRONTEND_HOST" --directory dist > logs/frontend-static.log 2>&1 &
    FRONTEND_PID=$!

    sleep 1
    if ! ps -p $FRONTEND_PID > /dev/null; then
        echo "❌ Static frontend server failed to start. Stopping backend..."
        kill $BACKEND_PID 2>/dev/null
        exit 1
    fi

    echo "✅ Frontend static server started (PID: $FRONTEND_PID)"
else
    echo "✅ Frontend dev server started (PID: $FRONTEND_PID)"
fi
echo ""
echo "=================================================="
echo "  ✨ JODA is now running!"
echo "=================================================="
echo ""

# Check for Cloudflare tunnel URLs
if [ -r /var/log/cloudflared-joda.log ]; then
    FRONTEND_TUNNEL_URL=$(tail -100 /var/log/cloudflared-joda.log 2>/dev/null | grep -oP 'https://[a-z0-9-]+\.trycloudflare\.com' | tail -1 || true)
else
    FRONTEND_TUNNEL_URL=$(sudo tail -100 /var/log/cloudflared-joda.log 2>/dev/null | grep -oP 'https://[a-z0-9-]+\.trycloudflare\.com' | tail -1 || true)
fi

if [ -r /var/log/cloudflared-backend.log ]; then
    BACKEND_TUNNEL_URL=$(tail -100 /var/log/cloudflared-backend.log 2>/dev/null | grep -oP 'https://[a-z0-9-]+\.trycloudflare\.com' | tail -1 || true)
else
    BACKEND_TUNNEL_URL=$(sudo tail -100 /var/log/cloudflared-backend.log 2>/dev/null | grep -oP 'https://[a-z0-9-]+\.trycloudflare\.com' | tail -1 || true)
fi

if [ -n "$FRONTEND_TUNNEL_URL" ]; then
    echo "🌐 Access JODA via Cloudflare Tunnel:"
    echo "   $FRONTEND_TUNNEL_URL"
    echo ""
    if [ -n "$BACKEND_TUNNEL_URL" ]; then
        echo "🔗 Backend WebSocket tunnel:"
        echo "   $BACKEND_TUNNEL_URL"
        echo ""
    fi
else
    JODA_PUBLIC_HOST="${JODA_PUBLIC_HOST:-localhost}"
    echo "🌐 Open your browser to: http://$JODA_PUBLIC_HOST:5173"
    echo ""
fi

echo "📊 Backend logs: logs/backend.log"
echo "📋 Frontend logs: logs/frontend-static.log (static) or terminal output (dev)"
echo ""
echo "To stop JODA:"
echo "  - Press Ctrl+C in this terminal, or"
echo "  - Run: kill $BACKEND_PID $FRONTEND_PID"
echo ""
echo "💡 Tip: Run 'joda-urls' anytime to see current tunnel URLs"
echo ""
echo "Agent Manager initialized and ready to deploy agents."
echo ""

# Save PIDs to file for easy cleanup
echo "$BACKEND_PID" > .joda.pid
echo "$FRONTEND_PID" >> .joda.pid

# Wait for user interrupt
trap "echo ''; echo '🛑 Stopping JODA...'; kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; rm -f .joda.pid; echo '✅ JODA stopped'; exit 0" INT TERM

# Keep script running
wait

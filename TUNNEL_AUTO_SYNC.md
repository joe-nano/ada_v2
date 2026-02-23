# Cloudflare Tunnel Auto-Sync

## Overview

Since Cloudflare quick tunnels generate new URLs every time they restart, the system has been configured to **automatically sync** the backend tunnel URL to the frontend configuration.

## How It Works

### Automatic Sync on Startup

When you run `./start-joda.sh`, the script now:

1. **Checks for Backend Tunnel**: Reads the current backend tunnel URL from `/var/log/cloudflared-backend.log`
2. **Updates .env File**: Automatically updates `VITE_SOCKET_URL` in `.env` with the current backend tunnel URL
3. **Starts Services**: Launches backend and frontend with the correct configuration
4. **Displays URLs**: Shows both frontend and backend tunnel URLs at startup

### Example Startup Output

```bash
🔗 Checking Cloudflare tunnel status...
✅ Backend tunnel detected: https://deposits-home-don-core.trycloudflare.com
✅ Updated .env with backend tunnel URL

🌐 Access JODA via Cloudflare Tunnel:
   https://evaluate-chamber-qualifying-movers.trycloudflare.com

🔗 Backend WebSocket tunnel:
   https://deposits-home-don-core.trycloudflare.com
```

## Manual Sync

If the tunnels restart independently (without restarting JODA), you can manually sync:

```bash
# Run the sync script
joda-sync

# Then restart JODA for changes to take effect
./stop-joda.sh && ./start-joda.sh
```

Or use the full path:
```bash
./sync-tunnel-urls.sh
```

## Viewing Current URLs

Get current tunnel URLs anytime:

```bash
joda-urls
```

Output:
```
==================================================
  🌐 J.O.D.A Cloudflare Tunnel URLs
==================================================

✅ Frontend (Access J.O.D.A here):
   https://evaluate-chamber-qualifying-movers.trycloudflare.com

✅ Backend (WebSocket connection):
   https://deposits-home-don-core.trycloudflare.com
```

## Tunnel Services

Two systemd services manage the tunnels:

### Frontend Tunnel
```bash
sudo systemctl status joda-tunnel.service
sudo systemctl restart joda-tunnel.service
```

### Backend Tunnel
```bash
sudo systemctl status joda-backend-tunnel.service
sudo systemctl restart joda-backend-tunnel.service
```

## What Changes When Tunnels Restart

When either tunnel service restarts:

### Frontend Tunnel Restart
- New frontend URL is generated
- Users need the new URL to access J.O.D.A
- No configuration changes needed

### Backend Tunnel Restart
- New backend URL is generated
- `.env` file needs updating with new `VITE_SOCKET_URL`
- **Solution**: Run `joda-sync` then restart JODA

## Quick Reference

| Command | Purpose |
|---------|---------|
| `./start-joda.sh` | Auto-syncs and starts JODA |
| `./stop-joda.sh` | Stops JODA services |
| `joda-urls` | Display current tunnel URLs |
| `joda-sync` | Manually sync .env with backend tunnel |
| `sudo systemctl restart joda-tunnel.service` | Restart frontend tunnel |
| `sudo systemctl restart joda-backend-tunnel.service` | Restart backend tunnel |

## Why Two Tunnels?

Both frontend and backend need HTTPS tunnels because:

1. **Mixed Content Security**: Browsers block HTTPS pages from connecting to HTTP WebSocket endpoints
2. **Single Source of Truth**: Frontend tunnel URL is what users access
3. **Backend WebSocket**: Backend tunnel enables secure WebSocket connections from HTTPS frontend

## Troubleshooting

### "Not connected to backend" error

1. Check if backend tunnel is running:
   ```bash
   sudo systemctl status joda-backend-tunnel.service
   ```

2. Verify .env has correct backend URL:
   ```bash
   cat .env | grep VITE_SOCKET_URL
   ```

3. Compare with actual backend tunnel URL:
   ```bash
   joda-urls
   ```

4. If they don't match, sync and restart:
   ```bash
   joda-sync
   ./stop-joda.sh && ./start-joda.sh
   ```

### Tunnel URL changed but can't access

1. Get new URLs:
   ```bash
   joda-urls
   ```

2. Use the new frontend URL to access J.O.D.A

3. If backend connection fails, sync and restart:
   ```bash
   joda-sync
   ./stop-joda.sh && ./start-joda.sh
   ```

## Permanent Tunnels (Optional)

For production use, consider creating **named Cloudflare tunnels** with permanent URLs:

1. Login to Cloudflare dashboard
2. Go to Zero Trust → Access → Tunnels
3. Create a named tunnel for frontend and backend
4. Update systemd service files with named tunnel configs
5. URLs will remain stable across restarts

Named tunnels require a Cloudflare account but provide:
- Permanent URLs
- Better uptime guarantees
- Advanced routing options
- Access controls

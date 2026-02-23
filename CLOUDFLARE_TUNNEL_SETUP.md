# Cloudflare Tunnel Setup for JODA

## ✅ Setup Complete!

JODA Frontend is now accessible via HTTPS through Cloudflare Tunnel.

### Current Access URL

Get the current tunnel URL by running:
```bash
./get-tunnel-url.sh
```

Or check the logs directly:
```bash
sudo tail -100 /var/log/cloudflared-joda.log | grep "https://.*trycloudflare.com"
```

### Service Management

The tunnel runs as a systemd service and starts automatically on boot.

**Check status:**
```bash
sudo systemctl status joda-tunnel.service
```

**View logs:**
```bash
sudo journalctl -u joda-tunnel.service -f
```

**Restart service:**
```bash
sudo systemctl restart joda-tunnel.service
```

**Stop service:**
```bash
sudo systemctl stop joda-tunnel.service
```

**Disable automatic startup:**
```bash
sudo systemctl disable joda-tunnel.service
```

### Important Notes

⚠️ **This is a Quick Tunnel**

The current setup uses Cloudflare's "Quick Tunnel" feature which:
- Provides a temporary URL that changes on service restart
- Is not recommended for production use
- Has no uptime guarantees
- Is subject to Cloudflare's terms of use

### Upgrading to a Named Tunnel (Recommended for Production)

For a permanent, production-ready tunnel with a custom domain:

1. **Create a Cloudflare account** at https://dash.cloudflare.com
2. **Add your domain** to Cloudflare
3. **Create a named tunnel** in the Zero Trust dashboard
4. **Update the service configuration:**

```bash
# Stop the quick tunnel
sudo systemctl stop joda-tunnel.service

# Login to Cloudflare (opens browser)
cloudflared tunnel login

# Create a named tunnel
cloudflared tunnel create joda

# Create config file
sudo mkdir -p /etc/cloudflared
sudo nano /etc/cloudflared/config.yml
```

**Config file example:**
```yaml
tunnel: <TUNNEL-ID>
credentials-file: /root/.cloudflared/<TUNNEL-ID>.json

ingress:
  - hostname: joda.yourdomain.com
    service: http://localhost:5174
  - service: http_status:404
```

5. **Add DNS record:**
```bash
cloudflared tunnel route dns joda joda.yourdomain.com
```

6. **Update systemd service:**
```bash
sudo nano /etc/systemd/system/joda-tunnel.service
```

Change `ExecStart` to:
```
ExecStart=/usr/local/bin/cloudflared tunnel --config /etc/cloudflared/config.yml run joda
```

7. **Restart service:**
```bash
sudo systemctl daemon-reload
sudo systemctl restart joda-tunnel.service
```

### Environment Variables

The Cloudflare API token is saved in:
- `/etc/environment` (system-wide)
- `~/.bashrc` (current user)

To access it:
```bash
echo $CLOUDFLARE_API_TOKEN
```

### Backend Access

The backend API is still accessible via:
- **Local:** http://localhost:8765
- **VPS IP:** http://72.62.165.102:8765

⚠️ The backend is NOT tunneled through Cloudflare. If you need API access through HTTPS, add it to the tunnel configuration.

### Troubleshooting

**Tunnel not starting:**
```bash
sudo systemctl status joda-tunnel.service
sudo journalctl -u joda-tunnel.service -n 50
```

**Get new URL after restart:**
```bash
./get-tunnel-url.sh
```

**Check if JODA frontend is running:**
```bash
curl http://localhost:5174
```

**Restart both JODA and tunnel:**
```bash
./stop-joda.sh
./start-joda.sh
sudo systemctl restart joda-tunnel.service
```

### Files Created

- `/usr/local/bin/cloudflared` - Cloudflare Tunnel binary
- `/etc/systemd/system/joda-tunnel.service` - Systemd service file
- `/var/log/cloudflared-joda.log` - Tunnel logs
- `./get-tunnel-url.sh` - Script to retrieve current tunnel URL

### Resources

- [Cloudflare Tunnel Documentation](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps)
- [Named Tunnel Setup Guide](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/tunnel-guide/)
- [Cloudflare Zero Trust Dashboard](https://one.dash.cloudflare.com/)

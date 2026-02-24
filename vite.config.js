import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

const isHttps = process.env.JODA_HTTPS === 'true'
const isTunnel = process.env.JODA_TUNNEL === 'true'
const needsProxy = isHttps || isTunnel

// https://vitejs.dev/config/
export default defineConfig(async () => {
    const plugins = [react()]

    // Dynamically load SSL plugin only when HTTPS is requested (dev:xr)
    if (isHttps) {
        const basicSsl = (await import('@vitejs/plugin-basic-ssl')).default
        plugins.push(basicSsl())
    }

    return {
        plugins,
        base: './', // Important for Electron
        resolve: {
            alias: {
                // ts-proto-descriptors needs @bufbuild/protobuf v2 with ./wire export,
                // but Vite resolves to the root v1 (from livekit). Point ./wire to the
                // correct nested copy.
                '@bufbuild/protobuf/wire': path.resolve(
                    __dirname,
                    'node_modules/ts-proto-descriptors/node_modules/@bufbuild/protobuf/dist/esm/wire/index.js'
                ),
                // Deduplicate three.js — nested copies in stats-gl, @iwer/sem, @iwer/devui
                'three': path.resolve(__dirname, 'node_modules/three'),
            },
            // Force Vite to always resolve these to the root copy.
            // Prevents react-reconciler (used by R3F) from pulling in a
            // separate pre-bundled React instance.
            dedupe: ['react', 'react-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'three', 'scheduler'],
        },
        optimizeDeps: {
            // Force all React-related packages into a single pre-bundle chunk
            include: ['react', 'react-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'three', 'scheduler', 'react-reconciler'],
        },
        server: {
            // Default to loopback for Cloudflare tunnels (which forward to localhost),
            // but allow overriding for LAN/VPS access.
            host: process.env.JODA_FRONTEND_HOST || '0.0.0.0',
            port: 5173,
            allowedHosts: [
                '.trycloudflare.com', // Allow all Cloudflare tunnel domains
                '.yodamaestro.uk', // Custom domain
                'localhost',
                '127.0.0.1',
                '72.62.165.102', // VPS IP
            ],
            // HMR: disabled behind Cloudflare tunnel to prevent infinite reload loops
            // (tunnel WebSocket upgrade is unreliable). For LAN HTTPS (dev:xr) or
            // plain HTTP, let Vite auto-detect.
            ...(isTunnel ? { hmr: false } : {}),
            // Proxy Socket.IO through Vite so HTTPS/tunnel modes don't hit mixed-content blocks.
            // Active in HTTPS (dev:xr) and tunnel (dev:tunnel) modes.
            ...(needsProxy
                ? {
                      proxy: {
                          '/socket.io': {
                              target: 'http://localhost:8765',
                              ws: true,
                              changeOrigin: true,
                          },
                      },
                  }
                : {}),
        },
    }
})

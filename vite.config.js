import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vitejs.dev/config/
export default defineConfig({
    plugins: [react()],
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
        },
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
        hmr: {
            // When accessed via Cloudflare tunnel, HMR WebSocket must go through the tunnel too
            clientPort: 443,
            protocol: 'wss',
        },
    }
})

/**
 * Example: Minimal Node.js client that connects to JODA,
 * sends a text message, and prints the response.
 *
 * Usage:
 *   npm install socket.io-client
 *   node remote-client.js
 */

import { io } from "socket.io-client";

const JODA_URL = process.env.JODA_URL || "http://localhost:8765";

const socket = io(JODA_URL, {
  transports: ["websocket"],
  reconnection: true,
});

// ── Connection lifecycle ───────────────────────────────────────────

socket.on("connect", () => {
  console.log(`Connected to JODA (${socket.id})`);

  // Send a message once connected
  socket.emit("user_input", { text: "Hello JODA, what can you do?" });
});

socket.on("disconnect", (reason) => {
  console.log("Disconnected:", reason);
});

// ── Response handlers ──────────────────────────────────────────────

socket.on("status", (data) => {
  console.log("[status]", data);
});

socket.on("transcription", (data) => {
  console.log("[transcription]", data);
});

socket.on("error", (data) => {
  console.error("[error]", data);
});

// ── Tool confirmation ──────────────────────────────────────────────

socket.on("tool_confirmation_request", (data) => {
  console.log(`[tool request] ${data.tool_name}`, data.tool_args);
  // Auto-approve all tools (be careful with this in production)
  socket.emit("confirm_tool", { id: data.id, confirmed: true });
});

// ── CAD events ─────────────────────────────────────────────────────

socket.on("cad_data", (data) => {
  console.log("[cad] Model received");
});

socket.on("cad_status", (data) => {
  console.log("[cad status]", data);
});

// ── Graceful shutdown ──────────────────────────────────────────────

process.on("SIGINT", () => {
  console.log("\nDisconnecting...");
  socket.disconnect();
  process.exit(0);
});

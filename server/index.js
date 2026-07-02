// ============================================================
// server/index.js — Express + WebSocket backend for
// Real Estate Agent Web App
//
// Multi-agent system modeled after baochunli/pi-collaborating-agents:
//   - Orchestrator Agent  (decomposes user intent into tasks)
//   - Firecrawl Scraper Agents  (parallel property scraping)
//   - Analysis Agent     (synthesizes scraped listings)
//   - Memory Agent       (stores conversation + search criteria)
// ============================================================

import express from "express";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { v4 as uuidv4 } from "uuid";
import OrchestratorAgent from "./agents/OrchestratorAgent.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = process.env.PORT || 3099;
const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

// ── Middleware ──────────────────────────────────────────────
app.use(express.json({ limit: "5mb" }));
app.use(express.static(join(__dirname, "..", "client")));

// Favicon (avoid 404)
app.get("/favicon.ico", (req, res) => {
  res.setHeader("Content-Type", "image/svg+xml");
  res.send(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="8" fill="#6c8cff"/><text x="32" y="44" font-size="32" text-anchor="middle" fill="white">🏠</text></svg>`);
});

// ── In-memory state ────────────────────────────────────────
const sessions = new Map();       // sessionId -> { orchestrator, ws, userId }
const userIdSessions = new Map(); // userId -> Set<sessionId>

// ── WebSocket handling ─────────────────────────────────────
wss.on("connection", (ws, req) => {
  let sessionId = uuidv4();
  let userId = null;

  const send = (type, payload) => {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type, payload, sessionId }));
    }
  };

  ws.on("close", () => {
    const session = sessions.get(sessionId);
    if (session) {
      session.orchestrator?.shutdown();
      sessions.delete(sessionId);
    }
    if (userId && userIdSessions.has(userId)) {
      userIdSessions.get(userId).delete(sessionId);
    }
  });

  ws.on("message", async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      send("error", { message: "Invalid JSON" });
      return;
    }

    const { type, payload } = msg;

    // ── Identify / resume session ──────────────────────────
    if (type === "identify") {
      userId = payload?.userId || uuidv4();
      sessionId = payload?.sessionId || sessionId;

      if (!userIdSessions.has(userId)) userIdSessions.set(userId, new Set());
      userIdSessions.get(userId).add(sessionId);

      // Reuse existing orchestrator or create a new one
      let orchestrator = sessions.get(sessionId)?.orchestrator;
      if (!orchestrator) {
        orchestrator = new OrchestratorAgent(sessionId, userId, (msgType, pl) => {
          send(msgType, pl);
        });
        sessions.set(sessionId, { orchestrator, ws, userId, startedAt: Date.now() });
      }

      const st0 = orchestrator.getState(); send("identified", { sessionId, userId, history: orchestrator.getConversationHistory(), criteria: st0.criteria });
      return;
    }

    // ── User message ───────────────────────────────────────
    if (type === "user_message") {
      const session = sessions.get(sessionId);
      if (!session) {
        send("error", { message: "Session not found. Reconnect." });
        return;
      }

      const text = (payload?.text || "").trim();
      if (!text) return;

      // Echo user message back
      send("user_message", { text, timestamp: Date.now() });

      // Process through orchestrator (which spawns sub-agents)
      await session.orchestrator.processUserMessage(text, send);
      return;
    }

    // ── Get session state ──────────────────────────────────
    if (type === "get_state") {
      const session = sessions.get(sessionId);
      if (session) {
        send("state", session.orchestrator.getState());
      }
      return;
    }
  });
});

server.listen(PORT, () => {
  console.log(`\n  ?? Real Estate Agent running at http://localhost:${PORT}\n`);
});





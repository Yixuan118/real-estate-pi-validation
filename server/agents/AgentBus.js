// ============================================================
// server/agents/AgentBus.js
//
// Core messaging bus — modeled directly after
// pi-collaborating-agents agent_message() system:
//
//   - agent_message({ action: "send", to, message, urgent? })
//   - agent_message({ action: "broadcast", message, urgent? })
//   - agent_message({ action: "feed", limit? })
//   - agent_message({ action: "thread", to, limit? })
//   - agent_message({ action: "list" })
//   - agent_message({ action: "status" })
//   - agent_message({ action: "reserve", paths, reason? })
//   - agent_message({ action: "release", paths? })
// ============================================================

import { v4 as uuidv4 } from "uuid";

class AgentBus {
  constructor() {
    /** @type {Map<string, { name: string, role: string, status: string, reservations: Set<string>, joinedAt: number }>} */
    this.agents = new Map();
    /** @type {Array<{ id: string, from: string, to: string|null, message: string, urgent: boolean, timestamp: number }>} */
    this.messageLog = [];
    this.maxLogEntries = 2000;
  }

  // ── Registration ──────────────────────────────────────────
  register(agentId, name, role = "worker") {
    this.agents.set(agentId, {
      name,
      role,
      status: "active",
      reservations: new Set(),
      joinedAt: Date.now(),
    });
  }

  unregister(agentId) {
    this.agents.delete(agentId);
  }

  updateStatus(agentId, status) {
    const a = this.agents.get(agentId);
    if (a) a.status = status;
  }

  // ── agent_message actions ────────────────────────────────

  /** @returns {{ ok: boolean, data?: any, error?: string }} */
  handleMessage(action, callerId = null) {
    switch (action.action) {
      case "status": {
        const agent = callerId ? this.agents.get(callerId) : null;
        return {
          ok: true,
          data: {
            agentId: callerId,
            name: agent?.name || "unknown",
            role: agent?.role || "unknown",
            status: agent?.status || "unknown",
            peerCount: this.agents.size,
            reservations: agent ? [...agent.reservations] : [],
          },
        };
      }

      case "list": {
        const list = [];
        for (const [id, a] of this.agents) {
          list.push({ agentId: id, name: a.name, role: a.role, status: a.status });
        }
        return { ok: true, data: list };
      }

      case "send": {
        const { to, message, urgent = false, replyTo } = action;
        if (!message) return { ok: false, error: "message is required" };
        if (!to) return { ok: false, error: "recipient (to) is required" };
        if (to === callerId) return { ok: false, error: "cannot send to self" };

        const recipient = [...this.agents.entries()].find(([, a]) => a.name === to || a.name === callerId);
        if (!recipient) return { ok: false, error: `recipient "${to}" is not active` };

        const entry = {
          id: uuidv4(),
          from: callerId,
          to: recipient[0],
          message,
          urgent,
          replyTo: replyTo || null,
          timestamp: Date.now(),
        };
        this.messageLog.push(entry);
        if (this.messageLog.length > this.maxLogEntries) {
          this.messageLog.splice(0, this.messageLog.length - this.maxLogEntries);
        }

        return { ok: true, data: { messageId: entry.id, delivered: true } };
      }

      case "broadcast": {
        const { message, urgent = false } = action;
        if (!message) return { ok: false, error: "message is required" };
        if (this.agents.size === 0) return { ok: false, error: "no active recipients" };

        const recipients = [...this.agents.keys()].filter((id) => id !== callerId);
        const entry = {
          id: uuidv4(),
          from: callerId,
          to: null, // broadcast
          message,
          urgent,
          timestamp: Date.now(),
        };
        this.messageLog.push(entry);
        if (this.messageLog.length > this.maxLogEntries) {
          this.messageLog.splice(0, this.messageLog.length - this.maxLogEntries);
        }

        return { ok: true, data: { messageId: entry.id, recipients: recipients.length } };
      }

      case "feed": {
        const limit = Math.min(action.limit || 20, 400);
        const entries = this.messageLog.slice(-limit);
        return { ok: true, data: entries };
      }

      case "thread": {
        const { to } = action;
        if (!to) return { ok: false, error: "recipient (to) is required" };
        const limit = Math.min(action.limit || 50, 400);
        const entries = this.messageLog.filter(
          (m) =>
            (m.from === callerId && m.to === to) ||
            (m.from === to && m.to === callerId) ||
            (m.to === null && (m.from === callerId || m.from === to))
        );
        return { ok: true, data: entries.slice(-limit) };
      }

      case "reserve": {
        const { paths = [], reason = "" } = action;
        if (!paths.length) return { ok: false, error: "paths[] is required" };
        const agent = this.agents.get(callerId);
        if (!agent) return { ok: false, error: "unknown caller" };

        // Check conflicts
        const conflicts = [];
        for (const [id, a] of this.agents) {
          if (id === callerId) continue;
          for (const path of paths) {
            for (const rPath of a.reservations) {
              if (path.startsWith(rPath) || rPath.startsWith(path)) {
                conflicts.push({ agentId: id, name: a.name, path: rPath, requested: path });
              }
            }
          }
        }

        for (const path of paths) {
          agent.reservations.add(path);
        }

        return { ok: true, data: { paths, reason, conflicts: conflicts.length > 0 ? conflicts : undefined } };
      }

      case "release": {
        const { paths } = action;
        const agent = this.agents.get(callerId);
        if (!agent) return { ok: false, error: "unknown caller" };
        if (paths && paths.length) {
          for (const p of paths) agent.reservations.delete(p);
          return { ok: true, data: { released: paths } };
        }
        agent.reservations.clear();
        return { ok: true, data: { released: "all" } };
      }

      default:
        return { ok: false, error: `unknown action: ${action.action}` };
    }
  }

  /** Get all messages for a specific recipient (for push delivery) */
  getMessagesFor(agentId) {
    return this.messageLog.filter(
      (m) => m.to === null || m.to === agentId
    );
  }
}

// Singleton
const globalBus = new AgentBus();
export default globalBus;

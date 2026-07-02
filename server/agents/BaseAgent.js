// ============================================================
// server/agents/BaseAgent.js
//
// Base class for all agents in the system.
// Mirrors pi-collaborating-agents subagent protocol:
//   - agent_message() for coordination
//   - reserve/release for file-level coordination
//   - Structured final report format
// ============================================================

import { v4 as uuidv4 } from "uuid";
import bus from "./AgentBus.js";

class BaseAgent {
  /**
   * @param {string} name    - Human-readable callsign (e.g. "SwiftFalcon")
   * @param {string} role    - "orchestrator", "scraper", "analyzer", "memorizer"
   * @param {object} options
   * @param {function} [options.onMessage] - Callback for incoming urgent messages
   */
  constructor(name, role, { onMessage } = {}) {
    this.id = uuidv4();
    this.name = name;
    this.role = role;
    this.onMessage = onMessage || null;
    this.startedAt = Date.now();

    // Self-register on the bus — mirrors pi agent auto-registration
    bus.register(this.id, this.name, this.role);

    // On startup, call status + list (per pi-collaborating-agents protocol)
    this.agentMessage({ action: "status" });
    this.agentMessage({ action: "list" });
  }

  /**
   * Core communication primitive — mirrors pi agent_message().
   * @param {object} action
   */
  agentMessage(action) {
    return bus.handleMessage(action, this.id);
  }

  /**
   * Send a direct message to a peer.
   * Mirrors: agent_message({ action: "send", to, message, urgent? })
   */
  sendTo(name, message, urgent = false) {
    return this.agentMessage({ action: "send", to: name, message, urgent });
  }

  /**
   * Broadcast to all peers.
   * Mirrors: agent_message({ action: "broadcast", message, urgent? })
   */
  broadcast(message, urgent = false) {
    return this.agentMessage({ action: "broadcast", message, urgent });
  }

  /**
   * Reserve paths for write coordination.
   * Mirrors: agent_message({ action: "reserve", paths, reason? })
   */
  reserve(paths, reason = "") {
    return this.agentMessage({ action: "reserve", paths, reason });
  }

  /**
   * Release reserved paths.
   * Mirrors: agent_message({ action: "release", paths? })
   */
  release(paths) {
    return this.agentMessage({ action: "release", paths });
  }

  /**
   * Get recent feed.
   * Mirrors: agent_message({ action: "feed", limit? })
   */
  getFeed(limit = 20) {
    return this.agentMessage({ action: "feed", limit });
  }

  /**
   * Get thread with a peer.
   * Mirrors: agent_message({ action: "thread", to, limit? })
   */
  getThread(to, limit = 50) {
    return this.agentMessage({ action: "thread", to, limit });
  }

  /**
   * Override in subclasses.
   * Called when this agent receives an urgent message.
   */
  async handleUrgentMessage(from, message) {
    // Default: log it
  }

  /**
   * Override in subclasses.
   * Called when this agent needs to process a task.
   */
  async run(task) {
    throw new Error("run() must be implemented by subclass");
  }

  /** Unregister on shutdown */
  shutdown() {
    bus.unregister(this.id);
  }
}

export default BaseAgent;

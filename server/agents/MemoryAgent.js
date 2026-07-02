// ============================================================
// server/agents/MemoryAgent.js
//
// Memory Agent — maintains persistent conversation history
// and evolving search criteria per user/session.
//
// Mirrors pi-collaborating-agents data persistence pattern
// using agent_message() for coordination while keeping
// its own file-based or in-memory store.
//
// When user says "add more criteria" or changes preferences,
// the orchestrator sends updates here, and this agent
// merges the new intent with existing state.
// ============================================================

import BaseAgent from "./BaseAgent.js";

class MemoryAgent extends BaseAgent {
  constructor(name) {
    super(name, "memorizer");
    this.conversations = new Map();
  }

  getConversation(sessionId) {
    if (!this.conversations.has(sessionId)) {
      this.conversations.set(sessionId, {
        sessionId,
        userId: null,
        messages: [],
        criteria: this.defaultCriteria(),
        propertyHistory: [],
        analysisHistory: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    }
    return this.conversations.get(sessionId);
  }

  defaultCriteria() {
    return {
      minPrice: null, maxPrice: null, beds: null, baths: null,
      propertyType: null, minSqft: null, maxSqft: null, region: "",
      keywords: [], sources: ["zillow", "realtor"],
      watchMode: false, watchInterval: null, exactBeds: false, requiredAmenities: [],
    };
  }

  async run(task) {
    const { action, sessionId, userId } = task;
    if (!sessionId) return "Error: sessionId is required";
    const conv = this.getConversation(sessionId);
    if (userId) conv.userId = userId;

    switch (action) {
      case "store_message": {
        const { role, text } = task;
        if (!role || !text) return "Error: role and text are required";
        conv.messages.push({ role, text, timestamp: Date.now() });
        conv.updatedAt = Date.now();
        if (role === "user") this.extractCriteria(conv, text);
        this.broadcast(`Memory updated: ${conv.messages.length} total messages`);
        return `Stored ${role} message`;
      }
      case "update_criteria": {
        if (task.criteria) Object.assign(conv.criteria, task.criteria);
        conv.updatedAt = Date.now();
        return "Criteria updated";
      }
      case "get_history":
        return { messages: conv.messages.slice(-(task.limit || conv.messages.length)), totalMessages: conv.messages.length, criteria: conv.criteria };
      case "get_criteria":
        return conv.criteria;
      case "remember_properties": {
        if (task.properties?.length) {
          for (const p of task.properties) {
            if (!conv.propertyHistory.some(h => h.address === p.address && h.price === p.price)) {
              conv.propertyHistory.push({ ...p, firstSeen: Date.now() });
            }
          }
        }
        return `Remembered ${task.properties?.length || 0} properties`;
      }
      case "remember_analysis":
        if (task.analysis) conv.analysisHistory.push({ ...task.analysis, timestamp: Date.now() });
        return "Analysis remembered";
      case "get_property_history":
        return conv.propertyHistory;
      case "get_watch_status":
        return { watchMode: conv.criteria.watchMode, watchInterval: conv.criteria.watchInterval, criteria: conv.criteria, propertyCount: conv.propertyHistory.length };
      case "set_watch_mode":
        conv.criteria.watchMode = task.enabled ?? true;
        if (task.interval != null) conv.criteria.watchInterval = task.interval;
        conv.updatedAt = Date.now();
        return `Watch mode ${conv.criteria.watchMode ? "enabled" : "disabled"}`;
      default:
        return `Unknown action: ${action}`;
    }
  }


  /**
   * Helper: get text before a match index to check for qualifiers.
   */
  extractBeforeMatch(text, index) {
    const start = Math.max(0, index - 30);
    return text.slice(start, index);
  }
  extractCriteria(conv, text) {
    const c = conv.criteria;
    const lower = text.toLowerCase();

    // ── Budget: handle "$500k", "$500,000", "under $500k", "500k" ──
    const priceMatches = [];
    const dollarMatches = text.match(/\$[\d]+(?:\.\d{2})?(?:k|K|m|M)?/g) || [];
    const kMatches = text.match(/(\d+)\s*k\b(?:\s*dollar)?/gi) || [];
    for (const m of dollarMatches) {
      let p = m.replace(/[$,]/g, "").replace(/k/i, "");
      if (/k/i.test(m)) p += "000";
      priceMatches.push(parseInt(p));
    }
    for (const m of kMatches) {
      const p = parseInt(m) * 1000;
      if (!priceMatches.includes(p)) priceMatches.push(p);
    }

    if (priceMatches.length > 0) {
      const isMax = /under|below|less than|max|up to|不超过|以下|以内/.test(lower);
      const isMin = /over|above|more than|min|at least|最低|以上|至少/.test(lower);
      if (isMax) c.maxPrice = Math.max(...priceMatches);
      else if (isMin) c.minPrice = Math.min(...priceMatches);
      else if (priceMatches.length >= 2) {
        c.minPrice = Math.min(...priceMatches);
        c.maxPrice = Math.max(...priceMatches);
      } else c.maxPrice = priceMatches[0];
    }

    // ── Bedrooms ──
    // "2-bedroom", "3bd", "3 br" → exact match
    // "2+ bedroom", "at least 2", "minimum 2" → minimum match
    const bedMatch = text.match(/(\d+)[\s-]*(?:bed(?:room)?s?|br|bd)\b/i);
    if (bedMatch) {
      const exactNum = parseInt(bedMatch[1]);
      // Real estate search: "3-bedroom" means minimum 3 bedrooms, not exact
      // Only use exact match when user explicitly says "exactly N", "only N", or "strictly N"
      const isExact = /exactly\s+\d+|only\s+\d+\s+bed|strictly\s+\d+/.test(text.toLowerCase());
      c.beds = exactNum;
      c.exactBeds = isExact;
      this.sendTo("orchestrator", `Set ${isExact ? "exactly" : "minimum"} ${c.beds} bedroom${c.beds > 1 ? "s" : ""}`);
    }

    // ── Bathrooms ──
    const bathMatch = text.match(/(\d+\.?\d*)[\s-]*(?:bath(?:room)?s?|ba)\b/i);
    if (bathMatch) {
      c.baths = parseFloat(bathMatch[1]);
      this.sendTo("orchestrator", `Set minimum ${c.baths} bathroom${c.baths > 1 ? "s" : ""}`);
    }

    // ── Property type ──
    if (/\b(house|single.?family|sfh)\b/i.test(lower)) c.propertyType = "Single Family";
    else if (/\bcondo|apartment\b/i.test(lower)) c.propertyType = "Condo";
    else if (/\btownhouse|town.?house\b/i.test(lower)) c.propertyType = "Townhouse";
    else if (/\bmulti.?family|duplex|triplex\b/i.test(lower)) c.propertyType = "Multi-Family";
    if (c.propertyType) this.sendTo("orchestrator", `Set property type: ${c.propertyType}`);

    // ── Sqft ──
    const sqftMatch = text.match(/([\d,]+)\s*(?:sq\s*ft|square\s*feet|sqft)/i);
    if (sqftMatch) {
      c.minSqft = parseInt(sqftMatch[1].replace(/,/g, ""));
      this.sendTo("orchestrator", `Set minimum ${c.minSqft.toLocaleString()} sqft`);
    }

    // ── Region ──
    // Stop at prepositions, conjunctions, and punctuation so "in Seattle with a pool" → "Seattle"
    for (const indicator of ["in ", "near ", "around ", "area of ", "located in "]) {
      const idx = lower.indexOf(indicator);
      if (idx >= 0) {
        const after = text.slice(idx + indicator.length).trim();
        const endIdx = after.search(/[,.;!]| with | and | or | near | close to | for | that | has | have /i);
        const region = (endIdx >= 0 ? after.slice(0, endIdx) : after).trim();
        if (region.length > 0 && region.length < 100) {
          c.region = region;
          this.sendTo("orchestrator", `Set region: ${region}`);
          break;
        }
      }
    }

    // ── Watch mode ──
    if (/\b(watch|monitor|track|keep an eye|notify|alert|subscribe)\b/i.test(lower)) {
      c.watchMode = true;
      const intervalMatch = text.match(/every\s+(\d+)\s+(hour|hours?|min(?:ute)?s?|day|days?|h|m)\b/i);
      if (intervalMatch) {
        const val = parseInt(intervalMatch[1]);
        const unit = (intervalMatch[2] || "").toLowerCase();
        c.watchInterval = /^h/.test(unit) ? val * 60 : /^d/.test(unit) ? val * 60 * 24 : val;
      } else c.watchInterval = 60;
      this.sendTo("orchestrator", `Watch mode enabled (every ${c.watchInterval} min)`);
    }    
    // ── Amenities — multi-condition: each detected amenity stacks ──
    // Like Meituan: "with a pool and garage" → both required
    c.requiredAmenities = c.requiredAmenities || [];

    if (/\b(?:with a |with |has |have |that has )?pool\b/i.test(lower) || /\bheated pool\b/i.test(lower) || /\blap pool\b/i.test(lower) || /\bswimming pool\b/i.test(lower)) {
      if (!c.requiredAmenities.includes("pool")) {
        c.requiredAmenities.push("pool");
        this.sendTo("orchestrator", `Added amenity: pool`);
      }
    }
    if (/\bgarage\b/i.test(lower) || /\bparking\b/i.test(lower) || /\bcarpark\b/i.test(lower)) {
      if (!c.requiredAmenities.includes("garage")) {
        c.requiredAmenities.push("garage");
        this.sendTo("orchestrator", `Added amenity: garage`);
      }
    }
    if (/\byard\b/i.test(lower) || /\bgarden\b/i.test(lower) || /\bbackyard\b/i.test(lower) || /\blawn\b/i.test(lower) || /\blandscaped\b/i.test(lower)) {
      if (!c.requiredAmenities.includes("yard")) {
        c.requiredAmenities.push("yard");
        this.sendTo("orchestrator", `Added amenity: yard`);
      }
    }
    if (/\bgym\b/i.test(lower) || /\bfitness\b/i.test(lower) || /\bworkout\b/i.test(lower) || /\bexercise room\b/i.test(lower)) {
      if (!c.requiredAmenities.includes("gym")) {
        c.requiredAmenities.push("gym");
        this.sendTo("orchestrator", `Added amenity: gym`);
      }
    }
    if (/\b(?:with a )?rooftop\b/i.test(lower) || /\broof deck\b/i.test(lower) || /\bskyline view\b/i.test(lower)) {
      if (!c.requiredAmenities.includes("rooftop")) {
        c.requiredAmenities.push("rooftop");
        this.sendTo("orchestrator", `Added amenity: rooftop`);
      }
    }
  }
}

export default MemoryAgent;




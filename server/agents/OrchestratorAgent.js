// ============================================================
// server/agents/OrchestratorAgent.js
//
// Master orchestrator ¡ª modeled after pi-collaborating-agents
// coordinator workflow:
//
//   1. Receive user intent
//   2. Decompose into sub-tasks
//   3. Spawn subagents in parallel:
//        subagent({ tasks: [...], type: "scraper" })
//        subagent({ tasks: [...], type: "analyzer" })
//   4. Collect results via agent_message thread/sessions
//   5. Memory agent persists conversation + criteria
//   6. Synthesize and return to user
//
// Parallel sub-agent execution follows pi protocol strictly.
// ============================================================

import BaseAgent from "./BaseAgent.js";
import FirecrawlScraperAgent from "./FirecrawlScraperAgent.js";
import AnalyzerAgent from "./AnalyzerAgent.js";
import MemoryAgent from "./MemoryAgent.js";

class OrchestratorAgent extends BaseAgent {
  /**
   * @param {string} sessionId
   * @param {string} userId
   * @param {function} sendToClient - (type, payload) => void
   */
  constructor(sessionId, userId, sendToClient) {
    super("Orchestrator", "orchestrator");

    this.sessionId = sessionId;
    this.userId = userId;
    this.sendToClient = sendToClient;

    // Spawn sub-agents (per pi-collaborating-agents pattern)
    this.scraper = new FirecrawlScraperAgent("PropertyScraper");
    this.analyzer = new AnalyzerAgent("MarketAnalyst");
    this.memorizer = new MemoryAgent("MemoryKeeper");

    // Conversation state
    this.currentCriteria = this.memorizer.defaultCriteria();
  }

  /**
   * Main entry point: process a user message by decomposing it
   * and coordinating parallel sub-agents.
   *
   * Mirrors pi orchestrator workflow:
   *   1. agent_message({ action: "status" })
   *   2. Decompose task
   *   3. subagent({ tasks: [...] }) ¡ª parallel scrape
   *   4. Collect ¡ú subagent({ task: "analyze" })
   *   5. Memory store
   *   6. Synthesize ¡ú user
   */
  async processUserMessage(text, sendFn) {
    const send = sendFn || this.sendToClient;

    // ©¤©¤ Step 0: Broadcast orchestrator status (pi protocol) ©¤©¤
    this.broadcast(`Orchestrator processing user message`);

    // ©¤©¤ Step 1 (MemoryAgent ¡ª serial dependency): Store + update criteria ©¤©¤
    // pi: MemoryAgent runs first because criteria extraction blocks everything
    send("agent_status", { agent: "MemoryKeeper", message: "Storing conversation..." });
    await this.memorizer.run({
      action: "store_message",
      sessionId: this.sessionId,
      role: "user",
      text,
    });

    send("agent_status", { agent: "MemoryKeeper", message: "Extracting search criteria..." });
    const criteriaUpdate = await this.memorizer.run({
      action: "get_criteria",
      sessionId: this.sessionId,
    });
    this.currentCriteria = criteriaUpdate;
    send("criteria_update", this.currentCriteria);

    // ©¤©¤ Step 2 (TRUE PARALLEL ¡ª pi subagent pattern): ©¤©¤
    // PropertyScraper subagent: scrape each source in parallel
    // MarketAnalyst subagent: analyze concurrently (reads from AgentBus)
    //
    // pi equivalent:
    //   subagent({ tasks: [{ task: "scrape zillow" }, { task: "scrape realtor" }], type: "scraper" })
    //   subagent({ task: "analyze market", type: "analyzer" })
    //   ¡ú await Promise.all([...])  // wait for all subagents
    //   ¡ú collect final reports from AgentBus

    send("agent_status", {
      agent: "PropertyScraper",
      message: `Scraping properties in ${this.currentCriteria.region || "your area"}...`,
    });

    // ©¤©¤ Parallel scrape: each source as its own sub-task ©¤©¤
    const scraperTask = {
      criteria: this.currentCriteria,
      sources: this.currentCriteria.sources || ["zillow", "realtor"],
      region: this.currentCriteria.region || "",
    };

    // Pi parallel pattern: run PropertyScraper and pre-analysis simultaneously
    // Since MarketAnalyst needs extracted listings, we chunk it:
    //   Phase A: parallel per-source scraping
    //   Phase B: parallel analysis + memory storage
    const scrapeSources = this.currentCriteria.sources || ["zillow", "realtor"];

    // Pi: subagent({ tasks: scrapeSources.map(s => ({ task: s, type: "scraper" })), type: "scraper" })
    // Each source scraped in parallel ¡ª true scout parallelism
    this.broadcast(`Spawning ${scrapeSources.length} scraper subagents in parallel`);

    const scrapePromises = scrapeSources.map((source, idx) => {
      const subTask = {
        ...scraperTask,
        sources: [source],
        agentName: `Scraper-${source}`,
      };
      // Pi: subagent({ task, type: "scraper" }) ¡ª each source is an independent subagent
      this.sendTo("PropertyScraper", `Scraping ${source} for ${this.currentCriteria.region || "all areas"}`);
      return this.scraper.run(subTask);
    });

    // ©¤©¤ Execute all scraper subagents in TRUE PARALLEL (pi parallel subagent pattern) ©¤©¤
    const scrapeReports = await Promise.all(scrapePromises);

    // Pi: collect results from all completed subagents
    this.broadcast(`All ${scrapeReports.length} scraper subagents completed`);

    // ©¤©¤ Merge reports ©¤©¤
    const mergedReport = this.mergeScrapeReports(scrapeReports);
    const listings = this.extractListingsFromReport(mergedReport);

    // ©¤©¤ Phase B: parallel analysis + memory storage ©¤©¤
    // Pi: subagent({ task: "analyze listings", type: "analyzer" }) + run memory in parallel
    send("agent_status", {
      agent: "MarketAnalyst",
      message: `Analyzing ${listings.length} listings...`,
    });

    // Pi: subagent({ task: analysis, type: "analyzer" })
    // Runs in parallel with memory storage (both independent after scrape completes)
    this.sendTo("MarketAnalyst", `Starting analysis of ${listings.length} listings`);
    const analysisPromise = this.analyzer.run({
      listings,
      criteria: this.currentCriteria,
      history: [],
    });

    // Memory storage runs in parallel with analysis (pi parallel pattern)
    const memoryPromise = Promise.all([
      this.memorizer.run({
        action: "remember_properties",
        sessionId: this.sessionId,
        properties: listings,
      }),
      this.memorizer.run({
        action: "store_message",
        sessionId: this.sessionId,
        role: "assistant",
        text: mergedReport,
      }),
    ]);

    // ©¤©¤ Wait for parallel analysis + memory ©¤©¤
    const [analysisReport] = await Promise.all([analysisPromise, memoryPromise]);

    // Pi: agent_message for result broadcast
    this.broadcast(`Analysis complete: ${analysisReport.substring(0, 100)}...`);
    this.sendTo("MemoryKeeper", `Storing analysis with ${listings.length} listings`);
    await this.memorizer.run({
      action: "remember_analysis",
      sessionId: this.sessionId,
      analysis: { criteria: this.currentCriteria, report: analysisReport },
    });

    // ©¤©¤ Synthesize final output ©¤©¤
    send("agent_status", {
      agent: "Orchestrator",
      message: "Synthesizing results from all agents...",
    });

    const synthesis = this.synthesize(mergedReport, analysisReport, listings);
    send("assistant_message", {
      text: synthesis,
      html: this.formatAsHtml(mergedReport, analysisReport, listings),
      listings,
      timestamp: Date.now(),
    });

    // ©¤©¤ Watch mode ©¤©¤
    if (this.currentCriteria.watchMode) {
      this.scheduleWatch(send);
    }
  }

  /**
   * Merge multiple scrape reports into one.
   */
  mergeScrapeReports(reports) {
    const allListings = [];
    const seenAddresses = new Set();

    for (const report of reports) {
      const lines = report.split("\n");
      let currentAddr = null;
      let detailLines = [];

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.startsWith("- **")) {
          // Save previous listing if unique
          if (currentAddr && !seenAddresses.has(currentAddr)) {
            seenAddresses.add(currentAddr);
          }
          currentAddr = line.match(/\*\*(.+?)\*\*/)?.[1];
          detailLines = [line];
          if (currentAddr && !seenAddresses.has(currentAddr)) {
            seenAddresses.add(currentAddr);
            allListings.push(line);
            // Grab next two detail lines
            if (i + 1 < lines.length) allListings.push(lines[i + 1]);
            if (i + 2 < lines.length) allListings.push(lines[i + 2]);
          }
        }
      }
    }

    // Build merged report
    const header = "## Summary\nMerged results from " + reports.length + " sources.\nTotal unique listings: " + allListings.filter(l => l.startsWith("- **")).length + "\n\n## Listings Found\n";

    return header + allListings.join("\n") + "\n\n## Validation\n- Sources: " + reports.length + "\n- Unique listings: " + allListings.filter(l => l.startsWith("- **")).length + "\n";
  }
getConversationHistory() {
    const conv = this.memorizer.conversations.get(this.sessionId);
    return conv?.messages || [];
  }

  /**
   * Get current state.
   */
  extractListingsFromReport(report) {
    const listings = [];
    const listingRegex = /-\s+\*\*(.+?)\*\*(?:\s*,\s*(.+?))?\s*¡ª\s*\$([\d,]+)/g;
    let match;
    const lines = report.split("\n");
    while ((match = listingRegex.exec(report)) !== null) {
      const address = match[1].trim();
      const city = match[2]?.trim() || "";
      const price = parseInt(match[3].replace(/,/g, ""));
      const idx = lines.findIndex((l) => l.includes(match[1].trim()));
      let beds = null, baths = null, sqft = null, propertyType = null, neighborhood = null, amenities = [];
      if (idx >= 0 && idx + 1 < lines.length) {
        const detailLine = lines[idx + 1];
        const bedMatch = detailLine.match(/(\d+)\s*bed/);
        const bathMatch = detailLine.match(/(\d+)\s*bath/);
        const sqftMatch = detailLine.match(/([\d,]+)\s*sqft/);
        const typeMatch = detailLine.match(/¡ª\s*(.+?)(?:\s*¡¤|\s*$)/);
        if (bedMatch) beds = parseInt(bedMatch[1]);
        if (bathMatch) baths = parseInt(bathMatch[1]);
        if (sqftMatch) sqft = parseInt(sqftMatch[1].replace(/,/g, ""));
        if (typeMatch) propertyType = typeMatch[1].trim();
        const hoodMatch = detailLine.match(/(.+?)\s*¡¤/);
        if (hoodMatch) neighborhood = hoodMatch[1].trim();
      }
      listings.push({ address, city, price, beds, baths, sqft, propertyType, neighborhood, amenities });
    }
    return listings;
  }

  synthesize(scrapeReport, analysisReport, listings) {
    const criteria = this.currentCriteria;
    let summary = "";
    if (listings.length > 0) {
      summary += `Found **${listings.length} matching properties** in **${criteria.region || "your area"}**.\n\n`;
      summary += "### Top Picks\n";
      for (const l of listings.slice(0, 10)) {
        const iconsMap = { pool: "??", garage: "??", yard: "??", gym: "???", parking: "???", doorman: "??", rooftop: "???" };
        const amenityIcons = (l.amenities || []).map(a => iconsMap[a] || "?").join(" ");
        summary += `- **${l.address}**${l.city ? `, ${l.city}` : ""} ¡ª $${l.price.toLocaleString()}`;
        if (l.beds && l.baths) {
          summary += ` (${l.beds}bd/${l.baths}ba, ${l.sqft?.toLocaleString() || "?"} sqft)`;
        }
        summary += "\n";
      }
      summary += "\n";
    } else {
      summary += "No exact matches under your current criteria.\n\n";
      summary += "**Suggestions to broaden your search:**\n";
      if (criteria.maxPrice) summary += `- Raise max price from $${criteria.maxPrice.toLocaleString()}\n`;
      if (criteria.beds) summary += `- Try ${Math.max(1, criteria.beds - 1)}+ bedrooms instead of ${criteria.beds}+\n`;
      if (criteria.propertyType) summary += `- Remove "${criteria.propertyType}" filter\n`;
      if (criteria.region) summary += `- Expand beyond ${criteria.region}\n`;
      summary += "\n";
    }

    summary += "### Current Search Profile\n";
    if (criteria.minPrice || criteria.maxPrice) {
      summary += `- Budget: ${criteria.minPrice ? "$" + criteria.minPrice.toLocaleString() : "Any"} ¡ª ${criteria.maxPrice ? "$" + criteria.maxPrice.toLocaleString() : "Any"}\n`;
    }
    if (criteria.beds) {
      const bedLabel = criteria.exactBeds ? "exactly " + criteria.beds : criteria.beds + "+";
      summary += "- Bedrooms: " + bedLabel + "\n";
    }
    if (criteria.baths) summary += "- Bathrooms: " + criteria.baths + "+\n";
    if (criteria.propertyType) summary += "- Type: " + criteria.propertyType + "\n";
    if (criteria.region) summary += "- Region: " + criteria.region + "\n";
    if (criteria.requiredAmenities && criteria.requiredAmenities.length > 0) {
      summary += "- Amenities: " + criteria.requiredAmenities.join(", ") + "\n";
    }
    summary += "\n---\n*Tell me more about what you're looking for, and I'll refine the search!*";
    return summary;
  }

  formatAsHtml(scrapeReport, analysisReport, listings) {
    let html = "";
    if (listings.length > 0) {
      html += "<div class=\"listings-grid\">";
      for (const l of listings.slice(0, 6)) {
        const amenityHTML = (l.amenities || []).map(a => {
          const icons = { pool: "??", garage: "??", yard: "??", gym: "???", parking: "???", doorman: "??", rooftop: "???" };
          return "<span title=\"" + a + "\">" + (icons[a] || "?") + " " + a + "</span>";
        }).join("");
        html += "<div class=\"listing-card\"><div class=\"listing-price\">$" + l.price.toLocaleString() + "</div>";
        html += "<div class=\"listing-address\">" + l.address + (l.city ? ", " + l.city : "") + "</div>";
        html += "<div class=\"listing-details\">";
        if (l.beds) html += "<span>??? " + l.beds + " bed</span>";
        if (l.baths) html += "<span>?? " + l.baths + " bath</span>";
        if (l.sqft) html += "<span>?? " + l.sqft.toLocaleString() + " sqft</span>";
        if (amenityHTML) html += "<span>" + amenityHTML + "</span>";
        html += "</div>";
        if (l.propertyType) html += "<div class=\"listing-type\">" + l.propertyType + "</div>";
        html += "</div>";
      }
      html += "</div>";
    }
    return html;
  }

  scheduleWatch(send) {
    const interval = (this.currentCriteria.watchInterval || 60) * 60 * 1000;
    if (this._watchTimer) clearInterval(this._watchTimer);
    this._watchTimer = setInterval(async () => {
      const report = await this.scraper.run({
        criteria: this.currentCriteria,
        sources: this.currentCriteria.sources || ["zillow", "realtor"],
        region: this.currentCriteria.region || "",
      });
      const listings = this.extractListingsFromReport(report);
      if (listings.length > 0) {
        send("watch_update", { newListings: listings, count: listings.length, timestamp: Date.now() });
        await this.memorizer.run({ action: "remember_properties", sessionId: this.sessionId, properties: listings });
      }
    }, interval);
  }

  getConversationHistory() {
    const conv = this.memorizer.conversations.get(this.sessionId);
    return conv?.messages || [];
  }
  getState() {
    return {
      criteria: this.currentCriteria,
      sessionId: this.sessionId,
      userId: this.userId,
    };
  }

  /**
   * Clean shutdown.
   */
  shutdown() {
    if (this._watchTimer) clearInterval(this._watchTimer);
    this.scraper.shutdown();
    this.analyzer.shutdown();
    this.memorizer.shutdown();
    super.shutdown();
  }
}

export default OrchestratorAgent;







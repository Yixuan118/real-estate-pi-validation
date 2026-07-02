// ============================================================
// server/agents/AnalyzerAgent.js
//
// Analyzer subagent — synthesizes raw listing data into insights.
// Mirrors pi-collaborating-agents "reviewer" type with high reasoning.
//
// agent_message({ action: "send", to: "orchestrator", ... })
// for reporting analysis results.
// ============================================================

import BaseAgent from "./BaseAgent.js";

class AnalyzerAgent extends BaseAgent {
  constructor(name) {
    super(name, "analyzer");
    this.analysisHistory = [];
  }

  /**
   * Run analysis on scraped listings.
   * Mirrors pi subagent.run() lifecycle.
   *
   * @param {object} task - { listings: Listing[], criteria: SearchCriteria, history?: Analysis[] }
   * @returns {Promise<string>} Structured analysis report
   */
  async run(task) {
    const { listings = [], criteria = {}, history = [] } = task;

    this.broadcast(`Analyzer ${this.name} starting analysis of ${listings.length} listings`);
    this.sendTo("orchestrator", `Analyzing ${listings.length} listings against current criteria`);

    // ── Price analysis ──────────────────────────────────────
    const prices = listings.map((l) => l.price).filter((p) => p != null);
    const avgPrice = prices.length > 0
      ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length)
      : 0;
    const minPrice = prices.length > 0 ? Math.min(...prices) : 0;
    const maxPrice = prices.length > 0 ? Math.max(...prices) : 0;

    // ── Property type distribution ──────────────────────────
    const typeCounts = {};
    for (const l of listings) {
      const t = l.propertyType || "Unknown";
      typeCounts[t] = (typeCounts[t] || 0) + 1;
    }

    // ── Bed/bath distribution ────────────────────────────────
    const bedCounts = {};
    const bathCounts = {};
    for (const l of listings) {
      const b = l.beds != null ? l.beds : "?";
      const ba = l.baths != null ? l.baths : "?";
      bedCounts[b] = (bedCounts[b] || 0) + 1;
      bathCounts[ba] = (bathCounts[ba] || 0) + 1;
    }

    // ── Market sentiment ────────────────────────────────────
    const marketAssessment = this.assessMarket(listings, criteria, avgPrice);

    // ── Criteria recommendations ────────────────────────────
    const recommendations = this.generateRecommendations(listings, criteria);

    // ── Build report ────────────────────────────────────────
    const report = this.formatReport(
      listings,
      criteria,
      { avgPrice, minPrice, maxPrice },
      { typeCounts, bedCounts, bathCounts },
      marketAssessment,
      recommendations
    );

    this.analysisHistory.push({ timestamp: Date.now(), criteria, listingCount: listings.length, report });

    this.broadcast(`Analyzer ${this.name} completed analysis`);
    return report;
  }

  assessMarket(listings, criteria, avgPrice) {
    if (listings.length === 0) {
      return {
        sentiment: "no exact matches found — consider broadening search criteria",
        score: 0,
        tips: [
          "Increase max price or remove budget ceiling",
          "Lower minimum bedroom/bathroom requirements",
          "Expand to nearby regions",
          "Remove property type filter"
        ]
      };
    }

    const score = Math.min(100, Math.max(0,
      Math.min(listings.length * 10, 50) +
      (listings.length > 1 ? 15 : 0) +
      10
    ));

    let sentiment;
    if (score >= 70) sentiment = "active market with good inventory";
    else if (score >= 40) sentiment = "moderate inventory";
    else sentiment = "limited listings available";

    return { sentiment, score, tips: [] };
  }

  generateRecommendations(listings, criteria) {
    const recs = [];
    const prices = listings.map((l) => l.price).filter((p) => p != null);

    if (prices.length > 0) {
      const avg = Math.round(prices.reduce((a, b) => a + b, 0) / prices.length);
      if (criteria.maxPrice && avg < criteria.maxPrice * 0.7) {
        recs.push("Most listings are well below max budget — consider expanding price range for premium options.");
      }
      if (criteria.minPrice && avg > criteria.minPrice * 1.5) {
        recs.push("Average price significantly exceeds min price — consider narrowing search area.");
      }
    }

    if (criteria.beds) {
      const withBeds = listings.filter((l) => l.beds != null && l.beds >= criteria.beds);
      if (withBeds.length === 0) {
        recs.push(`No listings found with ${criteria.beds}+ beds — consider lowering bed minimum.`);
      }
    }

    if (listings.length > 0 && !criteria.propertyType) {
      const types = [...new Set(listings.map((l) => l.propertyType).filter(Boolean))];
      if (types.length > 0) {
        recs.push(`Available property types: ${types.join(", ")} — consider filtering by type for precision.`);
      }
    }

    return recs;
  }

  formatReport(listings, criteria, priceStats, distributions, market, recommendations) {
    const lines = [];

    lines.push("## Market Analysis Summary");
    lines.push(`Analyzed ${listings.length} listings. Market: **${market.sentiment}** (score: ${market.score}/100)`);
    lines.push("");

    lines.push("## Price Analysis");
    if (listings.length > 0) {
      lines.push(`- Price range: **$${priceStats.minPrice.toLocaleString()}** — **$${priceStats.maxPrice.toLocaleString()}**`);
      lines.push(`- Average price: **$${priceStats.avgPrice.toLocaleString()}**`);
    } else {
      lines.push("- No price data available.");
    }
    lines.push("");

    lines.push("## Property Distribution");
    lines.push("### By Type");
    for (const [type, count] of Object.entries(distributions.typeCounts).sort((a, b) => b[1] - a[1])) {
      lines.push(`- ${type}: ${count} (${Math.round((count / listings.length) * 100)}%)`);
    }
    lines.push("");
    lines.push("### By Bedrooms");
    for (const [beds, count] of Object.entries(distributions.bedCounts).sort((a, b) => a[0] - b[0])) {
      lines.push(`- ${beds} bed: ${count}`);
    }
    lines.push("");
    lines.push("### By Bathrooms");
    for (const [baths, count] of Object.entries(distributions.bathCounts).sort((a, b) => a[0] - b[0])) {
      lines.push(`- ${baths} bath: ${count}`);
    }
    lines.push("");

    if (recommendations.length > 0) {
      lines.push("## Recommendations");
      for (const r of recommendations) {
        lines.push(`- 💡 ${r}`);
      }
      lines.push("");
    }

    lines.push("## Notes");
    lines.push(`- Analysis agent: ${this.name}`);
    lines.push(`- Timestamp: ${new Date().toISOString()}`);
    if (this.analysisHistory.length > 1) {
      lines.push(`- This is analysis #${this.analysisHistory.length} in the conversation.`);
      const prev = this.analysisHistory[this.analysisHistory.length - 2];
      lines.push(`- Previous analysis had ${prev.listingCount} listings.`);
    }

    return lines.join("\n");
  }
}

export default AnalyzerAgent;


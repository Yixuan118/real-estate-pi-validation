# ?? Real Estate Multi-Agent Search & Monitor

A real estate property search and monitoring web app powered by a multi-agent architecture strictly following [pi-collaborating-agents](https://github.com/baochunli/pi-collaborating-agents) parallel agent coordination pattern.

## Architecture

```
Orchestrator ©¤©¤¡ú MemoryKeeper (criteria extraction & persistence)
            ©À©¤©¤¡ú PropertyScraper (parallel source scraping via Promise.all)
            ©À©¤©¤¡ú MarketAnalyst (analysis in parallel with memory storage)
            ©¸©¤©¤¡ú AgentBus (agent_message routing: send/broadcast/feed/reserve)
```

All agents communicate through the `agent_message()` protocol:
- `send` / `broadcast` for messaging
- `reserve` / `release` for file coordination
- `list` / `feed` / `status` for introspection

## Features

- **Natural language search**: "I'm looking for a 3-bedroom house under $500k in Seattle with a pool and garage"
- **Progressive filtering**: Add conditions one by one ¡ª results narrow like Meituan multi-condition search
- **Multi-amenity detection**: pool, garage, yard, gym, rooftop, parking, doorman
- **150+ diverse listings**: 15 cities, multiple property types, rich amenity data
- **Watch mode**: Set and forget ¡ª get alerts when new matches appear
- **Memory persistence**: AI remembers all conversations and updates criteria

## Quick Start

```bash
# Install dependencies
npm install

# Start the server
node server/index.js

# Or on Windows:
start.bat
```

Open http://localhost:3099

## Environment Variables

| Variable | Description |
|---|---|
| `PORT` | Server port (default: 3099) |
| `FIRECRAWL_API_KEY` | API key for live scraping (omit for simulated demo data) |

## Project Structure

```
outputs/
©À©¤©¤ client/
©¦   ©¸©¤©¤ index.html          # Web UI (dark theme, chat interface)
©À©¤©¤ server/
©¦   ©À©¤©¤ index.js            # Express + WebSocket entry point
©¦   ©¸©¤©¤ agents/
©¦       ©À©¤©¤ AgentBus.js     # pi agent_message() bus (send/broadcast/reserve/release)
©¦       ©À©¤©¤ BaseAgent.js    # Base class with auto-registration
©¦       ©À©¤©¤ OrchestratorAgent.js  # Coordinator ¡ª spawns parallel sub-agents
©¦       ©À©¤©¤ FirecrawlScraperAgent.js  # Property scraper (parallel sources)
©¦       ©À©¤©¤ AnalyzerAgent.js        # Market analysis agent
©¦       ©¸©¤©¤ MemoryAgent.js          # Conversation & criteria persistence
©À©¤©¤ package.json
©¸©¤©¤ start.bat
```

## Example Queries

- "I'm looking for a 2-bedroom house under $500k in Seattle with a pool"
- "3-bedroom house under $500k in Seattle with a pool and garage"
- "I want a condo under $300k in Miami with a gym"
- "and a yard too" (progressive ¡ª adds to existing criteria)
- "with a pool" (progressive ¡ª stacks onto previous filters)

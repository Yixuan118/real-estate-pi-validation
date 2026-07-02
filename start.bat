@'
echo ""
echo "🏠 Real Estate Multi-Agent Search App"
echo "====================================="
echo ""
echo "Starting server at http://localhost:$env:PORT"
echo ""
echo "Set FIRECRAWL_API_KEY for live property scraping."
echo "Without it, simulated demo data is used."
echo ""

node server/index.js

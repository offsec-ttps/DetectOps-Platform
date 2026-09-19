#!/bin/bash
#
# Run script for Attack Range API
#

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}╔═══════════════════════════════════════╗${NC}"
echo -e "${GREEN}║     Attack Range API Launcher         ║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════════╝${NC}"
echo ""


# Display startup info
echo ""
echo -e "${GREEN}═══════════════════════════════════════${NC}"
echo -e "${GREEN}Starting Attack Range API...${NC}"
echo -e "${GREEN}═══════════════════════════════════════${NC}"
echo ""
echo -e "  API Server:         ${GREEN}http://localhost:4000${NC}"
echo -e "  OpenAPI Docs:       ${GREEN}http://localhost:4000/openapi/swagger${NC}"
echo -e "  ReDoc:              ${GREEN}http://localhost:4000/openapi/redoc${NC}"
echo -e "  OpenAPI JSON:       ${GREEN}http://localhost:4000/openapi/openapi.json${NC}"
echo ""
echo -e "${YELLOW}Press Ctrl+C to stop the server${NC}"
echo ""
echo -e "${GREEN}═══════════════════════════════════════${NC}"
echo ""

# Run the Flask app
python3 app.py

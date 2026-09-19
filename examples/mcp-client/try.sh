#!/usr/bin/env bash
# Quick smoke test of the detection-content MCP server over Streamable HTTP.
#   ENDPOINT=http://localhost:3000/api/mcp KEY=dmcp_... ./try.sh
set -euo pipefail

ENDPOINT="${ENDPOINT:-http://localhost:3000/api/mcp}"
KEY="${KEY:?Set KEY=dmcp_... (mint one at /mcp-registry or POST /api/mcp/keys)}"

hdr=(-H "Authorization: Bearer $KEY" -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream")

echo "# initialize"
curl -s -X POST "$ENDPOINT" "${hdr[@]}" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"try.sh","version":"1"}}}'
echo; echo

echo "# tools/list"
curl -s -X POST "$ENDPOINT" "${hdr[@]}" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'
echo; echo

echo "# tools/call search_detections q=powershell"
curl -s -X POST "$ENDPOINT" "${hdr[@]}" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"search_detections","arguments":{"q":"powershell","limit":3}}}'
echo; echo

echo "# tools/call list_by_mitre technique=T1059"
curl -s -X POST "$ENDPOINT" "${hdr[@]}" \
  -d '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"list_by_mitre","arguments":{"technique":"T1059","limit":5}}}'
echo

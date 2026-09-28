# Oli local MCP hub

Oli exposes a local Model Context Protocol server over stdio. It reads the same SQLite database used by the desktop app and does not receive or expose provider API keys.

## Run

From the repository root:

    OLI_DB_PATH="$HOME/Library/Application Support/Oli/data/oli.db" npm run mcp

Or pass an explicit database path:

    node mcp/server.js --db "/path/to/oli.db"

The server is intentionally stdio-only. Keep it configured as a local process in your MCP client.

## Tools

- oli_list_meetings
- oli_get_meeting
- oli_search_knowledge
- oli_search_transcript
- oli_list_commitments

All returned records come directly from the local SQLite store. API keys and model configuration secrets are never returned.

## Client configuration

Example shape for an MCP client:

    {
      "mcpServers": {
        "oli": {
          "command": "node",
          "args": ["/ABSOLUTE/PATH/TO/Oli-AI-Voice-Taking-Tool/mcp/server.js"],
          "env": { "OLI_DB_PATH": "/ABSOLUTE/PATH/TO/oli.db" }
        }
      }
    }

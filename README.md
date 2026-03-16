# revibe-mcp

MCP server for [Revibe](https://revibe.codes) codebase analysis. Works with Claude Desktop, Cursor, Windsurf, and any MCP-compatible client.

Analyze any GitHub repo — get architecture, file roles, execution flows, system design Q&A, and structured agent context.

## Quick Start (Node.js — zero install)

Add to your MCP client config:

```json
{
  "mcpServers": {
    "revibe": {
      "command": "npx",
      "args": ["revibe-mcp"]
    }
  }
}
```

Then ask your AI assistant to "log in to Revibe" — it will open your browser for a one-time signup.

## Quick Start (Python)

```bash
pip install revibe-mcp
revibe-mcp-auth login
```

```json
{
  "mcpServers": {
    "revibe": {
      "command": "revibe-mcp"
    }
  }
}
```

## Where to add the config

| Client | Config location |
|--------|----------------|
| **Claude Desktop** | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| **Claude Code** | `.mcp.json` in your project root |
| **Cursor** | Settings > MCP Servers > Add |
| **Windsurf** | MCP config in settings |

## Auth

Two options:

**Option A: Browser login (recommended)**
```bash
# Node.js
npx revibe-mcp-auth login

# Python
revibe-mcp-auth login
```
Opens your browser — sign up or log in, click "Authorize". API key saved automatically to `~/.config/revibe/credentials.json`.

**Option B: Manual API key**

Get a key from [revibe.codes/settings](https://revibe.codes/settings), then pass it via env:
```json
{
  "mcpServers": {
    "revibe": {
      "command": "npx",
      "args": ["revibe-mcp"],
      "env": {
        "REVIBE_API_KEY": "rk_live_your_key_here"
      }
    }
  }
}
```

## Tools

| Tool | Description |
|------|-------------|
| `revibe_login` | Log in via browser — one-time setup |
| `analyze_repo` | Submit a GitHub repo for analysis (auto-detects from git remote) |
| `check_status` | Check progress of an analysis job |
| `get_summary` | Architecture, modules, patterns overview |
| `get_section` | Drill into architecture, file_roles, system_design_qa, etc. |
| `get_agent_context` | Full structured JSON optimized for AI agents |

## Usage

Once configured, just ask your AI assistant:

- "Analyze this repo with Revibe"
- "What's the architecture of github.com/user/repo?"
- "Get the agent context for this codebase"

The tools handle auto-detection, polling, and structured output automatically.

## CLI Commands

```bash
# Node.js
npx revibe-mcp-auth login     # Log in via browser
npx revibe-mcp-auth status    # Show current auth status
npx revibe-mcp-auth logout    # Remove saved credentials

# Python
revibe-mcp-auth login
revibe-mcp-auth status
revibe-mcp-auth logout
```

## Packages

| Registry | Package | Install |
|----------|---------|---------|
| npm | [revibe-mcp](https://www.npmjs.com/package/revibe-mcp) | `npx revibe-mcp` |
| PyPI | [revibe-mcp](https://pypi.org/project/revibe-mcp/) | `pip install revibe-mcp` |

## License

MIT

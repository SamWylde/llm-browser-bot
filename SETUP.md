# LLM Browser Bot Setup Guide

Complete setup instructions for connecting LLM Browser Bot to various AI assistants.

## Supported Platforms

| Platform | MCP Support | Setup Difficulty |
|----------|-------------|------------------|
| Claude Desktop | Native | Easy |
| Cline (VS Code) | Native | Easy |
| Continue (VS Code) | Native | Easy |
| Cursor | Native | Easy |
| ChatGPT | Developer Mode | Medium |
| Gemini CLI | Native | Easy |

> **All major AI platforms now support MCP!** OpenAI added full MCP support to ChatGPT Developer Mode in September 2025, and Google supports MCP across Gemini models and Gemini CLI.

---

## Step 1: Install the Chrome Extension

### Option A: Chrome Web Store (Recommended)
1. Visit the [Chrome Web Store](https://to.kap.co/kapture-extension)
2. Click "Add to Chrome"
3. Confirm installation

### Option B: Manual Installation (Developer Mode)
1. Download or clone the repository
2. Open `chrome://extensions/` in Chrome/Brave/Edge
3. Enable "Developer mode" (top right)
4. Click "Load unpacked"
5. Select the `extension` folder

---

## Step 2: Configure Your AI Client

### Claude Desktop

**Config file locations:**
| OS | Path |
|----|------|
| macOS | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Windows | `%APPDATA%\Claude\claude_desktop_config.json` |
| Linux | `~/.config/Claude/claude_desktop_config.json` |

**Configuration:**
```json
{
  "mcpServers": {
    "llm-browser-bot": {
      "command": "npx",
      "args": ["-y", "llm-browser-bot", "bridge"]
    }
  }
}
```

**Steps:**
1. Open the config file (create if it doesn't exist)
2. Add the configuration above
3. Save and restart Claude Desktop
4. You should see "llm-browser-bot" in the MCP servers list

---

### Cline (VS Code Extension)

**Configuration:**
1. Open VS Code
2. Press `Cmd+,` (Mac) or `Ctrl+,` (Windows/Linux) to open Settings
3. Search for "cline.mcpServers"
4. Click "Edit in settings.json"
5. Add:

```json
{
  "cline.mcpServers": {
    "llm-browser-bot": {
      "command": "npx",
      "args": ["-y", "llm-browser-bot", "bridge"]
    }
  }
}
```

---

### Continue (VS Code Extension)

**Config file:** `~/.continue/config.json`

```json
{
  "mcpServers": {
    "llm-browser-bot": {
      "command": "npx",
      "args": ["-y", "llm-browser-bot", "bridge"]
    }
  }
}
```

---

### Cursor

**Config file:** Settings > MCP Servers

```json
{
  "mcpServers": {
    "llm-browser-bot": {
      "command": "npx",
      "args": ["-y", "llm-browser-bot", "bridge"]
    }
  }
}
```

---

### Custom MCP Client (WebSocket)

For custom integrations or manual server control:

1. Start the server manually:
```bash
npx llm-browser-bot
```

2. Connect via WebSocket:
```
URL: ws://localhost:61822/mcp
Protocol: MCP over WebSocket
```

---

## Step 3: Connect a Browser Tab

1. Open any website in Chrome/Brave/Edge
2. Open Developer Tools (F12 or Cmd+Option+I)
3. Click the "LLM Browser Bot" panel
4. Status should show "Connected"

The extension automatically connects to the server on port 61822.

---

## Step 4: Test the Connection

Ask your AI assistant:
> "Use get_active_tab to check if browser automation is working"

Or:
> "List all connected browser tabs"

---

## Troubleshooting

### "No tabs connected"
- Open Chrome DevTools (F12)
- Navigate to the "LLM Browser Bot" panel
- Check the connection status
- Try refreshing the page

### "Server not running"
- The bridge command should auto-start the server
- Try running manually: `npx llm-browser-bot`
- Check if port 61822 is available

### "MCP server not found" in Claude
- Verify config file syntax (valid JSON)
- Restart Claude Desktop completely
- Check the config file path is correct for your OS

### Node.js errors
- Ensure Node.js 18+ is installed: `node --version`
- Try clearing npm cache: `npm cache clean --force`

---

## Multiple AI Clients

LLM Browser Bot supports multiple AI clients simultaneously!

All clients connect to the same server and share access to browser tabs.

**Example setup:**
1. Claude Desktop - configured with bridge command
2. Cline - configured with bridge command
3. Both can control the same browser tabs

The server auto-detects if already running - no conflicts!

---

## ChatGPT (Developer Mode)

ChatGPT now supports MCP through Developer Mode (available to Pro, Plus, Business, Enterprise, and Education accounts).

**Setup:**
1. Start the LLM Browser Bot server manually:
```bash
npx llm-browser-bot
```

2. In ChatGPT, enable Developer Mode
3. Add a custom MCP connector pointing to: `ws://localhost:61822/mcp`

For detailed instructions, see: [OpenAI Developer Mode Documentation](https://platform.openai.com/docs/guides/developer-mode)

---

## Gemini CLI

Google's Gemini CLI has built-in MCP support.

**Setup:**
1. Install Gemini CLI: https://geminicli.com
2. Start the LLM Browser Bot server:
```bash
npx llm-browser-bot
```

3. Configure Gemini CLI to use the MCP server at `ws://localhost:61822/mcp`

For detailed instructions, see: [Gemini CLI MCP Documentation](https://geminicli.com/docs/tools/mcp-server/)

---

## Need Help?

- [Documentation](https://samwylde.github.io/llm-browser-bot/)
- [GitHub Issues](https://github.com/SamWylde/llm-browser-bot/issues)
- [MCP Usage Guide](https://samwylde.github.io/llm-browser-bot/MCP_USAGE.html)

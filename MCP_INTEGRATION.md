# JODA MCP (Model Context Protocol) Integration

## 🎯 Overview

JODA agents can now use **MCP (Model Context Protocol)** to call external tools, interact with applications, and execute complex tasks. This allows agents to:

1. **Access File Systems** - Read/write files, list directories
2. **Search the Web** - Brave Search, Google, etc.
3. **Automate Browsers** - Puppeteer for web scraping
4. **Query Databases** - PostgreSQL, SQLite
5. **Integrate with GitHub** - Repos, issues, PRs
6. **Send Notifications** - Slack, email, webhooks
7. **Call Custom Tools** - Trading-specific tools

All tool executions are **logged and reported back to JODA** for full visibility.

---

## ✅ Using Codex MCP Servers From JODA (Recommended)

If you've already added MCP servers via `codex mcp add ...`, JODA can reuse those definitions directly from Codex’s config.

**Enable import**
- Set `JODA_MCP_IMPORT_CODEX=1` in the backend environment.
- Optional: `JODA_CODEX_CONFIG_PATH=/root/.codex/config.toml` (override location)
- Optional: `JODA_MCP_CODEX_ENABLE_BY_DEFAULT=1` (auto-start imported servers at MCP client startup; default is off)

**How to call tools**
- Use `mcp_list_tools` to see discovered tools.
- You can also call tools directly by fully-qualified name even if discovery isn’t populated yet:
  - `mcp_call` with `tool_name: "<server>.<tool>"` and `arguments: {...}`

**Automate rediscovery**
- Create a scheduler job with `task_type: "mcp_reload"` to reload MCP config and re-discover tools on an interval/cron schedule.

**PubMed MCP**
- If you added `pubmed` via `codex mcp add pubmed -- npx -y @cyanheads/pubmed-mcp-server`, JODA can import it (see above) and then you can call tools via `mcp_list_tools` / `mcp_call_tool`.
- JODA also includes a `pubmed` entry in `backend/mcp_servers.json` so it’s available immediately after an `mcp_reload` (or backend restart).

**Healthcare MCP discovery**
- Create a scheduler job with `task_type: "healthcare_mcp_discovery"` to run a web-agent pass that searches for real healthcare-related MCP servers and writes a catalog under `projects/healthcare_mcp_catalog/`.

**MCP directory discovery**
- Create a scheduler job with `task_type: "mcp_directory_discovery"` to crawl `https://mcp.so/categories` and write a reviewable catalog under `projects/mcp_directory_catalog/`.

---

## 📁 Architecture

```
JODA Backend
    ├── agent_manager.py      # Manages all agents
    ├── mcp_client.py          # MCP protocol client
    ├── mcp_servers.json       # Server configurations
    └── server.py              # Socket.IO endpoints

MCP Servers (External Processes)
    ├── @modelcontextprotocol/server-filesystem
    ├── @modelcontextprotocol/server-puppeteer
    ├── @modelcontextprotocol/server-brave-search
    ├── @modelcontextprotocol/server-github
    ├── @modelcontextprotocol/server-postgres
    ├── @modelcontextprotocol/server-sqlite
    ├── @modelcontextprotocol/server-slack
    └── custom trading tools

Agents
    ├── Freqtrade Agent        # Can use filesystem, fetch, trading tools
    ├── Hummingbot Agent       # Can use filesystem, fetch, database
    ├── RL Trading Agent       # Can use filesystem, fetch, puppeteer
    ├── Arbitrage Agent        # Can use fetch, puppeteer, trading tools
    └── Data Collector Agent   # Can use filesystem, fetch, database
```

---

## 🛠️ Available MCP Servers

### 1. Filesystem Server
**Tools:**
- `filesystem.read_file` - Read file contents
- `filesystem.write_file` - Write to file
- `filesystem.list_directory` - List directory contents
- `filesystem.create_directory` - Create directory
- `filesystem.delete_file` - Delete file (restricted)

**Configuration:**
```json
{
  "filesystem": {
    "command": ["npx", "-y", "@modelcontextprotocol/server-filesystem", "/root/Desktop/biz_automate"],
    "transport": "stdio",
    "enabled": true
  }
}
```

### 2. Puppeteer Server (Browser Automation)
**Tools:**
- `puppeteer.navigate` - Navigate to URL
- `puppeteer.screenshot` - Take screenshot
- `puppeteer.click` - Click element
- `puppeteer.fill` - Fill form input
- `puppeteer.evaluate` - Run JavaScript

**Use Cases:**
- Monitor DEX interfaces for arbitrage
- Scrape trading data
- Capture charts/graphs

### 3. Fetch Server (HTTP Requests)
**Tools:**
- `fetch.get` - HTTP GET request
- `fetch.post` - HTTP POST request

**Use Cases:**
- Call exchange APIs
- Fetch market data
- Webhook notifications

### 4. Brave Search Server
**Tools:**
- `brave-search.search` - Web search
- `brave-search.local` - Local business search

**Requires:**
- `BRAVE_API_KEY` environment variable

### 5. SQLite Server
**Tools:**
- `sqlite.query` - Execute SELECT query
- `sqlite.execute` - Execute INSERT/UPDATE/DELETE

**Use Cases:**
- Store trading history
- Cache market data
- Log agent activities

### 6. Slack Server
**Tools:**
- `slack.post_message` - Send message to channel
- `slack.upload_file` - Upload file

**Requires:**
- `SLACK_BOT_TOKEN`
- `SLACK_TEAM_ID`

### 7. GitHub Server
**Tools:**
- `github.get_file` - Read file from repo
- `github.create_issue` - Create issue
- `github.create_pr` - Create pull request

**Requires:**
- `GITHUB_PERSONAL_ACCESS_TOKEN`

---

## 🔐 Agent Tool Permissions

Each agent type has specific tools it can access:

### Freqtrade Agent
```json
{
  "allowed_tools": [
    "filesystem.read_file",
    "filesystem.write_file",
    "fetch.get",
    "fetch.post",
    "puppeteer.screenshot",
    "sqlite.query"
  ]
}
```

**Example Use Cases:**
- Read strategy files
- Fetch exchange data via API
- Log trades to SQLite
- Capture trading charts

### Hummingbot Agent
```json
{
  "allowed_tools": [
    "filesystem.read_file",
    "filesystem.write_file",
    "fetch.get",
    "postgres.query",
    "slack.post_message"
  ]
}
```

### RL Trading Agent
```json
{
  "allowed_tools": [
    "filesystem.read_file",
    "filesystem.write_file",
    "filesystem.create_directory",
    "fetch.get",
    "puppeteer.screenshot",
    "sqlite.query"
  ]
}
```

### Arbitrage Agent
```json
{
  "allowed_tools": [
    "filesystem.read_file",
    "fetch.get",
    "fetch.post",
    "puppeteer.navigate",
    "slack.post_message"
  ]
}
```

### Data Collector Agent
```json
{
  "allowed_tools": [
    "filesystem.write_file",
    "fetch.get",
    "postgres.execute",
    "sqlite.execute",
    "puppeteer.screenshot"
  ]
}
```

---

## 🚀 Usage Examples

### Example 1: Deploy Agent with MCP Tools

```javascript
// Frontend: Deploy Freqtrade agent
socket.emit('deploy_agent', {
  type: 'freqtrade',
  name: 'BTC_Scalper',
  config: {
    strategy: 'ScalpingStrategy',
    pair: 'BTC/USDT',
    dry_run: true
  }
});

// Agent automatically gets MCP tools
socket.on('agent_deployed', (data) => {
  console.log('Agent deployed:', data.agent_id);
  console.log('Available tools:', data.agent.available_tools);
});
```

### Example 2: Agent Calls File System Tool

```javascript
// Agent reads a configuration file
socket.emit('call_mcp_tool', {
  agent_id: 'freqtrade_1234567890',
  tool_name: 'filesystem.read_file',
  arguments: {
    path: '/root/Desktop/biz_automate/freqtrade/user_data/config.json'
  }
});

// Receive result
socket.on('mcp_tool_result', (result) => {
  console.log('File contents:', result.result.content);
});
```

### Example 3: Agent Fetches Market Data

```javascript
// Agent calls Binance API
socket.emit('call_mcp_tool', {
  agent_id: 'freqtrade_1234567890',
  tool_name: 'fetch.get',
  arguments: {
    url: 'https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT'
  }
});

socket.on('mcp_tool_result', (result) => {
  const data = JSON.parse(result.result.body);
  console.log('BTC Price:', data.lastPrice);
});
```

### Example 4: Agent Takes Screenshot of Trading Chart

```javascript
// Arbitrage agent captures DEX interface
socket.emit('call_mcp_tool', {
  agent_id: 'arbitrage_1234567890',
  tool_name: 'puppeteer.screenshot',
  arguments: {
    url: 'https://app.uniswap.org/#/swap',
    selector: '.chart-container',
    path: '/tmp/uniswap_chart.png'
  }
});
```

### Example 5: Agent Sends Slack Notification

```javascript
// Agent reports arbitrage opportunity
socket.emit('call_mcp_tool', {
  agent_id: 'arbitrage_1234567890',
  tool_name: 'slack.post_message',
  arguments: {
    channel: '#trading-alerts',
    text: '🚨 Arbitrage opportunity detected! ETH: Uniswap $3500 vs Sushiswap $3520'
  }
});
```

### Example 6: Agent Stores Data in SQLite

```javascript
// RL Trading agent logs training metrics
socket.emit('call_mcp_tool', {
  agent_id: 'rl_trading_1234567890',
  tool_name: 'sqlite.execute',
  arguments: {
    database: '/root/Desktop/biz_automate/reinforcement_learning_trading_bot/data/metrics.db',
    query: 'INSERT INTO training_runs (timestamp, reward, loss) VALUES (?, ?, ?)',
    params: [Date.now(), 150.5, 0.023]
  }
});
```

---

## 📊 Agent Feedback & Reporting

All MCP tool calls are automatically reported back to JODA:

### Tool Execution Feedback
```javascript
socket.on('agent_feedback', (feedback) => {
  if (feedback.type === 'tool_executed') {
    console.log(`Agent ${feedback.agent_id} executed tool ${feedback.data.tool}`);
    console.log('Arguments:', feedback.data.arguments);
    console.log('Result:', feedback.data.result);
  }

  if (feedback.type === 'tool_error') {
    console.error(`Tool ${feedback.data.tool} failed:`, feedback.data.error);
  }
});
```

### Agent Metrics
```javascript
// Get agent statistics
socket.emit('get_agent_stats');

socket.on('agent_stats', (stats) => {
  console.log('Total MCP calls:', stats.total_mcp_calls);
  console.log('Successful calls:', stats.successful_mcp_calls);
  console.log('Failed calls:', stats.failed_mcp_calls);
});
```

---

## 🔧 Configuration

### Enable/Disable MCP Servers

Edit `backend/mcp_servers.json`:

```json
{
  "servers": {
    "filesystem": {
      "enabled": true   // ✅ Enabled
    },
    "brave-search": {
      "enabled": false  // ❌ Disabled (requires API key)
    }
  }
}
```

### Set API Keys

Create `.env` file in backend/:

```bash
# Brave Search
BRAVE_API_KEY=your_brave_api_key

# GitHub
GITHUB_PERSONAL_ACCESS_TOKEN=your_github_token

# Slack
SLACK_BOT_TOKEN=xoxb-your-token
SLACK_TEAM_ID=T01234567

# PostgreSQL
POSTGRES_CONNECTION_STRING=postgresql://user:pass@localhost:5432/db
```

### Rate Limiting

Configure in `mcp_servers.json`:

```json
{
  "tool_rate_limits": {
    "fetch.get": {
      "max_calls_per_minute": 60,
      "max_calls_per_hour": 1000
    },
    "puppeteer.navigate": {
      "max_calls_per_minute": 10,
      "max_calls_per_hour": 100
    }
  }
}
```

---

## 🧪 Testing MCP Integration

### 1. List Available Tools

```javascript
socket.emit('list_mcp_tools');

socket.on('mcp_tools_list', (data) => {
  data.tools.forEach(tool => {
    console.log(`${tool.name}: ${tool.description}`);
  });
});
```

### 2. Get Tools for Specific Agent Type

```javascript
socket.emit('list_mcp_tools', { agent_type: 'freqtrade' });

socket.on('mcp_tools_list', (data) => {
  console.log('Freqtrade agent tools:', data.tools);
});
```

### 3. Get Agent's Available Tools

```javascript
socket.emit('get_agent_tools', { agent_id: 'freqtrade_1234567890' });

socket.on('agent_tools', (data) => {
  console.log('Agent tools:', data.tools);
});
```

### 4. Check MCP Server Status

```javascript
socket.emit('get_mcp_servers');

socket.on('mcp_servers', (data) => {
  data.servers.forEach(server => {
    console.log(`${server.name}: ${server.enabled ? '✅' : '❌'}`);
  });
});
```

---

## 🏗️ Creating Custom MCP Servers

### Example: Custom Trading Tools Server

Create `backend/trading_mcp_server.py`:

```python
import asyncio
import json
import sys

async def backtest(strategy, data, config):
    """Run backtest on strategy"""
    # Backtest implementation
    return {
        "profit": 15.5,
        "trades": 150,
        "win_rate": 0.65
    }

async def get_market_data(symbol, timeframe):
    """Fetch market data"""
    # API call to exchange
    return {
        "symbol": symbol,
        "price": 50000,
        "volume": 1000000
    }

# MCP server main loop
async def main():
    while True:
        try:
            # Read JSON-RPC request from stdin
            line = await asyncio.to_thread(sys.stdin.readline)
            if not line:
                break

            request = json.loads(line)

            # Handle tool calls
            if request["method"] == "tools/list":
                response = {
                    "jsonrpc": "2.0",
                    "id": request["id"],
                    "result": {
                        "tools": [
                            {
                                "name": "backtest",
                                "description": "Run backtest on trading strategy",
                                "inputSchema": {
                                    "type": "object",
                                    "properties": {
                                        "strategy": {"type": "string"},
                                        "data": {"type": "string"},
                                        "config": {"type": "object"}
                                    }
                                }
                            },
                            {
                                "name": "get_market_data",
                                "description": "Fetch current market data",
                                "inputSchema": {
                                    "type": "object",
                                    "properties": {
                                        "symbol": {"type": "string"},
                                        "timeframe": {"type": "string"}
                                    }
                                }
                            }
                        ]
                    }
                }

            elif request["method"] == "tools/call":
                tool_name = request["params"]["name"]
                args = request["params"]["arguments"]

                if tool_name == "backtest":
                    result = await backtest(**args)
                elif tool_name == "get_market_data":
                    result = await get_market_data(**args)
                else:
                    result = {"error": "Unknown tool"}

                response = {
                    "jsonrpc": "2.0",
                    "id": request["id"],
                    "result": result
                }

            # Write response to stdout
            print(json.dumps(response), flush=True)

        except Exception as e:
            print(json.dumps({
                "jsonrpc": "2.0",
                "id": request.get("id"),
                "error": {"message": str(e)}
            }), flush=True)

if __name__ == "__main__":
    asyncio.run(main())
```

Add to `mcp_servers.json`:

```json
{
  "servers": {
    "custom-trading-tools": {
      "command": ["python3", "-m", "trading_mcp_server"],
      "transport": "stdio",
      "enabled": true
    }
  }
}
```

---

## 📈 Benefits

### For Agents
- ✅ Access to 100+ tools across multiple domains
- ✅ No need to implement file I/O, HTTP, database logic
- ✅ Standardized tool interface
- ✅ Automatic rate limiting and error handling

### For JODA
- ✅ Full visibility into agent actions
- ✅ Centralized logging and monitoring
- ✅ Control over tool permissions
- ✅ Easy to add new capabilities

### For Users
- ✅ Agents can accomplish complex tasks autonomously
- ✅ Real-time feedback on agent activities
- ✅ Extensible via custom MCP servers
- ✅ Secure by default (permission-based)

---

## 🔒 Security

1. **Permission-Based Access**: Each agent type has explicit allowed/denied tools
2. **Rate Limiting**: Prevent abuse of external APIs
3. **Sandboxing**: File operations restricted to biz_automate directory
4. **Logging**: All tool calls logged with agent ID, tool name, arguments
5. **Validation**: Input schemas validated before execution

---

## 🚦 Next Steps

1. **Configure API Keys**: Add Brave, GitHub, Slack tokens to `.env`
2. **Enable Servers**: Set `enabled: true` in `mcp_servers.json`
3. **Deploy Agents**: Use Socket.IO to deploy agents
4. **Monitor Activity**: Watch `agent_feedback` events
5. **Build Custom Tools**: Create domain-specific MCP servers

---

## 📚 Resources

- [MCP Specification](https://modelcontextprotocol.io)
- [MCP Server Examples](https://github.com/modelcontextprotocol/servers)
- [JODA Agent Manager](./agent_manager.py)
- [MCP Client Implementation](./mcp_client.py)

---

**JODA agents are now empowered with tools! 🎉**

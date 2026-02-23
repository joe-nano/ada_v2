"""
MCP (Model Context Protocol) Client for JODA Agents

This module provides MCP client capabilities for agents to:
1. Call external tools via MCP servers
2. Interact with other applications
3. Execute complex workflows
4. Report results back to JODA

MCP servers are external processes that expose tools/capabilities via stdio or HTTP.
"""

import asyncio
import json
import logging
import os
from typing import Dict, List, Any, Optional, Callable
from dataclasses import dataclass, asdict
import subprocess
from pathlib import Path
import aiohttp

logger = logging.getLogger(__name__)

try:  # Python 3.11+
    import tomllib  # type: ignore
except Exception:  # pragma: no cover
    tomllib = None


@dataclass
class MCPTool:
    """Represents an MCP tool that can be called by agents"""
    name: str
    description: str
    input_schema: Dict[str, Any]
    server_name: str

    def to_dict(self):
        return asdict(self)


@dataclass
class MCPServer:
    """Configuration for an MCP server"""
    name: str
    command: List[str]
    env: Optional[Dict[str, str]] = None
    transport: str = "stdio"  # "stdio" or "http"
    url: Optional[str] = None  # For HTTP transport
    enabled: bool = True

    def to_dict(self):
        return asdict(self)


class MCPClient:
    """
    MCP Client for agent tool execution

    Manages connections to MCP servers and handles tool calls
    """

    def __init__(self, config_path: Optional[str] = None):
        self.servers: Dict[str, MCPServer] = {}
        self.processes: Dict[str, subprocess.Popen] = {}
        self.tools: Dict[str, MCPTool] = {}
        self.tool_callbacks: Dict[str, Callable] = {}
        self.config_path = config_path or "mcp_servers.json"
        self._running = False
        import_env = (os.getenv("JODA_MCP_IMPORT_CODEX") or "").strip().lower()
        if import_env in {"0", "false", "no"}:
            self._import_codex = False
        elif import_env in {"1", "true", "yes"}:
            self._import_codex = True
        else:
            # Default: import Codex servers if Codex config exists.
            self._import_codex = Path("/root/.codex/config.toml").exists()
        self._codex_config_path = Path(
            (os.getenv("JODA_CODEX_CONFIG_PATH") or "/root/.codex/config.toml").strip()
        )
        self._codex_enable_by_default = (
            (os.getenv("JODA_MCP_CODEX_ENABLE_BY_DEFAULT") or "").strip().lower() in {"1", "true", "yes"}
        )
        self._codex_auto_enable = {
            s.strip()
            for s in (os.getenv("JODA_MCP_CODEX_AUTO_ENABLE") or "").split(",")
            if s.strip()
        }

    async def start(self):
        """Start MCP client and connect to servers"""
        logger.info("Starting MCP client...")
        self._running = True

        # Load server configurations
        await self._load_config()

        # Start enabled servers
        for server_name, server in self.servers.items():
            if server.enabled:
                await self._start_server(server_name, server)

        # Discover available tools from all servers
        await self._discover_tools()

        logger.info(f"MCP client started with {len(self.tools)} tools from {len(self.servers)} servers")

    async def stop(self):
        """Stop MCP client and all server connections"""
        logger.info("Stopping MCP client...")
        self._running = False

        # Stop all server processes
        for server_name, process in self.processes.items():
            try:
                process.terminate()
                process.wait(timeout=5)
                logger.info(f"Stopped MCP server: {server_name}")
            except Exception as e:
                logger.error(f"Error stopping server {server_name}: {e}")
                process.kill()

        self.processes.clear()
        self.tools.clear()

    async def _load_config(self):
        """Load MCP server configurations from JSON file"""
        try:
            config_file = Path(__file__).parent / self.config_path
            if config_file.exists():
                with open(config_file, 'r') as f:
                    config = json.load(f)

                for server_name, server_config in config.get("servers", {}).items():
                    self.servers[server_name] = MCPServer(
                        name=server_name,
                        **server_config
                    )

                logger.info(f"Loaded {len(self.servers)} MCP server configurations")
            else:
                logger.warning(f"MCP config file not found: {config_file}")
                # Create default config
                await self._create_default_config()

            if self._import_codex:
                imported = self._load_codex_mcp_servers()
                for name, server in imported.items():
                    if name in self.servers:
                        continue
                    self.servers[name] = server
                logger.info(f"Imported {len(imported)} MCP servers from Codex config")
        except Exception as e:
            logger.error(f"Error loading MCP config: {e}")

    def _load_codex_mcp_servers(self) -> Dict[str, MCPServer]:
        """
        Load MCP server configurations from Codex's config.toml.

        This allows JODA to reuse MCP servers you've already added via `codex mcp add ...`.

        Controlled by:
        - JODA_MCP_IMPORT_CODEX=1
        - JODA_CODEX_CONFIG_PATH=/root/.codex/config.toml (optional override)
        - JODA_MCP_CODEX_ENABLE_BY_DEFAULT=1 (optional; default is disabled-on-start)
        """
        if tomllib is None:
            logger.warning("tomllib not available; cannot import Codex MCP servers")
            return {}
        if not self._codex_config_path.exists():
            logger.warning(f"Codex config not found: {self._codex_config_path}")
            return {}

        try:
            raw = self._codex_config_path.read_bytes()
            data = tomllib.loads(raw.decode("utf-8"))
        except Exception as e:
            logger.warning(f"Failed reading Codex config ({self._codex_config_path}): {e}")
            return {}

        servers = data.get("mcp_servers") or {}
        if not isinstance(servers, dict):
            return {}

        out: Dict[str, MCPServer] = {}
        for name, cfg in servers.items():
            if not isinstance(cfg, dict):
                continue
            url = cfg.get("url")
            command = cfg.get("command")
            args = cfg.get("args") or []
            env = cfg.get("env")

            enabled = bool(self._codex_enable_by_default or (name in self._codex_auto_enable))

            if isinstance(url, str) and url.strip():
                out[name] = MCPServer(
                    name=name,
                    command=[],
                    transport="http",
                    url=url.strip(),
                    enabled=enabled,
                )
                continue

            if isinstance(command, str) and command.strip():
                cmd_list: List[str] = [command.strip()]
                if isinstance(args, list):
                    cmd_list += [str(a) for a in args]
                out[name] = MCPServer(
                    name=name,
                    command=cmd_list,
                    env={str(k): str(v) for k, v in env.items()} if isinstance(env, dict) else None,
                    transport="stdio",
                    enabled=enabled,
                )
        return out

    async def _create_default_config(self):
        """Create default MCP server configuration"""
        default_config = {
            "servers": {
                "filesystem": {
                    "command": ["npx", "-y", "@modelcontextprotocol/server-filesystem", "/root/Desktop/biz_automate"],
                    "transport": "stdio",
                    "enabled": True
                },
                "brave-search": {
                    "command": ["npx", "-y", "@modelcontextprotocol/server-brave-search"],
                    "env": {
                        "BRAVE_API_KEY": "your_brave_api_key_here"
                    },
                    "transport": "stdio",
                    "enabled": False
                },
                "github": {
                    "command": ["npx", "-y", "@modelcontextprotocol/server-github"],
                    "env": {
                        "GITHUB_PERSONAL_ACCESS_TOKEN": "your_github_token_here"
                    },
                    "transport": "stdio",
                    "enabled": False
                },
                "puppeteer": {
                    "command": ["npx", "-y", "@modelcontextprotocol/server-puppeteer"],
                    "transport": "stdio",
                    "enabled": True
                },
                "postgres": {
                    "command": ["npx", "-y", "@modelcontextprotocol/server-postgres"],
                    "env": {
                        "POSTGRES_CONNECTION_STRING": "postgresql://user:pass@localhost:5432/db"
                    },
                    "transport": "stdio",
                    "enabled": False
                }
            }
        }

        config_file = Path(__file__).parent / self.config_path
        with open(config_file, 'w') as f:
            json.dump(default_config, f, indent=2)

        logger.info(f"Created default MCP config: {config_file}")

    async def _ensure_server_running(self, server_name: str) -> MCPServer:
        server = self.servers.get(server_name)
        if not server:
            raise Exception(f"Server not found: {server_name}")
        if server.transport == "stdio" and server_name not in self.processes:
            await self._start_server(server_name, server)
        return server

    async def _start_server(self, server_name: str, server: MCPServer):
        """Start an MCP server process"""
        try:
            if server.transport == "stdio":
                # Start stdio-based server
                env = {**subprocess.os.environ}
                if server.env:
                    env.update(server.env)

                process = subprocess.Popen(
                    server.command,
                    stdin=subprocess.PIPE,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    env=env,
                    text=True,
                    bufsize=1
                )

                self.processes[server_name] = process
                logger.info(f"Started MCP server: {server_name}")

            elif server.transport == "http":
                # For HTTP servers, just verify connectivity
                if server.url:
                    async with aiohttp.ClientSession() as session:
                        async with session.get(f"{server.url}/health") as resp:
                            if resp.status == 200:
                                logger.info(f"Connected to HTTP MCP server: {server_name}")
                            else:
                                logger.warning(f"HTTP server {server_name} returned {resp.status}")

        except Exception as e:
            logger.error(f"Error starting MCP server {server_name}: {e}")

    async def _discover_tools(self):
        """Discover available tools from all connected servers"""
        # For each server, query available tools
        for server_name, server in self.servers.items():
            if not server.enabled:
                continue

            try:
                tools = await self._query_server_tools(server_name, server)
                for tool in tools:
                    tool_key = f"{server_name}.{tool['name']}"
                    self.tools[tool_key] = MCPTool(
                        name=tool['name'],
                        description=tool.get('description', ''),
                        input_schema=tool.get('inputSchema', {}),
                        server_name=server_name
                    )

                logger.info(f"Discovered {len(tools)} tools from {server_name}")
            except Exception as e:
                logger.error(f"Error discovering tools from {server_name}: {e}")

    async def _query_server_tools(self, server_name: str, server: MCPServer) -> List[Dict]:
        """Query a server for its available tools"""
        tools = []

        try:
            if server.transport == "stdio":
                # Send list_tools request to stdio server
                process = self.processes.get(server_name)
                if process:
                    if process.poll() is not None:
                        logger.warning(f"MCP server exited before tools/list: {server_name}")
                        return []
                    request = {
                        "jsonrpc": "2.0",
                        "id": 1,
                        "method": "tools/list",
                        "params": {}
                    }

                    try:
                        process.stdin.write(json.dumps(request) + "\n")
                        process.stdin.flush()
                    except Exception as e:
                        logger.warning(f"Failed writing tools/list request to {server_name}: {e}")
                        return []

                    # Read response (with timeout). Some servers may print non-JSON lines; skip until JSON-RPC.
                    response = await self._read_jsonrpc_response(process, expected_id=1, timeout_sec=8.0)
                    if response:
                        tools = (response.get("result", {}) or {}).get("tools", []) or []

            elif server.transport == "http":
                # Query HTTP endpoint for tools
                async with aiohttp.ClientSession() as session:
                    async with session.get(f"{server.url}/tools") as resp:
                        if resp.status == 200:
                            data = await resp.json()
                            tools = data.get("tools", [])

        except Exception as e:
            logger.error(f"Error querying tools from {server_name}: {e}")

        return tools

    async def _read_jsonrpc_response(
        self, process: subprocess.Popen, *, expected_id: int, timeout_sec: float
    ) -> Optional[Dict[str, Any]]:
        """
        Read stdout until we parse a JSON-RPC response matching expected_id or we time out.
        Many MCP servers emit logs to stdout; we ignore non-JSON lines.
        """
        deadline = asyncio.get_event_loop().time() + float(timeout_sec)
        while asyncio.get_event_loop().time() < deadline:
            remaining = max(0.05, deadline - asyncio.get_event_loop().time())
            try:
                line = await asyncio.wait_for(asyncio.to_thread(process.stdout.readline), timeout=remaining)
            except asyncio.TimeoutError:
                return None
            if not line:
                return None
            line = line.strip()
            if not line:
                continue
            try:
                msg = json.loads(line)
            except Exception:
                continue
            if isinstance(msg, dict) and msg.get("id") == expected_id:
                return msg
        return None

    async def call_tool(
        self,
        tool_name: str,
        arguments: Dict[str, Any],
        agent_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Call an MCP tool with given arguments

        Args:
            tool_name: Name of the tool (can be "server.tool" or just "tool")
            arguments: Tool arguments
            agent_id: ID of agent making the call (for tracking)

        Returns:
            Tool execution result
        """
        logger.info(f"Agent {agent_id} calling tool: {tool_name}")

        # Fast-path: if fully-qualified "server.tool", allow direct calls even if tools were not discovered.
        if "." in tool_name:
            server_prefix, raw_tool = tool_name.split(".", 1)
            if server_prefix in self.servers and raw_tool:
                try:
                    server = await self._ensure_server_running(server_prefix)
                    result = await self._execute_tool_raw(server, raw_tool, arguments)
                    return {"success": True, "tool": tool_name, "result": result, "agent_id": agent_id}
                except Exception as e:
                    return {"success": False, "error": str(e), "tool": tool_name, "agent_id": agent_id}

        # Find the tool (discovered tools only)
        tool = None
        tool_key = tool_name

        # Check if tool_name includes server prefix
        if tool_name not in self.tools:
            # Try to find by tool name alone
            matching_tools = [k for k in self.tools.keys() if k.endswith(f".{tool_name}")]
            if matching_tools:
                tool_key = matching_tools[0]
                tool = self.tools[tool_key]
            else:
                return {
                    "success": False,
                    "error": f"Tool not found: {tool_name}",
                    "available_tools": list(self.tools.keys())
                }
        else:
            tool = self.tools[tool_key]

        if not tool:
            return {
                "success": False,
                "error": f"Tool not found: {tool_name}"
            }

        # Get the server
        server = self.servers.get(tool.server_name)
        if not server:
            return {
                "success": False,
                "error": f"Server not found: {tool.server_name}"
            }

        # Execute the tool
        try:
            result = await self._execute_tool(server, tool, arguments)

            logger.info(f"Tool {tool_name} executed successfully for agent {agent_id}")

            return {
                "success": True,
                "tool": tool_name,
                "result": result,
                "agent_id": agent_id
            }
        except Exception as e:
            logger.error(f"Error executing tool {tool_name}: {e}")
            return {
                "success": False,
                "error": str(e),
                "tool": tool_name,
                "agent_id": agent_id
            }

    async def _execute_tool_raw(self, server: MCPServer, tool_name: str, arguments: Dict[str, Any]) -> Any:
        """
        Execute a tool call without requiring prior tool discovery.

        Useful when calling tools by fully-qualified name (server.tool).
        """
        if server.transport == "stdio":
            process = self.processes.get(server.name)
            if not process:
                raise Exception(f"Server process not running: {server.name}")
            if process.poll() is not None:
                raise Exception(f"Server process exited: {server.name}")

            request = {
                "jsonrpc": "2.0",
                "id": 2,
                "method": "tools/call",
                "params": {"name": tool_name, "arguments": arguments},
            }

            try:
                process.stdin.write(json.dumps(request) + "\n")
                process.stdin.flush()
            except Exception as e:
                raise Exception(f"Failed writing tools/call request to {server.name}: {e}")

            response = await self._read_jsonrpc_response(process, expected_id=2, timeout_sec=30.0)
            if not response:
                raise Exception("Timeout waiting for tool response")
            if "error" in response:
                raise Exception(response["error"]["message"])
            return response.get("result", {})

        if server.transport == "http":
            if not server.url:
                raise Exception(f"HTTP server missing url: {server.name}")
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    f"{server.url}/tools/call", json={"tool": tool_name, "arguments": arguments}
                ) as resp:
                    if resp.status != 200:
                        text = await resp.text()
                        raise Exception(f"HTTP error {resp.status}: {text}")
                    return await resp.json()

        raise Exception(f"Unsupported transport: {server.transport}")

    async def _execute_tool(
        self,
        server: MCPServer,
        tool: MCPTool,
        arguments: Dict[str, Any]
    ) -> Any:
        """Execute a tool on its server"""

        if server.transport == "stdio":
            process = self.processes.get(server.name)
            if not process:
                raise Exception(f"Server process not running: {server.name}")
            if process.poll() is not None:
                raise Exception(f"Server process exited: {server.name}")

            # Send tool execution request
            request = {
                "jsonrpc": "2.0",
                "id": 2,
                "method": "tools/call",
                "params": {
                    "name": tool.name,
                    "arguments": arguments
                }
            }

            try:
                process.stdin.write(json.dumps(request) + "\n")
                process.stdin.flush()
            except Exception as e:
                raise Exception(f"Failed writing tools/call request to {server.name}: {e}")

            response = await self._read_jsonrpc_response(process, expected_id=2, timeout_sec=30.0)
            if not response:
                raise Exception("Timeout waiting for tool response")

            if "error" in response:
                raise Exception(response["error"]["message"])

            return response.get("result", {})

        elif server.transport == "http":
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    f"{server.url}/tools/call",
                    json={"tool": tool.name, "arguments": arguments}
                ) as resp:
                    if resp.status != 200:
                        text = await resp.text()
                        raise Exception(f"HTTP error {resp.status}: {text}")

                    return await resp.json()

    def list_tools(self) -> List[Dict[str, Any]]:
        """List all available tools"""
        return [
            {
                "name": key,
                "tool_name": tool.name,
                "server": tool.server_name,
                "description": tool.description,
                "input_schema": tool.input_schema
            }
            for key, tool in self.tools.items()
        ]

    def get_tools_for_agent(self, agent_type: str) -> List[str]:
        """Get recommended tools for a specific agent type"""

        # Map agent types to relevant tools
        agent_tool_map = {
            "freqtrade": [
                "filesystem.read_file",
                "filesystem.write_file",
                "filesystem.list_directory",
                "brave-search.search",  # Research trading strategies
                "github.create_issue",  # Report bugs
            ],
            "hummingbot": [
                "filesystem.read_file",
                "filesystem.write_file",
                "brave-search.search",
                "postgres.query",  # Database operations
            ],
            "rl_trading": [
                "filesystem.read_file",
                "filesystem.write_file",
                "filesystem.create_directory",
                "brave-search.search",
                "puppeteer.screenshot",  # Capture charts
            ],
            "arbitrage": [
                "filesystem.read_file",
                "brave-search.search",
                "puppeteer.navigate",  # Monitor DEX interfaces
                "github.get_file",  # Check for updates
            ],
            "data_collector": [
                "filesystem.write_file",
                "filesystem.create_directory",
                "brave-search.search",
                "postgres.execute",
                "puppeteer.screenshot",
            ],
            "monitor": [
                "filesystem.read_file",
                "brave-search.search",
                "puppeteer.navigate",
                "github.create_issue",
            ]
        }

        return agent_tool_map.get(agent_type, [])


# Singleton instance
_mcp_client: Optional[MCPClient] = None


async def get_mcp_client() -> MCPClient:
    """Get or create the global MCP client instance"""
    global _mcp_client

    if _mcp_client is None:
        _mcp_client = MCPClient()
        await _mcp_client.start()

    return _mcp_client


async def shutdown_mcp_client():
    """Shutdown the global MCP client"""
    global _mcp_client

    if _mcp_client:
        await _mcp_client.stop()
        _mcp_client = None

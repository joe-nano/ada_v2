"""
JODA Agent Manager - Central orchestration system for all biz_automate agents

This module manages deployment, monitoring, and feedback collection from agents
running across all projects in the biz_automate ecosystem.

Features:
- MCP (Model Context Protocol) integration for tool calls
- Multi-agent orchestration
- Real-time feedback and reporting
"""

import asyncio
import json
import os
import subprocess
import time
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Any
from enum import Enum
import threading
import queue
import logging

# Import MCP client
from mcp_client import MCPClient, get_mcp_client, shutdown_mcp_client

logger = logging.getLogger(__name__)


class AgentStatus(Enum):
    """Agent status states"""
    IDLE = "idle"
    STARTING = "starting"
    RUNNING = "running"
    PAUSED = "paused"
    ERROR = "error"
    STOPPED = "stopped"


class AgentType(Enum):
    """Types of agents JODA can deploy"""
    FREQTRADE = "freqtrade"
    HUMMINGBOT = "hummingbot"
    RL_TRADING = "rl_trading"
    ARBITRAGE = "arbitrage"
    DATA_COLLECTOR = "data_collector"
    MONITOR = "monitor"
    CUSTOM = "custom"


class Agent:
    """Individual agent instance with MCP tool support"""

    def __init__(self, agent_id: str, agent_type: AgentType, name: str, config: Dict[str, Any], mcp_client: Optional[MCPClient] = None):
        self.agent_id = agent_id
        self.agent_type = agent_type
        self.name = name
        self.config = config
        self.status = AgentStatus.IDLE
        self.process = None
        self.created_at = datetime.now()
        self.started_at = None
        self.stopped_at = None
        self.metrics = {
            "runtime": 0,
            "tasks_completed": 0,
            "errors": 0,
            "last_heartbeat": None,
            "mcp_calls": 0,
            "successful_mcp_calls": 0,
            "failed_mcp_calls": 0
        }
        self.logs = []
        self.feedback_queue = queue.Queue()
        self.mcp_client = mcp_client
        self.available_tools = []

    def to_dict(self) -> Dict[str, Any]:
        """Serialize agent to dictionary"""
        return {
            "agent_id": self.agent_id,
            "type": self.agent_type.value,
            "name": self.name,
            "status": self.status.value,
            "created_at": self.created_at.isoformat(),
            "started_at": self.started_at.isoformat() if self.started_at else None,
            "stopped_at": self.stopped_at.isoformat() if self.stopped_at else None,
            "metrics": self.metrics,
            "config": self.config,
            "recent_logs": self.logs[-10:]  # Last 10 log entries
        }

    def add_log(self, level: str, message: str):
        """Add log entry"""
        log_entry = {
            "timestamp": datetime.now().isoformat(),
            "level": level,
            "message": message
        }
        self.logs.append(log_entry)

        # Keep only last 100 logs in memory
        if len(self.logs) > 100:
            self.logs = self.logs[-100:]

    def send_feedback(self, feedback_type: str, data: Any):
        """Send feedback to JODA"""
        feedback = {
            "agent_id": self.agent_id,
            "type": feedback_type,
            "timestamp": datetime.now().isoformat(),
            "data": data
        }
        self.feedback_queue.put(feedback)

    async def call_tool(self, tool_name: str, arguments: Dict[str, Any]) -> Dict[str, Any]:
        """
        Call an MCP tool and return the result

        Args:
            tool_name: Name of the tool to call
            arguments: Tool arguments

        Returns:
            Tool execution result
        """
        if not self.mcp_client:
            return {
                "success": False,
                "error": "MCP client not initialized"
            }

        self.metrics["mcp_calls"] += 1
        self.add_log("INFO", f"Calling MCP tool: {tool_name}")

        try:
            result = await self.mcp_client.call_tool(
                tool_name=tool_name,
                arguments=arguments,
                agent_id=self.agent_id
            )

            if result.get("success"):
                self.metrics["successful_mcp_calls"] += 1
                self.add_log("INFO", f"Tool {tool_name} executed successfully")

                # Send feedback to JODA
                self.send_feedback("tool_executed", {
                    "tool": tool_name,
                    "arguments": arguments,
                    "result": result.get("result")
                })
            else:
                self.metrics["failed_mcp_calls"] += 1
                self.add_log("ERROR", f"Tool {tool_name} failed: {result.get('error')}")

                self.send_feedback("tool_error", {
                    "tool": tool_name,
                    "error": result.get("error")
                })

            return result

        except Exception as e:
            self.metrics["failed_mcp_calls"] += 1
            self.add_log("ERROR", f"Exception calling tool {tool_name}: {str(e)}")
            return {
                "success": False,
                "error": str(e)
            }

    def get_available_tools(self) -> List[str]:
        """Get list of available MCP tools for this agent"""
        if not self.mcp_client:
            return []

        # Get tools recommended for this agent type
        recommended_tools = self.mcp_client.get_tools_for_agent(self.agent_type.value)

        # Get all available tools
        all_tools = self.mcp_client.list_tools()

        # Filter to only recommended tools
        available = [
            tool["name"] for tool in all_tools
            if any(tool["name"].endswith(rec.split(".")[-1]) for rec in recommended_tools)
        ]

        self.available_tools = available
        return available


class AgentManager:
    """Central agent management system for JODA with MCP support"""

    def __init__(self):
        self.agents: Dict[str, Agent] = {}
        self.feedback_callback = None
        self.base_path = Path("/root/Desktop/biz_automate")
        self._running = False
        self._monitor_thread = None
        self.mcp_client: Optional[MCPClient] = None
        self._event_loop = None

    async def initialize_mcp(self):
        """Initialize MCP client for tool support"""
        try:
            logger.info("Initializing MCP client...")
            self.mcp_client = await get_mcp_client()
            logger.info(f"MCP client initialized with {len(self.mcp_client.tools)} tools")
        except Exception as e:
            logger.error(f"Failed to initialize MCP client: {e}")

    async def shutdown_mcp(self):
        """Shutdown MCP client"""
        if self.mcp_client:
            await shutdown_mcp_client()
            self.mcp_client = None

    def set_feedback_callback(self, callback):
        """Set callback function for agent feedback"""
        self.feedback_callback = callback

    def start_monitoring(self):
        """Start background monitoring of all agents"""
        if self._running:
            return

        self._running = True
        self._monitor_thread = threading.Thread(target=self._monitor_loop, daemon=True)
        self._monitor_thread.start()

    def stop_monitoring(self):
        """Stop background monitoring"""
        self._running = False
        if self._monitor_thread:
            self._monitor_thread.join(timeout=5)

    def _monitor_loop(self):
        """Background loop to monitor agents and collect feedback"""
        while self._running:
            try:
                # Check agent health
                for agent_id, agent in list(self.agents.items()):
                    if agent.status == AgentStatus.RUNNING:
                        # Check if process is still alive
                        if agent.process and agent.process.poll() is not None:
                            agent.status = AgentStatus.STOPPED
                            agent.stopped_at = datetime.now()
                            agent.add_log("WARNING", f"Agent process terminated unexpectedly")

                        # Update runtime
                        if agent.started_at:
                            agent.metrics["runtime"] = (datetime.now() - agent.started_at).total_seconds()

                    # Collect feedback from agent queue
                    while not agent.feedback_queue.empty():
                        try:
                            feedback = agent.feedback_queue.get_nowait()
                            if self.feedback_callback:
                                self.feedback_callback(feedback)
                        except queue.Empty:
                            break

                time.sleep(5)  # Monitor every 5 seconds

            except Exception as e:
                print(f"[AgentManager] Monitor loop error: {e}")
                time.sleep(10)

    # ==================== Agent Deployment ====================

    def deploy_freqtrade_agent(self, name: str, config: Dict[str, Any]) -> str:
        """Deploy a Freqtrade trading agent with MCP tool support"""
        agent_id = f"freqtrade_{int(time.time())}"

        agent_config = {
            "strategy": config.get("strategy", "DefaultStrategy"),
            "pair": config.get("pair", "BTC/USDT"),
            "exchange": config.get("exchange", "binance"),
            "dry_run": config.get("dry_run", True),
            "stake_amount": config.get("stake_amount", 100),
            **config
        }

        agent = Agent(agent_id, AgentType.FREQTRADE, name, agent_config, mcp_client=self.mcp_client)
        self.agents[agent_id] = agent

        agent.add_log("INFO", f"Freqtrade agent '{name}' created with MCP support")

        # Get available tools for this agent
        if self.mcp_client:
            tools = agent.get_available_tools()
            agent.add_log("INFO", f"Available tools: {', '.join(tools)}")

        # Start agent in background
        threading.Thread(target=self._start_freqtrade_agent, args=(agent,), daemon=True).start()

        return agent_id

    def _start_freqtrade_agent(self, agent: Agent):
        """Start Freqtrade agent process"""
        try:
            agent.status = AgentStatus.STARTING
            agent.add_log("INFO", "Starting Freqtrade agent...")

            freqtrade_path = self.base_path / "freqtrade"

            # Build command
            cmd = [
                "freqtrade",
                "trade",
                "--strategy", agent.config["strategy"],
                "--config", str(freqtrade_path / "user_data" / "config.json")
            ]

            if agent.config.get("dry_run", True):
                cmd.append("--dry-run")

            # Start process
            agent.process = subprocess.Popen(
                cmd,
                cwd=str(freqtrade_path),
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True
            )

            agent.status = AgentStatus.RUNNING
            agent.started_at = datetime.now()
            agent.add_log("INFO", f"Agent started with PID {agent.process.pid}")

            # Send feedback
            agent.send_feedback("agent_started", {
                "name": agent.name,
                "strategy": agent.config["strategy"],
                "pair": agent.config["pair"]
            })

            # Monitor output
            self._monitor_agent_output(agent)

        except Exception as e:
            agent.status = AgentStatus.ERROR
            agent.add_log("ERROR", f"Failed to start: {str(e)}")
            agent.send_feedback("agent_error", {"error": str(e)})

    def deploy_hummingbot_agent(self, name: str, config: Dict[str, Any]) -> str:
        """Deploy a Hummingbot trading agent with MCP tool support"""
        agent_id = f"hummingbot_{int(time.time())}"

        agent_config = {
            "strategy": config.get("strategy", "pure_market_making"),
            "exchange": config.get("exchange", "binance"),
            "trading_pair": config.get("trading_pair", "BTC-USDT"),
            **config
        }

        agent = Agent(agent_id, AgentType.HUMMINGBOT, name, agent_config, mcp_client=self.mcp_client)
        self.agents[agent_id] = agent

        agent.add_log("INFO", f"Hummingbot agent '{name}' created with MCP support")

        # Get available tools for this agent
        if self.mcp_client:
            tools = agent.get_available_tools()
            agent.add_log("INFO", f"Available tools: {', '.join(tools)}")

        # Start agent
        threading.Thread(target=self._start_hummingbot_agent, args=(agent,), daemon=True).start()

        return agent_id

    def _start_hummingbot_agent(self, agent: Agent):
        """Start Hummingbot agent process"""
        try:
            agent.status = AgentStatus.STARTING
            agent.add_log("INFO", "Starting Hummingbot agent...")

            hummingbot_path = self.base_path / "hummingbot"

            # Hummingbot typically runs in Docker or via conda
            # This is a simplified example
            cmd = [
                "docker", "run", "-d",
                "--name", f"hummingbot_{agent.agent_id}",
                "-v", f"{hummingbot_path}/conf:/conf",
                "hummingbot/hummingbot:latest"
            ]

            agent.process = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)

            agent.status = AgentStatus.RUNNING
            agent.started_at = datetime.now()
            agent.add_log("INFO", "Hummingbot container started")

            agent.send_feedback("agent_started", {
                "name": agent.name,
                "strategy": agent.config["strategy"]
            })

        except Exception as e:
            agent.status = AgentStatus.ERROR
            agent.add_log("ERROR", f"Failed to start: {str(e)}")

    def deploy_rl_trading_agent(self, name: str, config: Dict[str, Any]) -> str:
        """Deploy an RL trading bot agent with MCP tool support"""
        agent_id = f"rl_trading_{int(time.time())}"

        agent_config = {
            "mode": config.get("mode", "test"),  # train, test, live
            "model_path": config.get("model_path", "models/model.zip"),
            "symbols": config.get("symbols", ["EURUSD=X"]),
            **config
        }

        agent = Agent(agent_id, AgentType.RL_TRADING, name, agent_config, mcp_client=self.mcp_client)
        self.agents[agent_id] = agent

        agent.add_log("INFO", f"RL Trading agent '{name}' created with MCP support")

        # Get available tools for this agent
        if self.mcp_client:
            tools = agent.get_available_tools()
            agent.add_log("INFO", f"Available tools: {', '.join(tools)}")

        threading.Thread(target=self._start_rl_trading_agent, args=(agent,), daemon=True).start()

        return agent_id

    def _start_rl_trading_agent(self, agent: Agent):
        """Start RL Trading agent"""
        try:
            agent.status = AgentStatus.STARTING
            agent.add_log("INFO", "Starting RL Trading agent...")

            rl_path = self.base_path / "reinforcement_learning_trading_bot"

            if agent.config["mode"] == "train":
                cmd = ["python", "train_agent.py"]
            else:
                cmd = ["python", "test_agent.py", "--model", agent.config["model_path"]]

            agent.process = subprocess.Popen(
                cmd,
                cwd=str(rl_path),
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True
            )

            agent.status = AgentStatus.RUNNING
            agent.started_at = datetime.now()
            agent.add_log("INFO", f"RL agent started in {agent.config['mode']} mode")

            agent.send_feedback("agent_started", {
                "name": agent.name,
                "mode": agent.config["mode"],
                "symbols": agent.config["symbols"]
            })

            self._monitor_agent_output(agent)

        except Exception as e:
            agent.status = AgentStatus.ERROR
            agent.add_log("ERROR", f"Failed to start: {str(e)}")

    def deploy_arbitrage_agent(self, name: str, config: Dict[str, Any]) -> str:
        """Deploy a cross-chain arbitrage agent with MCP tool support"""
        agent_id = f"arbitrage_{int(time.time())}"

        agent_config = {
            "mode": config.get("mode", "monitor"),  # monitor, execute
            "chains": config.get("chains", ["ethereum", "arbitrum"]),
            "min_profit": config.get("min_profit", 0.5),
            **config
        }

        agent = Agent(agent_id, AgentType.ARBITRAGE, name, agent_config, mcp_client=self.mcp_client)
        self.agents[agent_id] = agent

        agent.add_log("INFO", f"Arbitrage agent '{name}' created with MCP support")

        # Get available tools for this agent
        if self.mcp_client:
            tools = agent.get_available_tools()
            agent.add_log("INFO", f"Available tools: {', '.join(tools)}")

        threading.Thread(target=self._start_arbitrage_agent, args=(agent,), daemon=True).start()

        return agent_id

    def _start_arbitrage_agent(self, agent: Agent):
        """Start arbitrage monitoring agent"""
        try:
            agent.status = AgentStatus.STARTING
            agent.add_log("INFO", "Starting Arbitrage agent...")

            arb_path = self.base_path / "multiple_bizstreams_and_automations"

            cmd = ["npm", "run", "monitor"] if agent.config["mode"] == "monitor" else ["npm", "run", "execute"]

            agent.process = subprocess.Popen(
                cmd,
                cwd=str(arb_path),
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True
            )

            agent.status = AgentStatus.RUNNING
            agent.started_at = datetime.now()
            agent.add_log("INFO", f"Arbitrage agent monitoring {agent.config['chains']}")

            agent.send_feedback("agent_started", {
                "name": agent.name,
                "chains": agent.config["chains"],
                "min_profit": agent.config["min_profit"]
            })

            self._monitor_agent_output(agent)

        except Exception as e:
            agent.status = AgentStatus.ERROR
            agent.add_log("ERROR", f"Failed to start: {str(e)}")

    def deploy_data_collector_agent(self, name: str, config: Dict[str, Any]) -> str:
        """Deploy a data collection agent with MCP tool support"""
        agent_id = f"datacollector_{int(time.time())}"

        agent_config = {
            "sources": config.get("sources", ["yfinance"]),
            "symbols": config.get("symbols", ["BTC-USD"]),
            "interval": config.get("interval", "1h"),
            **config
        }

        agent = Agent(agent_id, AgentType.DATA_COLLECTOR, name, agent_config, mcp_client=self.mcp_client)
        self.agents[agent_id] = agent

        agent.add_log("INFO", f"Data Collector agent '{name}' created with MCP support")

        # Get available tools for this agent
        if self.mcp_client:
            tools = agent.get_available_tools()
            agent.add_log("INFO", f"Available tools: {', '.join(tools)}")

        # Start background collection
        threading.Thread(target=self._start_data_collector_agent, args=(agent,), daemon=True).start()

        return agent_id

    def _start_data_collector_agent(self, agent: Agent):
        """Start data collection agent"""
        try:
            agent.status = AgentStatus.RUNNING
            agent.started_at = datetime.now()
            agent.add_log("INFO", "Data collector started")

            agent.send_feedback("agent_started", {
                "name": agent.name,
                "sources": agent.config["sources"],
                "symbols": agent.config["symbols"]
            })

            # Simulated data collection loop
            while agent.status == AgentStatus.RUNNING and self._running:
                try:
                    # Collect data (simplified)
                    agent.metrics["tasks_completed"] += 1
                    agent.metrics["last_heartbeat"] = datetime.now().isoformat()

                    agent.send_feedback("data_collected", {
                        "symbols": agent.config["symbols"],
                        "count": agent.metrics["tasks_completed"]
                    })

                    # Wait based on interval
                    time.sleep(300)  # 5 minutes

                except Exception as e:
                    agent.add_log("ERROR", f"Collection error: {str(e)}")
                    agent.metrics["errors"] += 1

        except Exception as e:
            agent.status = AgentStatus.ERROR
            agent.add_log("ERROR", f"Failed to start: {str(e)}")

    def _monitor_agent_output(self, agent: Agent):
        """Monitor agent process output"""
        if not agent.process:
            return

        def read_output():
            try:
                for line in agent.process.stdout:
                    agent.add_log("INFO", line.strip())

                    # Parse for specific events
                    if "error" in line.lower():
                        agent.metrics["errors"] += 1
                        agent.send_feedback("error", {"message": line.strip()})
                    elif "trade" in line.lower() or "order" in line.lower():
                        agent.send_feedback("trade_event", {"message": line.strip()})

            except Exception as e:
                agent.add_log("ERROR", f"Output monitor error: {str(e)}")

        threading.Thread(target=read_output, daemon=True).start()

    # ==================== Agent Control ====================

    def stop_agent(self, agent_id: str) -> bool:
        """Stop a running agent"""
        agent = self.agents.get(agent_id)
        if not agent:
            return False

        try:
            if agent.process:
                agent.process.terminate()
                agent.process.wait(timeout=10)

            agent.status = AgentStatus.STOPPED
            agent.stopped_at = datetime.now()
            agent.add_log("INFO", "Agent stopped by user")

            agent.send_feedback("agent_stopped", {
                "name": agent.name,
                "runtime": agent.metrics["runtime"]
            })

            return True

        except Exception as e:
            agent.add_log("ERROR", f"Stop error: {str(e)}")
            return False

    def pause_agent(self, agent_id: str) -> bool:
        """Pause an agent"""
        agent = self.agents.get(agent_id)
        if not agent or agent.status != AgentStatus.RUNNING:
            return False

        agent.status = AgentStatus.PAUSED
        agent.add_log("INFO", "Agent paused")
        return True

    def resume_agent(self, agent_id: str) -> bool:
        """Resume a paused agent"""
        agent = self.agents.get(agent_id)
        if not agent or agent.status != AgentStatus.PAUSED:
            return False

        agent.status = AgentStatus.RUNNING
        agent.add_log("INFO", "Agent resumed")
        return True

    def restart_agent(self, agent_id: str) -> bool:
        """Restart an agent"""
        agent = self.agents.get(agent_id)
        if not agent:
            return False

        self.stop_agent(agent_id)
        time.sleep(2)

        # Re-deploy based on type
        config = agent.config
        name = agent.name

        if agent.agent_type == AgentType.FREQTRADE:
            self.deploy_freqtrade_agent(name, config)
        elif agent.agent_type == AgentType.HUMMINGBOT:
            self.deploy_hummingbot_agent(name, config)
        elif agent.agent_type == AgentType.RL_TRADING:
            self.deploy_rl_trading_agent(name, config)
        elif agent.agent_type == AgentType.ARBITRAGE:
            self.deploy_arbitrage_agent(name, config)

        return True

    # ==================== Information Retrieval ====================

    def get_agent(self, agent_id: str) -> Optional[Dict[str, Any]]:
        """Get agent details"""
        agent = self.agents.get(agent_id)
        return agent.to_dict() if agent else None

    def list_agents(self, status_filter: Optional[str] = None) -> List[Dict[str, Any]]:
        """List all agents"""
        agents = []
        for agent in self.agents.values():
            if status_filter is None or agent.status.value == status_filter:
                agents.append(agent.to_dict())
        return agents

    def get_agent_stats(self) -> Dict[str, Any]:
        """Get overall agent statistics"""
        total = len(self.agents)
        running = sum(1 for a in self.agents.values() if a.status == AgentStatus.RUNNING)
        stopped = sum(1 for a in self.agents.values() if a.status == AgentStatus.STOPPED)
        errors = sum(1 for a in self.agents.values() if a.status == AgentStatus.ERROR)

        return {
            "total_agents": total,
            "running": running,
            "stopped": stopped,
            "errors": errors,
            "by_type": {
                agent_type.value: sum(1 for a in self.agents.values() if a.agent_type == agent_type)
                for agent_type in AgentType
            }
        }

    def get_consolidated_report(self) -> Dict[str, Any]:
        """Generate consolidated report from all agents"""
        return {
            "timestamp": datetime.now().isoformat(),
            "stats": self.get_agent_stats(),
            "agents": self.list_agents(status_filter="running"),
            "total_runtime": sum(a.metrics["runtime"] for a in self.agents.values()),
            "total_tasks": sum(a.metrics["tasks_completed"] for a in self.agents.values()),
            "total_errors": sum(a.metrics["errors"] for a in self.agents.values())
        }


# Global instance
_agent_manager = None

def get_agent_manager() -> AgentManager:
    """Get or create global AgentManager instance"""
    global _agent_manager
    if _agent_manager is None:
        _agent_manager = AgentManager()
        _agent_manager.start_monitoring()
    return _agent_manager

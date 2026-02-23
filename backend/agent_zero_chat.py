"""
Agent Zero Chat Interface
Enables J.O.D.A to communicate with Agent Zero via HTTP/WebSocket
"""

import aiohttp
import asyncio
import json
from typing import Optional, Dict, Any
import logging

logger = logging.getLogger(__name__)


class AgentZeroChat:
    """
    Interface for communicating with Agent Zero's chat functionality.

    Agent Zero runs in a Docker container and exposes a web interface with chat.
    This class provides methods to send instructions and receive responses.
    """

    def __init__(self, host: str = "localhost", port: int = 50001):
        self.host = host
        self.port = port
        self.base_url = f"http://{host}:{port}"
        self.session: Optional[aiohttp.ClientSession] = None

    async def initialize(self):
        """Initialize HTTP session"""
        if not self.session:
            self.session = aiohttp.ClientSession()

    async def close(self):
        """Close HTTP session"""
        if self.session:
            await self.session.close()
            self.session = None

    async def health_check(self) -> bool:
        """Check if Agent Zero is accessible"""
        try:
            await self.initialize()
            async with self.session.get(f"{self.base_url}/", timeout=5) as resp:
                return resp.status == 200
        except Exception as e:
            logger.error(f"Agent Zero health check failed: {e}")
            return False

    async def send_message_http(self, message: str) -> Dict[str, Any]:
        """
        Send a message to Agent Zero via HTTP POST.

        Agent Zero typically uses Socket.IO or WebSocket for real-time chat.
        This method attempts common HTTP endpoints.

        Args:
            message: The instruction/message to send to Agent Zero

        Returns:
            Response from Agent Zero
        """
        await self.initialize()

        # Try different potential endpoints (based on Agent Zero's actual API)
        endpoints = [
            ("/message_async", {"text": message}),  # Agent Zero's actual endpoint
            ("/api/message", {"text": message}),
            ("/chat", {"text": message}),
            ("/msg", {"text": message}),
        ]

        for endpoint, payload in endpoints:
            try:
                async with self.session.post(
                    f"{self.base_url}{endpoint}",
                    json=payload,
                    timeout=30
                ) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        logger.info(f"Successfully sent message to Agent Zero via {endpoint}")
                        return {
                            "success": True,
                            "endpoint": endpoint,
                            "response": data
                        }
                    elif resp.status != 404:  # Not Not Found - might be wrong method/data
                        logger.warning(f"Endpoint {endpoint} returned {resp.status}")
            except aiohttp.ClientError as e:
                logger.debug(f"Endpoint {endpoint} failed: {e}")
                continue

        return {
            "success": False,
            "error": "No working HTTP endpoint found. Agent Zero likely uses WebSocket."
        }

    async def send_message_websocket(self, message: str) -> Dict[str, Any]:
        """
        Send a message to Agent Zero via WebSocket.

        This is the preferred method for Agent Zero communication.

        Args:
            message: The instruction to send

        Returns:
            Response from Agent Zero
        """
        try:
            # Try Socket.IO style WebSocket
            ws_url = f"ws://{self.host}:{self.port}/socket.io/"

            async with aiohttp.ClientSession() as session:
                async with session.ws_connect(ws_url) as ws:
                    # Send message
                    await ws.send_json({
                        "event": "message",
                        "data": {
                            "text": message,
                            "type": "user"
                        }
                    })

                    # Wait for response (with timeout)
                    try:
                        response = await asyncio.wait_for(ws.receive(), timeout=30)
                        if response.type == aiohttp.WSMsgType.TEXT:
                            data = json.loads(response.data)
                            return {
                                "success": True,
                                "response": data
                            }
                    except asyncio.TimeoutError:
                        return {
                            "success": False,
                            "error": "Response timeout"
                        }

        except Exception as e:
            logger.error(f"WebSocket communication failed: {e}")
            return {
                "success": False,
                "error": str(e)
            }

    async def send_instruction(self, instruction: str) -> Dict[str, Any]:
        """
        Send an instruction to Agent Zero and wait for response.

        This is the main method J.O.D.A should use to communicate with Agent Zero.
        Tries both HTTP and WebSocket methods.

        Args:
            instruction: Natural language instruction for Agent Zero

        Returns:
            Response from Agent Zero with execution results
        """
        logger.info(f"Sending instruction to Agent Zero: {instruction}")

        # First check if Agent Zero is running
        if not await self.health_check():
            return {
                "success": False,
                "error": "Agent Zero is not accessible. Make sure the container is running."
            }

        # Try WebSocket first (preferred)
        result = await self.send_message_websocket(instruction)
        if result.get("success"):
            return result

        # Fallback to HTTP
        result = await self.send_message_http(instruction)
        if result.get("success"):
            return result

        # If both failed, we need to use Docker exec to interact with Agent Zero directly
        return await self.send_via_docker_exec(instruction)

    async def send_via_docker_exec(self, instruction: str) -> Dict[str, Any]:
        """
        Send instruction by executing commands directly in the Docker container.

        This is a fallback method when HTTP/WebSocket APIs are not accessible.
        We can interact with Agent Zero's Python API directly.

        Args:
            instruction: The instruction to execute

        Returns:
            Execution result
        """
        try:
            import subprocess

            # Get container name from port
            cmd = f"""docker exec joda-agent-zero-{self.port} python3 -c "
import sys
sys.path.insert(0, '/app')
from python.helpers.api import ApiHandler
api = ApiHandler()
result = api.handle_message(text='{instruction}', context_id='joda-instruction')
print(result)
"
"""

            process = await asyncio.create_subprocess_shell(
                cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )

            stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=60)

            if process.returncode == 0:
                return {
                    "success": True,
                    "response": stdout.decode().strip(),
                    "method": "docker_exec"
                }
            else:
                return {
                    "success": False,
                    "error": stderr.decode().strip(),
                    "method": "docker_exec"
                }

        except Exception as e:
            logger.error(f"Docker exec failed: {e}")
            return {
                "success": False,
                "error": f"Docker exec failed: {str(e)}"
            }

    async def get_agent_status(self) -> Dict[str, Any]:
        """
        Get current status of Agent Zero.

        Returns:
            Status information including running tasks, memory, etc.
        """
        await self.initialize()

        try:
            async with self.session.get(
                f"{self.base_url}/api/status",
                timeout=5
            ) as resp:
                if resp.status == 200:
                    return await resp.json()

        except Exception as e:
            logger.debug(f"Status check failed: {e}")

        # Fallback: return basic container status
        return {
            "accessible": await self.health_check(),
            "port": self.port,
            "url": self.base_url
        }


# Global instance for easy access
_agent_zero_chat: Optional[AgentZeroChat] = None


def get_agent_zero_chat(port: int = 50001) -> AgentZeroChat:
    """Get or create Agent Zero chat interface"""
    global _agent_zero_chat
    if _agent_zero_chat is None or _agent_zero_chat.port != port:
        _agent_zero_chat = AgentZeroChat(port=port)
    return _agent_zero_chat


async def send_to_agent_zero(instruction: str, port: int = 50001) -> Dict[str, Any]:
    """
    Convenience function to send an instruction to Agent Zero.

    Usage:
        result = await send_to_agent_zero("Analyze the Bitcoin price trends")
        if result['success']:
            print(result['response'])
    """
    chat = get_agent_zero_chat(port)
    return await chat.send_instruction(instruction)

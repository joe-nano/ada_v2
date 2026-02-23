"""
Agent Zero API Endpoints for J.O.D.A
These endpoints allow J.O.D.A to communicate with Agent Zero
"""

from fastapi import HTTPException
import sys
import os
# Add backend directory to path if not already there
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from agent_zero_chat import get_agent_zero_chat, send_to_agent_zero
from agent_zero_manager import AgentZeroManager
import logging

logger = logging.getLogger(__name__)


def register_agent_zero_endpoints(app, sio):
    """Register Agent Zero endpoints with FastAPI app and Socket.IO"""

    # Initialize Agent Zero manager
    az_manager = AgentZeroManager()

    @app.get("/api/agent-zero/status")
    async def agent_zero_status():
        """Get status of all Agent Zero instances"""
        try:
            running = az_manager.list_running()
            return {
                "success": True,
                "instances": running,
                "count": len(running)
            }
        except Exception as e:
            logger.error(f"Failed to get Agent Zero status: {e}")
            raise HTTPException(status_code=500, detail=str(e))

    @app.post("/api/agent-zero/start")
    async def agent_zero_start(port: int = None):
        """Start a new Agent Zero instance"""
        try:
            instance = az_manager.start(host_port=port)
            return {
                "success": True,
                "instance": {
                    "name": instance.name,
                    "port": instance.host_port,
                    "url": f"http://localhost:{instance.host_port}"
                }
            }
        except Exception as e:
            logger.error(f"Failed to start Agent Zero: {e}")
            raise HTTPException(status_code=500, detail=str(e))

    @app.post("/api/agent-zero/stop")
    async def agent_zero_stop(name: str):
        """Stop an Agent Zero instance"""
        try:
            success = az_manager.stop(name=name)
            return {
                "success": success,
                "message": f"Agent Zero instance '{name}' stopped" if success else "Failed to stop instance"
            }
        except Exception as e:
            logger.error(f"Failed to stop Agent Zero: {e}")
            raise HTTPException(status_code=500, detail=str(e))

    @app.post("/api/agent-zero/message")
    async def agent_zero_message(data: dict):
        """
        Send a message/instruction to Agent Zero.

        This is the main endpoint J.O.D.A uses to communicate with Agent Zero.

        Args:
            instruction: Natural language instruction for Agent Zero
            port: Port of the Agent Zero instance (default: 50001)

        Returns:
            Response from Agent Zero
        """
        try:
            instruction = data.get("instruction")
            port = data.get("port", 50001)

            if not instruction:
                raise HTTPException(status_code=400, detail="instruction is required")

            logger.info(f"J.O.D.A sending instruction to Agent Zero on port {port}: {instruction}")

            # Send instruction to Agent Zero
            result = await send_to_agent_zero(instruction, port=port)

            if result.get("success"):
                logger.info(f"Agent Zero responded successfully")
                return {
                    "success": True,
                    "response": result.get("response"),
                    "method": result.get("method", "unknown")
                }
            else:
                logger.warning(f"Agent Zero communication failed: {result.get('error')}")
                return {
                    "success": False,
                    "error": result.get("error"),
                    "suggestion": "Make sure Agent Zero container is running and accessible"
                }

        except Exception as e:
            logger.error(f"Failed to send message to Agent Zero: {e}")
            raise HTTPException(status_code=500, detail=str(e))

    # Socket.IO event for Agent Zero communication
    @sio.on("agent_zero_instruction")
    async def agent_zero_instruction(sid, data):
        """
        Socket.IO handler for sending instructions to Agent Zero.

        Frontend can use this to send instructions from J.O.D.A's chat interface.

        Data format:
        {
            "instruction": "your instruction here",
            "port": 50001  # optional
        }
        """
        try:
            instruction = data.get("instruction")
            port = data.get("port", 50001)

            if not instruction:
                await sio.emit("agent_zero_error", {
                    "error": "No instruction provided"
                }, to=sid)
                return

            # Show J.O.D.A is processing
            await sio.emit("status", {
                "msg": f"Sending to Agent Zero: {instruction}"
            }, to=sid)

            # Send to Agent Zero
            result = await send_to_agent_zero(instruction, port=port)

            if result.get("success"):
                # Send response back to frontend
                await sio.emit("agent_zero_response", {
                    "instruction": instruction,
                    "response": result.get("response"),
                    "port": port,
                    "timestamp": None  # TODO: Add timestamp
                }, to=sid)

                await sio.emit("status", {
                    "msg": f"Agent Zero responded successfully"
                }, to=sid)
            else:
                await sio.emit("agent_zero_error", {
                    "instruction": instruction,
                    "error": result.get("error"),
                    "suggestion": result.get("suggestion")
                }, to=sid)

                await sio.emit("status", {
                    "msg": f"Agent Zero communication failed: {result.get('error')}"
                }, to=sid)

        except Exception as e:
            logger.error(f"Agent Zero instruction handler error: {e}")
            await sio.emit("agent_zero_error", {
                "error": str(e)
            }, to=sid)

    logger.info("Agent Zero endpoints registered")

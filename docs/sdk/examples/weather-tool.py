"""
Example: Adding a custom "weather" tool to JODA.

This shows how to define a Gemini function-calling tool and handle it
in the JODA backend. Copy the relevant pieces into your codebase.
"""

# ── Step 1: Tool definition (add to backend/tools.py) ──────────────

get_weather_tool = {
    "name": "get_weather",
    "description": (
        "Get the current weather for a city. "
        "Use this when the user asks about weather, temperature, or conditions."
    ),
    "parameters": {
        "type": "OBJECT",
        "properties": {
            "city": {
                "type": "STRING",
                "description": "City name, e.g. 'San Francisco'",
            },
            "units": {
                "type": "STRING",
                "description": "Temperature units: 'celsius' or 'fahrenheit'",
            },
        },
        "required": ["city"],
    },
}

# Then add `get_weather_tool` to the `tools_list` array in tools.py.


# ── Step 2: Tool handler (add to backend/server.py) ────────────────

import aiohttp  # pip install aiohttp


async def handle_get_weather(args: dict) -> dict:
    """Fetch weather from a free API and return structured data."""
    city = args.get("city", "London")
    units = args.get("units", "celsius")

    # Using wttr.in as a free, no-key weather API
    url = f"https://wttr.in/{city}?format=j1"

    async with aiohttp.ClientSession() as session:
        async with session.get(url) as resp:
            if resp.status != 200:
                return {"error": f"Could not fetch weather for {city}"}
            data = await resp.json()

    current = data.get("current_condition", [{}])[0]
    temp_key = "temp_C" if units == "celsius" else "temp_F"

    return {
        "city": city,
        "temperature": current.get(temp_key, "?"),
        "units": units,
        "description": current.get("weatherDesc", [{}])[0].get("value", "Unknown"),
        "humidity": current.get("humidity", "?"),
        "wind_mph": current.get("windspeedMiles", "?"),
    }


# ── Step 3: Register the handler ───────────────────────────────────
#
# In the tool execution section of server.py, add:
#
#   if tool_name == "get_weather":
#       result = await handle_get_weather(tool_args)
#       return result
#
# The AI will automatically use this tool when users ask about weather
# and will speak the result back conversationally.

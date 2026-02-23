"""
Judge0 Client - Sandboxed code execution integration for JODA
Supports 90+ programming languages with safe, isolated execution
"""

import httpx
import asyncio
from typing import Optional, Dict
import logging

logger = logging.getLogger(__name__)

# Language IDs for Judge0
# Full list: https://ce.judge0.com/languages
LANGUAGE_MAP = {
    # Popular languages
    "python": 71,  # Python 3.8.1
    "javascript": 63,  # JavaScript (Node.js 12.14.0)
    "typescript": 74,  # TypeScript 3.7.4
    "java": 62,  # Java (OpenJDK 13.0.1)
    "cpp": 54,  # C++ (GCC 9.2.0)
    "c": 50,  # C (GCC 9.2.0)
    "csharp": 51,  # C# (Mono 6.6.0.161)
    "go": 60,  # Go (1.13.5)
    "rust": 73,  # Rust (1.40.0)
    "ruby": 72,  # Ruby (2.7.0)
    "php": 68,  # PHP (7.4.1)
    "swift": 83,  # Swift (5.2.3)
    "kotlin": 78,  # Kotlin (1.3.70)
    "scala": 81,  # Scala (2.13.2)
    "r": 80,  # R (4.0.0)
    "perl": 85,  # Perl (5.28.1)
    "bash": 46,  # Bash (5.0.0)
    "sql": 82,  # SQL (SQLite 3.27.2)
    # Esoteric
    "assembly": 45,  # Assembly (NASM 2.14.02)
    "fortran": 59,  # Fortran (GFortran 9.2.0)
    "haskell": 61,  # Haskell (GHC 8.8.1)
    "lisp": 55,  # Common Lisp (SBCL 2.0.0)
    "lua": 64,  # Lua (5.3.5)
    "erlang": 58,  # Erlang (OTP 22.2)
    "elixir": 57,  # Elixir (1.9.4)
}


class Judge0Client:
    """
    Client for Judge0 code execution API
    """

    def __init__(self, base_url: str = "http://localhost:2358"):
        self.base_url = base_url
        self.timeout = httpx.Timeout(30.0, connect=5.0)

    async def execute_code(
        self,
        source_code: str,
        language: str = "python",
        stdin: str = "",
        expected_output: Optional[str] = None,
        cpu_time_limit: float = 2.0,
        memory_limit: int = 128000,  # KB
    ) -> Dict:
        """
        Execute code in a sandboxed environment

        Args:
            source_code: The code to execute
            language: Programming language (e.g., "python", "javascript")
            stdin: Standard input for the program
            expected_output: Expected output for testing (optional)
            cpu_time_limit: Max CPU time in seconds (default 2.0)
            memory_limit: Max memory in KB (default 128MB)

        Returns:
            Dictionary with execution results
        """
        # Get language ID
        language_id = LANGUAGE_MAP.get(language.lower())
        if language_id is None:
            return {
                "success": False,
                "error": f"Unsupported language: {language}. Supported: {', '.join(LANGUAGE_MAP.keys())}",
            }

        try:
            logger.info(f"[JUDGE0] Executing {language} code...")

            # Prepare submission
            submission = {
                "language_id": language_id,
                "source_code": source_code,
                "stdin": stdin,
                "cpu_time_limit": cpu_time_limit,
                "memory_limit": memory_limit,
            }

            if expected_output:
                submission["expected_output"] = expected_output

            # Submit for execution
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.post(
                    f"{self.base_url}/submissions?wait=true",
                    json=submission,
                )
                response.raise_for_status()
                result = response.json()

            # Parse result
            return self._parse_result(result, language)

        except httpx.HTTPError as e:
            logger.error(f"[JUDGE0] HTTP error: {e}")
            return {
                "success": False,
                "error": f"Judge0 connection error: {str(e)}. Is Judge0 running on {self.base_url}?",
            }
        except Exception as e:
            logger.error(f"[JUDGE0] Execution error: {e}")
            return {
                "success": False,
                "error": str(e),
            }

    def _parse_result(self, result: Dict, language: str) -> Dict:
        """Parse Judge0 API response into user-friendly format"""
        status_id = result.get("status", {}).get("id")
        status_desc = result.get("status", {}).get("description", "Unknown")

        # Status codes:
        # 3 = Accepted (success)
        # 4 = Wrong Answer
        # 5 = Time Limit Exceeded
        # 6 = Compilation Error
        # 7+ = Runtime errors

        if status_id == 3:
            # Successful execution
            return {
                "success": True,
                "language": language,
                "status": "Accepted",
                "stdout": result.get("stdout", ""),
                "stderr": result.get("stderr", ""),
                "time": result.get("time", ""),
                "memory": result.get("memory", ""),
            }
        elif status_id == 6:
            # Compilation error
            return {
                "success": False,
                "language": language,
                "status": "Compilation Error",
                "error": result.get("compile_output", ""),
                "stderr": result.get("stderr", ""),
            }
        else:
            # Runtime error or other issue
            return {
                "success": False,
                "language": language,
                "status": status_desc,
                "stdout": result.get("stdout", ""),
                "stderr": result.get("stderr", ""),
                "error": result.get("message", ""),
            }

    async def get_languages(self) -> Dict:
        """Get list of supported languages from Judge0"""
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.get(f"{self.base_url}/languages")
                response.raise_for_status()
                languages = response.json()

            return {
                "success": True,
                "languages": languages,
                "count": len(languages),
            }
        except Exception as e:
            logger.error(f"[JUDGE0] Failed to get languages: {e}")
            return {
                "success": False,
                "error": str(e),
            }

    async def health_check(self) -> bool:
        """Check if Judge0 is running and healthy"""
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(5.0)) as client:
                response = await client.get(f"{self.base_url}/about")
                return response.status_code == 200
        except:
            return False


# Global instance
_judge0_client = None


def get_judge0_client() -> Judge0Client:
    """Get or create global Judge0 client instance"""
    global _judge0_client
    if _judge0_client is None:
        _judge0_client = Judge0Client()
    return _judge0_client


# Tool function for JODA's tool system
async def execute_code(
    source_code: str,
    language: str = "python",
    stdin: str = "",
    expected_output: Optional[str] = None,
) -> Dict:
    """
    Execute code in a sandboxed environment using Judge0

    Args:
        source_code: The code to execute
        language: Programming language (python, javascript, java, cpp, go, etc.)
        stdin: Standard input for the program (optional)
        expected_output: Expected output for unit testing (optional)

    Returns:
        Dictionary with execution results including stdout, stderr, and status
    """
    client = get_judge0_client()

    # Check if Judge0 is running
    if not await client.health_check():
        return {
            "success": False,
            "error": "Judge0 is not running. Please start it with: cd external_tools/judge0 && docker-compose up -d",
        }

    return await client.execute_code(source_code, language, stdin, expected_output)


# Tool function for listing available languages
async def list_programming_languages() -> Dict:
    """
    Get list of all programming languages supported by Judge0

    Returns:
        Dictionary with list of supported languages
    """
    client = get_judge0_client()
    return await client.get_languages()


if __name__ == "__main__":
    # Test script
    async def test():
        client = Judge0Client()

        # Test 1: Python Hello World
        print("\n=== Test 1: Python Hello World ===")
        result = await execute_code(
            source_code='print("Hello from JODA!")',
            language="python",
        )
        print(result)

        # Test 2: JavaScript with input
        print("\n=== Test 2: JavaScript with input ===")
        result = await execute_code(
            source_code="""
const readline = require('readline');
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

rl.question('', (answer) => {
    console.log(`Hello, ${answer}!`);
    rl.close();
});
            """,
            language="javascript",
            stdin="JODA",
        )
        print(result)

        # Test 3: C++ compilation
        print("\n=== Test 3: C++ compilation ===")
        result = await execute_code(
            source_code="""
#include <iostream>
using namespace std;

int main() {
    cout << "C++ from Judge0!" << endl;
    return 0;
}
            """,
            language="cpp",
        )
        print(result)

        # Test 4: Python with error
        print("\n=== Test 4: Python runtime error ===")
        result = await execute_code(
            source_code='print(1/0)',
            language="python",
        )
        print(result)

        # Test 5: List languages
        print("\n=== Test 5: List all languages ===")
        result = await list_programming_languages()
        if result["success"]:
            print(f"Total languages: {result['count']}")
            print("Sample:", result["languages"][:3])

    asyncio.run(test())

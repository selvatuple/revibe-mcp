"""
Revibe MCP Server
Exposes Revibe codebase analysis as MCP tools for Claude Desktop, Cursor, Windsurf, etc.
"""

import asyncio
import json
import os
import subprocess
import sys
import webbrowser
from pathlib import Path

import httpx
from mcp.server.fastmcp import FastMCP

API_BASE = "https://app-backend.revibe.codes/api/v1"
CREDENTIALS_PATH = Path.home() / ".config" / "revibe" / "credentials.json"

mcp = FastMCP(
    "Revibe",
    instructions="Analyze any codebase — get architecture, patterns, file roles, system design Q&A, and agent context. Start with analyze_repo, then use get_summary or get_agent_context once complete. If not authenticated, use revibe_login first.",
)


def _load_saved_key() -> str | None:
    """Load API key from saved credentials file."""
    if CREDENTIALS_PATH.exists():
        try:
            data = json.loads(CREDENTIALS_PATH.read_text())
            return data.get("api_key")
        except Exception:
            return None
    return None


def _save_credentials(api_key: str, email: str):
    """Save API key to credentials file."""
    CREDENTIALS_PATH.parent.mkdir(parents=True, exist_ok=True)
    CREDENTIALS_PATH.write_text(json.dumps({
        "api_key": api_key,
        "email": email,
    }, indent=2))
    # Restrict permissions to owner only
    CREDENTIALS_PATH.chmod(0o600)


def _get_api_key() -> str:
    # 1. Environment variable (highest priority — for MCP config)
    key = os.environ.get("REVIBE_API_KEY", "")
    if key:
        return key
    # 2. Saved credentials (from revibe_login)
    key = _load_saved_key()
    if key:
        return key
    raise ValueError(
        "Not authenticated. Use the revibe_login tool to log in, "
        "or set REVIBE_API_KEY in your MCP config."
    )


def _headers() -> dict:
    return {
        "X-Revibe-Key": _get_api_key(),
        "Content-Type": "application/json",
    }


def _detect_github_url() -> str | None:
    """Try to detect the GitHub URL from the current git repo."""
    try:
        result = subprocess.run(
            ["git", "remote", "get-url", "origin"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        if result.returncode != 0:
            return None
        url = result.stdout.strip()
        if url.startswith("git@github.com:"):
            url = url.replace("git@github.com:", "https://github.com/")
        if url.endswith(".git"):
            url = url[:-4]
        if "github.com" in url:
            return url
        return None
    except Exception:
        return None


@mcp.tool()
async def revibe_login() -> str:
    """Log in to Revibe via browser. Opens a browser window for authentication.

    After logging in and clicking "Authorize", the API key is saved locally
    so all other Revibe tools work automatically. No manual key setup needed.
    """
    # Start the auth flow
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(f"{API_BASE}/cli-auth/start")

    if resp.status_code != 200:
        return f"Failed to start auth flow: {resp.text}"

    data = resp.json()
    device_code = data["device_code"]
    auth_url = data["auth_url"]

    # Open browser
    webbrowser.open(auth_url)

    result = (
        f"Opening browser for login...\n"
        f"If it doesn't open automatically, go to:\n{auth_url}\n\n"
        f"Waiting for authorization..."
    )

    # Poll for completion (up to 5 minutes)
    async with httpx.AsyncClient(timeout=15) as client:
        for _ in range(60):  # 60 * 5s = 5 minutes
            await asyncio.sleep(5)
            poll_resp = await client.get(
                f"{API_BASE}/cli-auth/poll",
                params={"code": device_code},
            )
            if poll_resp.status_code != 200:
                continue

            poll_data = poll_resp.json()
            status = poll_data.get("status")

            if status == "completed":
                api_key = poll_data["api_key"]
                email = poll_data.get("email", "")
                _save_credentials(api_key, email)
                return (
                    f"Logged in as {email}\n"
                    f"API key saved to {CREDENTIALS_PATH}\n\n"
                    f"You're all set! Try analyze_repo() to analyze a codebase."
                )
            elif status == "expired":
                return "Authorization expired. Please try revibe_login() again."

    return "Authorization timed out after 5 minutes. Please try revibe_login() again."


@mcp.tool()
async def analyze_repo(
    github_url: str = "",
    reanalyze: bool = False,
) -> str:
    """Submit a GitHub repository for Revibe analysis.

    Analyzes architecture, file roles, execution flows, system design Q&A, and more.
    If no URL is provided, auto-detects from the current git remote.
    Returns a job_id for tracking progress. Analysis takes 3-7 minutes for most repos.

    Args:
        github_url: GitHub repository URL (e.g. https://github.com/owner/repo). Auto-detected if empty.
        reanalyze: Force re-analysis even if already analyzed.
    """
    if not github_url:
        github_url = _detect_github_url() or ""
    if not github_url:
        return "No GitHub URL provided and couldn't detect from git remote. Please provide a GitHub URL."

    try:
        headers = _headers()
    except ValueError as e:
        return str(e)

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            f"{API_BASE}/analyze",
            headers=headers,
            json={"github_url": github_url, "reanalyze": reanalyze},
        )

    if resp.status_code != 200:
        return f"Error {resp.status_code}: {resp.text}"

    data = resp.json()
    status = data.get("status", "unknown")
    job_id = data.get("job_id", "")
    msg = data.get("message", "")
    url = data.get("project_url", "")

    if status == "completed":
        return (
            f"Analysis already complete!\n"
            f"Job ID: {job_id}\n"
            f"View: {url}\n\n"
            f"Use get_summary(job_id=\"{job_id}\") to see results, "
            f"or get_agent_context(job_id=\"{job_id}\") to get the full agent context."
        )
    elif status == "processing":
        return (
            f"Analysis started — {msg}\n"
            f"Job ID: {job_id}\n\n"
            f"Use check_status(job_id=\"{job_id}\") to monitor progress. "
            f"Most repos complete in 3-7 minutes."
        )
    else:
        return f"Status: {status}\nJob ID: {job_id}\n{msg}"


@mcp.tool()
async def check_status(job_id: str) -> str:
    """Check the status of a Revibe analysis job.

    Args:
        job_id: The job ID returned from analyze_repo.
    """
    try:
        headers = _headers()
    except ValueError as e:
        return str(e)

    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(
            f"{API_BASE}/analysis/{job_id}/status",
            headers=headers,
        )

    if resp.status_code != 200:
        return f"Error {resp.status_code}: {resp.text}"

    data = resp.json()
    status = data.get("status", "unknown")
    completed = data.get("steps_completed", 0)
    total = data.get("steps_total", 10)
    progress = data.get("progress", "")

    if status == "completed":
        return (
            f"Analysis complete! ({completed}/{total} steps)\n\n"
            f"Use get_summary(job_id=\"{job_id}\") to see results."
        )
    elif status == "processing":
        return (
            f"In progress: {completed}/{total} steps completed\n"
            f"Current step: {progress}\n\n"
            f"Check again in 15-30 seconds."
        )
    elif status == "error":
        return f"Analysis failed at step {completed}/{total}."
    else:
        return f"Status: {status} ({completed}/{total})"


@mcp.tool()
async def get_summary(job_id: str) -> str:
    """Get a condensed summary of a completed Revibe analysis.

    Shows architecture pattern, language, file count, key modules, and available sections.

    Args:
        job_id: The job ID from analyze_repo.
    """
    try:
        headers = _headers()
    except ValueError as e:
        return str(e)

    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(
            f"{API_BASE}/analysis/{job_id}/summary",
            headers=headers,
        )

    if resp.status_code == 409:
        return "Analysis not yet complete. Use check_status() to monitor progress."
    if resp.status_code != 200:
        return f"Error {resp.status_code}: {resp.text}"

    d = resp.json()
    modules = "\n".join(
        f"  - {m['name']}: {m['description']}" for m in d.get("key_modules", [])
    )
    patterns = ", ".join(d.get("patterns", []))
    db = d.get("database")
    db_str = f"{db['type']}, {db['tables']} tables" if db else "None detected"
    sections = ", ".join(d.get("sections_available", []))

    return (
        f"Revibe Analysis: {d.get('name', 'Unknown')}\n"
        f"{'=' * 40}\n"
        f"Architecture: {d.get('architecture_pattern', 'N/A')}\n"
        f"Language:     {d.get('language', 'N/A')}\n"
        f"Files:        {d.get('total_files', 0)}\n"
        f"Entry point:  {d.get('entry_point', 'N/A')}\n\n"
        f"Key Modules:\n{modules}\n\n"
        f"Patterns: {patterns}\n"
        f"Database: {db_str}\n\n"
        f"Sections available: {sections}\n"
        f"Full analysis: {d.get('project_url', '')}\n\n"
        f"Use get_section(job_id=\"{d.get('job_id', job_id)}\", section=\"...\") to drill into any section.\n"
        f"Use get_agent_context(job_id=\"{d.get('job_id', job_id)}\") to get structured context for AI agents."
    )


@mcp.tool()
async def get_section(
    job_id: str,
    section: str,
) -> str:
    """Get a specific analysis section from a completed Revibe analysis.

    Available sections:
    - technical_architecture (or "architecture") — system layers, technologies, diagrams
    - file_roles — what each file does, importance, dependencies
    - system_design_qa — interview-style Q&A about design decisions
    - story_flow (or "execution_flows") — how the app starts up and handles requests
    - database_schema (or "database") — tables, relationships, ER diagrams
    - concepts_explanation (or "concepts") — key patterns and concepts used
    - modules — logical groupings of files
    - business_logic — core domain logic and rules
    - flow_implementation — detailed execution flow code traces

    Args:
        job_id: The job ID from analyze_repo.
        section: Section name (e.g. "architecture", "file_roles", "system_design_qa").
    """
    try:
        headers = _headers()
    except ValueError as e:
        return str(e)

    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(
            f"{API_BASE}/analysis/{job_id}/section/{section}",
            headers=headers,
        )

    if resp.status_code != 200:
        return f"Error {resp.status_code}: {resp.text}"

    data = resp.json()
    return json.dumps(data.get("data", data), indent=2)


@mcp.tool()
async def get_agent_context(job_id: str) -> str:
    """Get the full agent context JSON for a completed analysis.

    This is a structured format optimized for AI agents, containing:
    - File index with roles, imports, exports
    - Dependency graph
    - Architecture layers
    - Call chains and execution flows
    - Constraints and design decisions
    - Database schema

    Save the output to agent_context.json for persistent codebase understanding.

    Args:
        job_id: The job ID from analyze_repo.
    """
    try:
        headers = _headers()
    except ValueError as e:
        return str(e)

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(
            f"{API_BASE}/analysis/{job_id}/agent-context",
            headers=headers,
        )

    if resp.status_code == 409:
        return "Analysis not yet complete. Use check_status() to monitor progress."
    if resp.status_code != 200:
        return f"Error {resp.status_code}: {resp.text}"

    return json.dumps(resp.json(), indent=2)


def main():
    mcp.run()


if __name__ == "__main__":
    main()

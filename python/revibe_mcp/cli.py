"""
Standalone CLI for revibe-mcp auth.
Usage: revibe-mcp-auth login
"""

import asyncio
import json
import sys
import webbrowser
from pathlib import Path

import httpx

API_BASE = "https://app-backend.revibe.codes/api/v1"
CREDENTIALS_PATH = Path.home() / ".config" / "revibe" / "credentials.json"


def save_credentials(api_key: str, email: str):
    CREDENTIALS_PATH.parent.mkdir(parents=True, exist_ok=True)
    CREDENTIALS_PATH.write_text(json.dumps({
        "api_key": api_key,
        "email": email,
    }, indent=2))
    CREDENTIALS_PATH.chmod(0o600)


async def login():
    print("Starting Revibe login...")

    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(f"{API_BASE}/cli-auth/start")

    if resp.status_code != 200:
        print(f"Failed to start auth: {resp.text}")
        sys.exit(1)

    data = resp.json()
    device_code = data["device_code"]
    auth_url = data["auth_url"]

    print(f"\nOpening browser...\nIf it doesn't open, go to:\n  {auth_url}\n")
    webbrowser.open(auth_url)

    print("Waiting for authorization", end="", flush=True)

    async with httpx.AsyncClient(timeout=15) as client:
        for _ in range(60):
            await asyncio.sleep(5)
            print(".", end="", flush=True)

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
                save_credentials(api_key, email)
                print(f"\n\nLogged in as {email}")
                print(f"Credentials saved to {CREDENTIALS_PATH}")
                print("\nYou're all set! Revibe tools will now work automatically.")
                return
            elif status == "expired":
                print("\n\nAuthorization expired. Please try again.")
                sys.exit(1)

    print("\n\nTimed out after 5 minutes. Please try again.")
    sys.exit(1)


def status():
    if CREDENTIALS_PATH.exists():
        try:
            data = json.loads(CREDENTIALS_PATH.read_text())
            email = data.get("email", "unknown")
            key_prefix = data.get("api_key", "")[:15]
            print(f"Logged in as: {email}")
            print(f"API key: {key_prefix}...")
            print(f"Credentials: {CREDENTIALS_PATH}")
        except Exception:
            print("Credentials file exists but is unreadable.")
    else:
        print("Not logged in. Run: revibe-mcp-auth login")


def logout():
    if CREDENTIALS_PATH.exists():
        CREDENTIALS_PATH.unlink()
        print("Logged out. Credentials removed.")
    else:
        print("Not logged in.")


def main():
    if len(sys.argv) < 2:
        print("Usage: revibe-mcp-auth <command>")
        print("Commands:")
        print("  login   - Log in via browser")
        print("  status  - Show current auth status")
        print("  logout  - Remove saved credentials")
        sys.exit(1)

    cmd = sys.argv[1]
    if cmd == "login":
        asyncio.run(login())
    elif cmd == "status":
        status()
    elif cmd == "logout":
        logout()
    else:
        print(f"Unknown command: {cmd}")
        sys.exit(1)


if __name__ == "__main__":
    main()

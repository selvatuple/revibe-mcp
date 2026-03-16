#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync, chmodSync, existsSync, unlinkSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { exec } from "child_process";
const API_BASE = "https://app-backend.revibe.codes/api/v1";
const CREDENTIALS_DIR = join(homedir(), ".config", "revibe");
const CREDENTIALS_PATH = join(CREDENTIALS_DIR, "credentials.json");
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
async function login() {
    console.log("Starting Revibe login...");
    const startResp = await fetch(`${API_BASE}/cli-auth/start`, {
        method: "POST",
    });
    if (!startResp.ok) {
        console.error(`Failed to start auth: ${await startResp.text()}`);
        process.exit(1);
    }
    const { device_code, auth_url } = (await startResp.json());
    console.log(`\nOpening browser...\nIf it doesn't open, go to:\n  ${auth_url}\n`);
    const openCmd = process.platform === "darwin"
        ? "open"
        : process.platform === "win32"
            ? "start"
            : "xdg-open";
    exec(`${openCmd} "${auth_url}"`);
    process.stdout.write("Waiting for authorization");
    for (let i = 0; i < 60; i++) {
        await sleep(5000);
        process.stdout.write(".");
        const pollResp = await fetch(`${API_BASE}/cli-auth/poll?code=${device_code}`);
        if (!pollResp.ok)
            continue;
        const pollData = (await pollResp.json());
        if (pollData.status === "completed" && pollData.api_key) {
            mkdirSync(CREDENTIALS_DIR, { recursive: true });
            writeFileSync(CREDENTIALS_PATH, JSON.stringify({ api_key: pollData.api_key, email: pollData.email }, null, 2));
            chmodSync(CREDENTIALS_PATH, 0o600);
            console.log(`\n\nLogged in as ${pollData.email}`);
            console.log(`Credentials saved to ${CREDENTIALS_PATH}`);
            console.log("\nYou're all set! Revibe tools will now work automatically.");
            return;
        }
        else if (pollData.status === "expired") {
            console.log("\n\nAuthorization expired. Please try again.");
            process.exit(1);
        }
    }
    console.log("\n\nTimed out after 5 minutes. Please try again.");
    process.exit(1);
}
function status() {
    if (existsSync(CREDENTIALS_PATH)) {
        try {
            const data = JSON.parse(readFileSync(CREDENTIALS_PATH, "utf-8"));
            console.log(`Logged in as: ${data.email || "unknown"}`);
            console.log(`API key: ${(data.api_key || "").slice(0, 15)}...`);
            console.log(`Credentials: ${CREDENTIALS_PATH}`);
        }
        catch {
            console.log("Credentials file exists but is unreadable.");
        }
    }
    else {
        console.log("Not logged in. Run: revibe-mcp-auth login");
    }
}
function logout() {
    if (existsSync(CREDENTIALS_PATH)) {
        unlinkSync(CREDENTIALS_PATH);
        console.log("Logged out. Credentials removed.");
    }
    else {
        console.log("Not logged in.");
    }
}
const cmd = process.argv[2];
if (!cmd) {
    console.log("Usage: revibe-mcp-auth <command>");
    console.log("Commands:");
    console.log("  login   - Log in via browser");
    console.log("  status  - Show current auth status");
    console.log("  logout  - Remove saved credentials");
    process.exit(1);
}
if (cmd === "login") {
    login().catch(console.error);
}
else if (cmd === "status") {
    status();
}
else if (cmd === "logout") {
    logout();
}
else {
    console.error(`Unknown command: ${cmd}`);
    process.exit(1);
}

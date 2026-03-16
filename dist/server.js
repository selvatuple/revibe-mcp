#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { execSync } from "child_process";
import { readFileSync, writeFileSync, mkdirSync, chmodSync, existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";
const API_BASE = "https://app-backend.revibe.codes/api/v1";
const CREDENTIALS_DIR = join(homedir(), ".config", "revibe");
const CREDENTIALS_PATH = join(CREDENTIALS_DIR, "credentials.json");
// ─── Credentials ───
function loadSavedKey() {
    try {
        if (existsSync(CREDENTIALS_PATH)) {
            const data = JSON.parse(readFileSync(CREDENTIALS_PATH, "utf-8"));
            return data.api_key || null;
        }
    }
    catch { }
    return null;
}
function saveCredentials(apiKey, email) {
    mkdirSync(CREDENTIALS_DIR, { recursive: true });
    writeFileSync(CREDENTIALS_PATH, JSON.stringify({ api_key: apiKey, email }, null, 2));
    chmodSync(CREDENTIALS_PATH, 0o600);
}
function getApiKey() {
    const envKey = process.env.REVIBE_API_KEY;
    if (envKey)
        return envKey;
    const savedKey = loadSavedKey();
    if (savedKey)
        return savedKey;
    throw new Error("Not authenticated. Use the revibe_login tool to log in, or set REVIBE_API_KEY in your MCP config.");
}
function headers() {
    return {
        "X-Revibe-Key": getApiKey(),
        "Content-Type": "application/json",
    };
}
// ─── Helpers ───
function detectGitHubUrl() {
    try {
        let url = execSync("git remote get-url origin", {
            timeout: 5000,
            encoding: "utf-8",
        }).trim();
        if (url.startsWith("git@github.com:")) {
            url = url.replace("git@github.com:", "https://github.com/");
        }
        if (url.endsWith(".git")) {
            url = url.slice(0, -4);
        }
        if (url.includes("github.com"))
            return url;
        return null;
    }
    catch {
        return null;
    }
}
async function apiFetch(path, options = {}) {
    const url = `${API_BASE}${path}`;
    const h = options.headers
        ? { ...headers(), ...options.headers }
        : headers();
    return fetch(url, { ...options, headers: h });
}
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
// ─── Server ───
const server = new McpServer({
    name: "revibe",
    version: "0.1.0",
});
// ─── Tool: revibe_login ───
server.tool("revibe_login", "Log in to Revibe via browser. Opens a browser window for authentication. After logging in and clicking Authorize, the API key is saved locally so all other Revibe tools work automatically.", {}, async () => {
    const startResp = await fetch(`${API_BASE}/cli-auth/start`, {
        method: "POST",
    });
    if (!startResp.ok) {
        return {
            content: [
                { type: "text", text: `Failed to start auth: ${await startResp.text()}` },
            ],
        };
    }
    const startData = (await startResp.json());
    const { device_code, auth_url } = startData;
    // Open browser
    const { exec } = await import("child_process");
    const openCmd = process.platform === "darwin"
        ? "open"
        : process.platform === "win32"
            ? "start"
            : "xdg-open";
    exec(`${openCmd} "${auth_url}"`);
    // Poll for completion
    for (let i = 0; i < 60; i++) {
        await sleep(5000);
        const pollResp = await fetch(`${API_BASE}/cli-auth/poll?code=${device_code}`);
        if (!pollResp.ok)
            continue;
        const pollData = (await pollResp.json());
        if (pollData.status === "completed" && pollData.api_key) {
            saveCredentials(pollData.api_key, pollData.email || "");
            return {
                content: [
                    {
                        type: "text",
                        text: `Logged in as ${pollData.email}\nAPI key saved to ${CREDENTIALS_PATH}\n\nYou're all set! Try analyze_repo() to analyze a codebase.`,
                    },
                ],
            };
        }
        else if (pollData.status === "expired") {
            return {
                content: [
                    {
                        type: "text",
                        text: "Authorization expired. Please try revibe_login() again.",
                    },
                ],
            };
        }
    }
    return {
        content: [
            {
                type: "text",
                text: "Authorization timed out after 5 minutes. Please try revibe_login() again.",
            },
        ],
    };
});
// ─── Tool: analyze_repo ───
server.tool("analyze_repo", "Submit a GitHub repository for Revibe analysis. Analyzes architecture, file roles, execution flows, system design Q&A, and more. If no URL is provided, auto-detects from the current git remote. Analysis takes 3-7 minutes for most repos.", {
    github_url: z
        .string()
        .optional()
        .describe("GitHub repository URL (e.g. https://github.com/owner/repo). Auto-detected if empty."),
    reanalyze: z
        .boolean()
        .optional()
        .describe("Force re-analysis even if already analyzed."),
}, async ({ github_url, reanalyze }) => {
    const url = github_url || detectGitHubUrl();
    if (!url) {
        return {
            content: [
                {
                    type: "text",
                    text: "No GitHub URL provided and couldn't detect from git remote. Please provide a GitHub URL.",
                },
            ],
        };
    }
    let resp;
    try {
        resp = await apiFetch("/analyze", {
            method: "POST",
            body: JSON.stringify({
                github_url: url,
                reanalyze: reanalyze || false,
            }),
        });
    }
    catch (e) {
        return { content: [{ type: "text", text: e.message }] };
    }
    if (!resp.ok) {
        return {
            content: [
                { type: "text", text: `Error ${resp.status}: ${await resp.text()}` },
            ],
        };
    }
    const data = (await resp.json());
    if (data.status === "completed") {
        return {
            content: [
                {
                    type: "text",
                    text: `Analysis already complete!\nJob ID: ${data.job_id}\nView: ${data.project_url}\n\nUse get_summary(job_id="${data.job_id}") to see results, or get_agent_context(job_id="${data.job_id}") to get the full agent context.`,
                },
            ],
        };
    }
    else if (data.status === "processing") {
        return {
            content: [
                {
                    type: "text",
                    text: `Analysis started — ${data.message}\nJob ID: ${data.job_id}\n\nUse check_status(job_id="${data.job_id}") to monitor progress. Most repos complete in 3-7 minutes.`,
                },
            ],
        };
    }
    return {
        content: [
            {
                type: "text",
                text: `Status: ${data.status}\nJob ID: ${data.job_id}\n${data.message || ""}`,
            },
        ],
    };
});
// ─── Tool: check_status ───
server.tool("check_status", "Check the status of a Revibe analysis job.", {
    job_id: z.string().describe("The job ID returned from analyze_repo."),
}, async ({ job_id }) => {
    let resp;
    try {
        resp = await apiFetch(`/analysis/${job_id}/status`);
    }
    catch (e) {
        return { content: [{ type: "text", text: e.message }] };
    }
    if (!resp.ok) {
        return {
            content: [
                { type: "text", text: `Error ${resp.status}: ${await resp.text()}` },
            ],
        };
    }
    const data = (await resp.json());
    if (data.status === "completed") {
        return {
            content: [
                {
                    type: "text",
                    text: `Analysis complete! (${data.steps_completed}/${data.steps_total} steps)\n\nUse get_summary(job_id="${job_id}") to see results.`,
                },
            ],
        };
    }
    else if (data.status === "processing") {
        return {
            content: [
                {
                    type: "text",
                    text: `In progress: ${data.steps_completed}/${data.steps_total} steps completed\nCurrent step: ${data.progress || "working"}\n\nCheck again in 15-30 seconds.`,
                },
            ],
        };
    }
    else if (data.status === "error") {
        return {
            content: [
                {
                    type: "text",
                    text: `Analysis failed at step ${data.steps_completed}/${data.steps_total}.`,
                },
            ],
        };
    }
    return {
        content: [
            {
                type: "text",
                text: `Status: ${data.status} (${data.steps_completed}/${data.steps_total})`,
            },
        ],
    };
});
// ─── Tool: get_summary ───
server.tool("get_summary", "Get a condensed summary of a completed Revibe analysis. Shows architecture pattern, language, file count, key modules, and available sections.", {
    job_id: z.string().describe("The job ID from analyze_repo."),
}, async ({ job_id }) => {
    let resp;
    try {
        resp = await apiFetch(`/analysis/${job_id}/summary`);
    }
    catch (e) {
        return { content: [{ type: "text", text: e.message }] };
    }
    if (resp.status === 409) {
        return {
            content: [
                {
                    type: "text",
                    text: "Analysis not yet complete. Use check_status() to monitor progress.",
                },
            ],
        };
    }
    if (!resp.ok) {
        return {
            content: [
                { type: "text", text: `Error ${resp.status}: ${await resp.text()}` },
            ],
        };
    }
    const d = (await resp.json());
    const modules = (d.key_modules || [])
        .map((m) => `  - ${m.name}: ${m.description}`)
        .join("\n");
    const patterns = (d.patterns || []).join(", ");
    const db = d.database;
    const dbStr = db ? `${db.type}, ${db.tables} tables` : "None detected";
    const sections = (d.sections_available || []).join(", ");
    return {
        content: [
            {
                type: "text",
                text: [
                    `Revibe Analysis: ${d.name || "Unknown"}`,
                    "========================================",
                    `Architecture: ${d.architecture_pattern || "N/A"}`,
                    `Language:     ${d.language || "N/A"}`,
                    `Files:        ${d.total_files || 0}`,
                    `Entry point:  ${d.entry_point || "N/A"}`,
                    "",
                    `Key Modules:\n${modules}`,
                    "",
                    `Patterns: ${patterns}`,
                    `Database: ${dbStr}`,
                    "",
                    `Sections available: ${sections}`,
                    `Full analysis: ${d.project_url || ""}`,
                    "",
                    `Use get_section(job_id="${job_id}", section="...") to drill into any section.`,
                    `Use get_agent_context(job_id="${job_id}") to get structured context for AI agents.`,
                ].join("\n"),
            },
        ],
    };
});
// ─── Tool: get_section ───
server.tool("get_section", `Get a specific analysis section from a completed Revibe analysis.

Available sections:
- technical_architecture (or "architecture") — system layers, technologies, diagrams
- file_roles — what each file does, importance, dependencies
- system_design_qa — interview-style Q&A about design decisions
- story_flow (or "execution_flows") — how the app starts up and handles requests
- database_schema (or "database") — tables, relationships, ER diagrams
- concepts_explanation (or "concepts") — key patterns and concepts used
- modules — logical groupings of files
- business_logic — core domain logic and rules
- flow_implementation — detailed execution flow code traces`, {
    job_id: z.string().describe("The job ID from analyze_repo."),
    section: z
        .string()
        .describe('Section name (e.g. "architecture", "file_roles", "system_design_qa").'),
}, async ({ job_id, section }) => {
    let resp;
    try {
        resp = await apiFetch(`/analysis/${job_id}/section/${section}`);
    }
    catch (e) {
        return { content: [{ type: "text", text: e.message }] };
    }
    if (!resp.ok) {
        return {
            content: [
                { type: "text", text: `Error ${resp.status}: ${await resp.text()}` },
            ],
        };
    }
    const data = (await resp.json());
    return {
        content: [
            { type: "text", text: JSON.stringify(data.data || data, null, 2) },
        ],
    };
});
// ─── Tool: get_agent_context ───
server.tool("get_agent_context", "Get the full agent context JSON for a completed analysis. This is a structured format optimized for AI agents, containing file index, dependency graph, architecture layers, call chains, constraints, design decisions, and database schema. Save the output to agent_context.json for persistent codebase understanding.", {
    job_id: z.string().describe("The job ID from analyze_repo."),
}, async ({ job_id }) => {
    let resp;
    try {
        resp = await apiFetch(`/analysis/${job_id}/agent-context`);
    }
    catch (e) {
        return { content: [{ type: "text", text: e.message }] };
    }
    if (resp.status === 409) {
        return {
            content: [
                {
                    type: "text",
                    text: "Analysis not yet complete. Use check_status() to monitor progress.",
                },
            ],
        };
    }
    if (!resp.ok) {
        return {
            content: [
                { type: "text", text: `Error ${resp.status}: ${await resp.text()}` },
            ],
        };
    }
    const data = await resp.json();
    return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
});
// ─── Start ───
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Revibe MCP server running on stdio");
}
main().catch(console.error);

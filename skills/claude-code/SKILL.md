---
name: revibe
description: Analyze any codebase — get architecture, patterns, file roles, system design Q&A, and agent context. Works on the current project or any GitHub URL.
user_invocable: true
---

# Revibe — Codebase Analysis

Analyze a codebase to understand its architecture, file roles, design patterns, execution flows, and system design decisions. Returns structured insights and saves `agent_context.json` for persistent codebase understanding.

## Instructions

### 1. Determine the target

- If `$ARGUMENTS` contains a GitHub URL or `owner/repo` shorthand, use that
- If `$ARGUMENTS` is empty, detect from the current directory:
  ```bash
  git remote get-url origin 2>/dev/null
  ```
  Convert SSH to HTTPS if needed (`git@github.com:owner/repo.git` → `https://github.com/owner/repo`)
- If not in a git repo and no URL provided, ask the user

### 2. Check for API key

The user needs a `REVIBE_API_KEY` environment variable. Check if it's set:
```bash
echo "${REVIBE_API_KEY:-not_set}"
```

If not set, tell the user:
> You need a Revibe API key. Sign up free at https://app.revibe.codes, then go to Settings → API Keys to generate one.
> Then set it: `export REVIBE_API_KEY=rk_live_your_key_here`

### 3. Submit for analysis

```bash
curl -s -X POST "https://app-backend.revibe.codes/api/v1/analyze" \
  -H "Content-Type: application/json" \
  -H "X-Revibe-Key: ${REVIBE_API_KEY}" \
  -d "{\"github_url\": \"GITHUB_URL_HERE\"}"
```

If status is `"completed"`, skip to step 5.

### 4. Poll for completion

If status is `"processing"`, poll every 10 seconds (max 3 minutes):
```bash
curl -s "https://app-backend.revibe.codes/api/v1/analysis/${JOB_ID}/status" \
  -H "X-Revibe-Key: ${REVIBE_API_KEY}"
```

Show progress to the user as each step completes.

### 5. Show summary

Fetch the summary:
```bash
curl -s "https://app-backend.revibe.codes/api/v1/analysis/${JOB_ID}/summary" \
  -H "X-Revibe-Key: ${REVIBE_API_KEY}"
```

Display it as a formatted summary card:
```
Revibe Analysis: {name}

Architecture: {architecture_pattern}
Language:     {language}
Size:         {total_files} files
Entry point:  {entry_point}

Key Modules:
  {name} — {description} ({loc} LOC)
  ...

Patterns: {patterns}
Database: {type}, {tables} tables

Sections available: {sections_available}
Full analysis: {project_url}
```

### 6. Save agent context

Always save the agent context file:
```bash
curl -s "https://app-backend.revibe.codes/api/v1/analysis/${JOB_ID}/agent-context" \
  -H "X-Revibe-Key: ${REVIBE_API_KEY}" \
  > agent_context.json
```

Tell the user: "Saved agent_context.json — this gives you structured codebase context for future tasks."

### 7. Offer drill-down

After showing the summary, offer to explore specific sections:
- Architecture diagram
- File roles & structure
- System design Q&A
- Execution flows
- Database schema

Fetch any section with:
```bash
curl -s "https://app-backend.revibe.codes/api/v1/analysis/${JOB_ID}/section/{section_name}" \
  -H "X-Revibe-Key: ${REVIBE_API_KEY}"
```

Section names: `technical_architecture`, `file_roles`, `system_design_qa`, `story_flow`, `database_schema`, `concepts_explanation`, `modules`

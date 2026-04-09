# DeepFlow + GitHub Integration: Status & Remaining Work

## Goal

Automate DeepFlow ticket lifecycle based on GitHub pull request events:

| GitHub Event | DeepFlow Action |
|---|---|
| PR opened (branch matches ticket) | Move ticket stage to "PR Open" |
| Review requested on PR | Reassign ticket to the reviewer |
| PR merged and closed | Mark ticket as "Done" |

## What Works Today (Proven End-to-End)

The webhook bridge is deployed and live at `https://deepflow-webhook-test.onrender.com`.

Full pipeline verified with real GitHub webhooks:

```
GitHub PR event
  → Webhook bridge (Render) receives event, extracts branch + action
  → Saves event JSON at public URL
  → Calls DeepFlow template-webhook with input_resource_download_urls
  → DeepFlow accepts (HTTP 202)
  → DeepFlow agent can download the event JSON
```

| Component | Status |
|---|---|
| GitHub webhook delivery | Working |
| Webhook bridge (event mapping + hosting) | Working, deployed |
| Template webhook call | Working (202 Accepted) |
| DeepFlow agent receives event data | Working |
| Agent can change task state/assignment | Already supported |
| Agent can find task cross-workflow by branch | **Needs "search tasks" tool** |

## The One Remaining Gap: Cross-Workflow Task Search

The DeepFlow agent (workflow template) already has the ability to:
- Change task state (e.g., "In Progress" → "PR Open" → "Done")
- Reassign a task to a different user

The only missing piece is: given a branch name like `feature/DF-42-user-auth`, find the matching task **across workflows**.

### What the agent receives

When the agent downloads the JSON from `input_resource_download_urls[0]`, it gets:

```json
{
  "source": "github",
  "event": "pull_request",
  "action": "closed",
  "branch": "feature/DF-99-demo",
  "pr_number": 3,
  "pr_title": "feat: demo feature (DF-99)",
  "pr_url": "https://github.com/org/repo/pull/3",
  "repo": "org/repo",
  "sender": "danijelvukovic-servalit",
  "timestamp": "2026-04-08T16:41:01.909Z",
  "deepflow_action": "move_to_stage",
  "target_stage": "Done",
  "merged_by": "danijelvukovic-servalit",
  "description": "PR #3 merged — mark ticket as \"Done\""
}
```

### What the agent needs to do

```
1. Read the JSON
2. Extract `branch` field → "feature/DF-99-demo"
3. SEARCH TASKS where branch property == "feature/DF-99-demo"  ← needs new tool
4. Based on `deepflow_action`:
   - "move_to_stage" → change task stage to `target_stage` value
   - "reassign"      → reassign task to user from `requested_reviewer` field
```

### What the "search tasks" tool needs

A tool the agent can call that:
- Accepts a query (branch name)
- Searches across all workflows
- Returns matching task(s) with their IDs

Example interface:
```
search_tasks(query="feature/DF-99-demo", field="branch")
→ [{ "task_id": "abc-123", "workflow_id": "def-456", "title": "Demo feature", "stage": "In Progress" }]
```

**Estimated effort:** ~30 minutes (per Charlie)

### Prerequisites on the DeepFlow side

1. **Add a `branch` text property to workflow templates** — so tasks can be annotated with their branch name when moved to "In Progress"
2. **Build the "search tasks" ML tool** — so the agent can find tasks by branch name cross-workflow
3. **Configure the agent template** — to parse the GitHub event JSON and execute the right action

## Event Types the Agent Should Handle

| `deepflow_action` | `target_stage` | `requested_reviewer` | Agent behavior |
|---|---|---|---|
| `move_to_stage` | `"PR Open"` | — | Find task by branch → set stage to "PR Open" |
| `reassign` | — | `"github_username"` | Find task by branch → reassign to reviewer |
| `move_to_stage` | `"Done"` | — | Find task by branch → set stage to "Done" |
| `info` | — | — | No action needed (e.g., PR closed without merge) |

## Architecture

```
┌─────────┐    webhook     ┌──────────────────┐    template-webhook    ┌─────────────┐
│  GitHub  │ ──────────────→│  Webhook Bridge  │ ─────────────────────→│  DeepFlow   │
│  (PRs)   │                │  (Render)        │                       │  Agent      │
└─────────┘                └──────────────────┘                       └──────┬──────┘
                            Extracts branch,                                 │
                            action, reviewer.                                │
                            Hosts JSON at                          ┌─────────▼─────────┐
                            public URL.                            │  search_tasks()    │
                                                                   │  (NEW - ~30 min)   │
                                                                   └─────────┬─────────┘
                                                                             │
                                                                   ┌─────────▼─────────┐
                                                                   │  Update task       │
                                                                   │  stage / assignee  │
                                                                   │  (already works)   │
                                                                   └───────────────────┘
```

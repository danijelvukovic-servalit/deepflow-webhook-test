# DeepFlow Product Gap Analysis: GitHub Webhook Integration

## Goal

Automate DeepFlow ticket lifecycle based on GitHub pull request events:

| GitHub Event | Expected DeepFlow Action |
|---|---|
| PR opened (branch matches ticket) | Move ticket stage to "PR Open" |
| Review requested on PR | Reassign ticket to the reviewer |
| PR merged and closed | Mark ticket as "Done" |

## Current State

The only available integration point is the **template webhook**:

```
POST /api/public/template-webhook/{template_id}/{webhook_id}
```

This endpoint expects:

```json
{
  "input_resource_download_urls": ["https://example.com/file.txt"],
  "workflow_result_upload_url": "https://example.com/result"
}
```

It is designed to trigger an internal DeepFlow workflow by providing it with downloadable resources and a callback URL for results. It is **not** a ticket management API.

## Identified Gaps

### GAP 1: No Ticket Query API

**Need:** Given a branch name (e.g., `feature/DF-42-user-auth`), find the corresponding DeepFlow ticket.

**Why it matters:** When GitHub sends a `pull_request` event, the payload contains the branch name (`pull_request.head.ref`). To update the right ticket, we need to look it up by branch. Without this, there is no programmatic way to map a PR to a ticket.

**What would solve it:**
```
GET /api/tickets?branch_name=feature/DF-42-user-auth
→ { "id": "ticket-uuid", "title": "User Auth", "stage": "In Progress", ... }
```

Or a GraphQL query, search endpoint, or any mechanism to filter tickets by custom field values.

---

### GAP 2: No Ticket Update API

**Need:** Programmatically change a ticket's stage and assignee.

**Why it matters:** This is the core action — moving a ticket from "In Progress" → "PR Open" → "Done", and reassigning to a reviewer. Without a mutation API, no external system can update tickets.

**What would solve it:**
```
PATCH /api/tickets/{ticket_id}
{
  "stage": "PR Open"
}
```

```
PATCH /api/tickets/{ticket_id}
{
  "assignee_id": "user-uuid-of-reviewer"
}
```

---

### GAP 3: Template Webhook is Input-Oriented, Not Event-Oriented

**Current behavior:** The template webhook expects file URLs as input resources. It is designed for a workflow like: "here are files, process them, send results back."

**What GitHub integration needs:** An event-driven webhook that accepts arbitrary JSON payloads (GitHub sends structured event data, not files) and triggers ticket mutations based on the event content.

**Possible workaround:** Host the GitHub event JSON as a file on a public URL, pass that URL as `input_resource_download_urls[0]`, and have a DeepFlow workflow that:
1. Downloads the JSON
2. Parses the branch name and action
3. Finds the ticket internally
4. Updates the ticket stage/assignee

This is technically possible but requires:
- A publicly accessible server to host event data (the bridge server in this POC)
- A custom DeepFlow workflow template configured to parse GitHub event payloads
- Internal DeepFlow APIs within the workflow to manipulate tickets

---

### GAP 4: Branch Name as a Structured, Queryable Field

**Need:** Each DeepFlow ticket should have a "branch name" field that is:
- Settable when a ticket moves to "In Progress"
- Queryable via API (see GAP 1)
- Unique enough to map 1:1 to a GitHub branch

**Current state:** Unknown whether this custom field exists or is searchable. If branch names are stored in free-text descriptions, reliable matching is fragile.

**Convention suggestion:** Use a branch naming convention like `feature/DF-{ticket_id}-description` so the ticket ID is extractable from the branch name via regex, reducing the dependency on a search API.

---

### GAP 5: User Identity Mapping

**Need:** Map GitHub usernames to DeepFlow user IDs for reviewer reassignment.

**Why it matters:** When GitHub sends `review_requested`, the payload contains the reviewer's GitHub username. To reassign a DeepFlow ticket, we need the reviewer's DeepFlow user ID.

**What would solve it:**
- A user lookup API: `GET /api/users?github_username=marko`
- Or a configuration mapping maintained in the webhook bridge
- Or DeepFlow profiles that include a "GitHub username" field

---

## Summary: What Each Workflow Step Needs

| Step | Needs from DeepFlow | Gap |
|---|---|---|
| **Ticket created, moved to In Progress** | Branch name field on ticket | GAP 4 |
| **PR opened → "PR Open"** | Query ticket by branch + update stage | GAP 1, 2 |
| **Review requested → reassign** | Query ticket + user mapping + update assignee | GAP 1, 2, 5 |
| **PR merged → "Done"** | Query ticket + update stage | GAP 1, 2 |
| **Event delivery** | Accept JSON events (not file URLs) | GAP 3 |

## Recommendations

### Short-term (workaround with current product)

1. **Branch naming convention** — Use `feature/DF-{id}-...` to encode the ticket ID in the branch name, avoiding the need for a query API (partially addresses GAP 1)
2. **Manual user mapping** — Maintain a `github_username → deepflow_user_id` config file in the webhook bridge (addresses GAP 5)
3. **Template webhook as proxy** — If DeepFlow can build an internal workflow that parses GitHub event JSON and updates tickets, the current template webhook could serve as the entry point (partially addresses GAP 3)

### Medium-term (product changes needed)

1. **Ticket REST API** — `GET`, `PATCH` endpoints for tickets with filtering by custom fields (addresses GAP 1, 2, 4)
2. **Generic webhook trigger** — Accept arbitrary JSON payloads without requiring `input_resource_download_urls` format (addresses GAP 3)
3. **User directory API** — Lookup users by external identity (addresses GAP 5)

### Long-term (full integration)

1. **Native GitHub integration** — Built-in GitHub App or OAuth integration within DeepFlow that handles the entire flow without an external bridge server
2. **Webhook event subscriptions** — DeepFlow registers its own webhooks on GitHub repos and processes events internally

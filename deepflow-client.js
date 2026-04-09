const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const DEEPFLOW_WEBHOOK_URL =
  process.env.DEEPFLOW_WEBHOOK_URL ||
  "https://api-v2.stg.deepflow.com/api/public/template-webhook/8c625ca2-e2ba-437d-8e44-9222c65c5ebd/a8f907b4-fca3-45d6-bacf-aa82f7915d4c";

const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || "";

const EVENT_DATA_DIR = path.join(__dirname, "logs", "event-data");
if (!fs.existsSync(EVENT_DATA_DIR)) {
  fs.mkdirSync(EVENT_DATA_DIR, { recursive: true });
}

function mapGitHubEventToDeepFlow(event, action, payload) {
  if (event !== "pull_request") return null;

  const pr = payload.pull_request;
  if (!pr) return null;

  const branchName = pr.head?.ref;
  if (!branchName) return null;

  // Extract task identifier from branch name
  // Supports: feature/DF-42-description, DF-42-foo, bugfix/DF-42, etc.
  const taskIdMatch = branchName.match(/\b(DF-\d+)\b/i);
  const taskIdentifier = taskIdMatch ? taskIdMatch[1].toUpperCase() : null;

  const base = {
    source: "github",
    event,
    action,
    branch: branchName,
    task_identifier: taskIdentifier,
    pr_number: pr.number,
    pr_title: pr.title,
    pr_url: pr.html_url,
    repo: payload.repository?.full_name,
    sender: payload.sender?.login,
    timestamp: new Date().toISOString(),
  };

  switch (action) {
    case "opened":
    case "reopened":
      return {
        ...base,
        deepflow_action: "move_to_stage",
        target_stage: "In Progress",
        description: `PR #${pr.number} opened for branch "${branchName}" — move ticket to "In Progress"`,
      };

    case "review_requested":
      return {
        ...base,
        deepflow_action: "reassign",
        reviewers: (payload.pull_request.requested_reviewers || []).map(
          (r) => r.login
        ),
        requested_reviewer: payload.requested_reviewer?.login || null,
        description: `Review requested on PR #${pr.number} — reassign ticket to reviewer`,
      };

    case "closed":
      if (pr.merged) {
        return {
          ...base,
          deepflow_action: "move_to_stage",
          target_stage: "Done",
          merged_by: pr.merged_by?.login || payload.sender?.login,
          description: `PR #${pr.number} merged — mark ticket as "Done"`,
        };
      }
      return {
        ...base,
        deepflow_action: "info",
        target_stage: null,
        description: `PR #${pr.number} closed without merge — no ticket update`,
      };

    default:
      return {
        ...base,
        deepflow_action: "info",
        description: `PR #${pr.number} action "${action}" — logged but no ticket update mapped`,
      };
  }
}

function hostEventData(eventData) {
  const id = crypto.randomUUID();
  const filepath = path.join(EVENT_DATA_DIR, `${id}.json`);
  fs.writeFileSync(filepath, JSON.stringify(eventData, null, 2));
  return { id, filepath };
}

async function forwardToDeepFlow(eventData) {
  const { id } = hostEventData(eventData);

  if (!PUBLIC_BASE_URL) {
    return {
      forwarded: false,
      reason:
        "PUBLIC_BASE_URL not set — cannot provide a reachable URL for DeepFlow to download event data. " +
        "Set PUBLIC_BASE_URL to your ngrok/public URL.",
      event_data_id: id,
      would_send: {
        url: DEEPFLOW_WEBHOOK_URL,
        body: {
          input_resource_download_urls: [
            `<PUBLIC_BASE_URL>/event-data/${id}.json`,
          ],
          workflow_result_upload_url: `<PUBLIC_BASE_URL>/deepflow-results`,
        },
      },
    };
  }

  const inputUrl = `${PUBLIC_BASE_URL}/event-data/${id}.json`;
  const resultUrl = `${PUBLIC_BASE_URL}/deepflow-results`;

  const body = {
    input_resource_download_urls: [inputUrl],
    workflow_result_upload_url: resultUrl,
  };

  try {
    const response = await fetch(DEEPFLOW_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const responseText = await response.text();
    let responseData;
    try {
      responseData = JSON.parse(responseText);
    } catch {
      responseData = responseText;
    }

    return {
      forwarded: true,
      status: response.status,
      success: response.ok,
      event_data_id: id,
      event_data_url: inputUrl,
      sent_body: body,
      deepflow_response: responseData,
    };
  } catch (err) {
    return {
      forwarded: true,
      status: null,
      success: false,
      event_data_id: id,
      error: err.message,
      sent_body: body,
    };
  }
}

module.exports = {
  mapGitHubEventToDeepFlow,
  forwardToDeepFlow,
  hostEventData,
  DEEPFLOW_WEBHOOK_URL,
  EVENT_DATA_DIR,
};

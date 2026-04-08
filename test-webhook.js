require("dotenv").config();
const crypto = require("node:crypto");

const PORT = process.env.PORT || 3000;
const SECRET = process.env.WEBHOOK_SECRET || "";
const BASE_URL = `http://localhost:${PORT}`;

const BRANCH = "feature/DF-42-user-auth";
const REPO = {
  id: 1,
  full_name: "Servalit/deepflow-app",
  html_url: "https://github.com/Servalit/deepflow-app",
};
const AUTHOR = { login: "danijel", id: 101 };
const REVIEWER = { login: "marko", id: 102 };

const scenarios = {
  ping: {
    event: "ping",
    payload: {
      zen: "Anything added dilutes everything else.",
      hook_id: 123456789,
      hook: {
        type: "Repository",
        id: 123456789,
        name: "web",
        active: true,
        events: ["push", "pull_request"],
        config: { content_type: "json", url: `${BASE_URL}/webhook` },
      },
      repository: REPO,
      sender: AUTHOR,
    },
  },

  "pr-opened": {
    event: "pull_request",
    payload: {
      action: "opened",
      number: 42,
      pull_request: {
        id: 1001,
        number: 42,
        title: "feat: add user authentication flow",
        state: "open",
        html_url: `${REPO.html_url}/pull/42`,
        user: AUTHOR,
        body: "Implements login/register with JWT tokens.\n\nDeepFlow ticket: DF-42",
        head: { ref: BRANCH, sha: "a1b2c3d4" },
        base: { ref: "main", sha: "e5f6a7b8" },
        requested_reviewers: [],
        merged: false,
        merged_by: null,
      },
      repository: REPO,
      sender: AUTHOR,
    },
  },

  "pr-review-requested": {
    event: "pull_request",
    payload: {
      action: "review_requested",
      number: 42,
      requested_reviewer: REVIEWER,
      pull_request: {
        id: 1001,
        number: 42,
        title: "feat: add user authentication flow",
        state: "open",
        html_url: `${REPO.html_url}/pull/42`,
        user: AUTHOR,
        body: "Implements login/register with JWT tokens.\n\nDeepFlow ticket: DF-42",
        head: { ref: BRANCH, sha: "a1b2c3d4" },
        base: { ref: "main", sha: "e5f6a7b8" },
        requested_reviewers: [REVIEWER],
        merged: false,
        merged_by: null,
      },
      repository: REPO,
      sender: AUTHOR,
    },
  },

  "pr-merged": {
    event: "pull_request",
    payload: {
      action: "closed",
      number: 42,
      pull_request: {
        id: 1001,
        number: 42,
        title: "feat: add user authentication flow",
        state: "closed",
        html_url: `${REPO.html_url}/pull/42`,
        user: AUTHOR,
        body: "Implements login/register with JWT tokens.\n\nDeepFlow ticket: DF-42",
        head: { ref: BRANCH, sha: "a1b2c3d4" },
        base: { ref: "main", sha: "e5f6a7b8" },
        requested_reviewers: [],
        merged: true,
        merged_by: REVIEWER,
        merged_at: new Date().toISOString(),
      },
      repository: REPO,
      sender: REVIEWER,
    },
  },

  "pr-closed": {
    event: "pull_request",
    payload: {
      action: "closed",
      number: 43,
      pull_request: {
        id: 1002,
        number: 43,
        title: "fix: remove unused code",
        state: "closed",
        html_url: `${REPO.html_url}/pull/43`,
        user: AUTHOR,
        body: "Cleanup PR — no ticket.",
        head: { ref: "cleanup/remove-dead-code", sha: "f9e8d7c6" },
        base: { ref: "main", sha: "e5f6a7b8" },
        requested_reviewers: [],
        merged: false,
        merged_by: null,
      },
      repository: REPO,
      sender: AUTHOR,
    },
  },

  push: {
    event: "push",
    payload: {
      ref: `refs/heads/${BRANCH}`,
      before: "0000000000000000000000000000000000000000",
      after: "a1b2c3d4",
      repository: REPO,
      pusher: { name: "danijel", email: "danijel@example.com" },
      sender: AUTHOR,
      commits: [
        {
          id: "a1b2c3d4",
          message: "feat: add JWT auth middleware",
          timestamp: new Date().toISOString(),
          author: { name: "Danijel", email: "danijel@example.com" },
          added: ["src/auth.js"],
          modified: ["src/app.js"],
          removed: [],
        },
      ],
    },
  },
};

async function send(name, { event, payload }) {
  const body = JSON.stringify(payload);
  const delivery = crypto.randomUUID();

  const headers = {
    "Content-Type": "application/json",
    "X-GitHub-Event": event,
    "X-GitHub-Delivery": delivery,
    "User-Agent": "GitHub-Hookshot/test",
  };

  if (SECRET) {
    headers["X-Hub-Signature-256"] =
      "sha256=" +
      crypto.createHmac("sha256", SECRET).update(body).digest("hex");
  }

  console.log(`\n📤 Sending: ${name} (${event}/${payload.action || "-"})`);

  try {
    const response = await fetch(`${BASE_URL}/webhook`, {
      method: "POST",
      headers,
      body,
    });

    const data = await response.json();
    console.log(`   Response ${response.status}:`, JSON.stringify(data, null, 2));
    return data;
  } catch (err) {
    console.error(`   ❌ Failed: ${err.message}`);
    console.log("   Make sure the server is running (npm start)");
    process.exit(1);
  }
}

async function run() {
  const mode = process.argv[2] || "lifecycle";

  if (mode === "lifecycle") {
    console.log("🔄 Simulating full PR lifecycle for branch:", BRANCH);
    console.log("   This will send: pr-opened → pr-review-requested → pr-merged\n");

    await send("PR Opened", scenarios["pr-opened"]);
    await new Promise((r) => setTimeout(r, 500));
    await send("Review Requested", scenarios["pr-review-requested"]);
    await new Promise((r) => setTimeout(r, 500));
    await send("PR Merged", scenarios["pr-merged"]);

    console.log("\n✅ Lifecycle simulation complete.");
    console.log(`   Check dashboard: ${BASE_URL}/`);
    console.log(`   Check events:    ${BASE_URL}/events`);
    return;
  }

  const scenario = scenarios[mode];
  if (!scenario) {
    console.error(`Unknown scenario: ${mode}`);
    console.log(`Available: ${Object.keys(scenarios).join(", ")}, lifecycle`);
    process.exit(1);
  }

  await send(mode, scenario);
}

run();

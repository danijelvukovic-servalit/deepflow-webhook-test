require("dotenv").config();
const express = require("express");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const {
  mapGitHubEventToDeepFlow,
  forwardToDeepFlow,
  EVENT_DATA_DIR,
} = require("./deepflow-client");

const app = express();
const PORT = process.env.PORT || 3000;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || "";

const LOGS_DIR = path.join(__dirname, "logs");
if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR);

const RESULTS_DIR = path.join(LOGS_DIR, "deepflow-results");
if (!fs.existsSync(RESULTS_DIR)) fs.mkdirSync(RESULTS_DIR, { recursive: true });

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  })
);

function verifySignature(req) {
  if (!WEBHOOK_SECRET) {
    console.log("⚠️  No WEBHOOK_SECRET set — skipping signature verification");
    return true;
  }

  const signature = req.headers["x-hub-signature-256"];
  if (!signature) {
    console.log("❌ No x-hub-signature-256 header present");
    return false;
  }

  const expected =
    "sha256=" +
    crypto
      .createHmac("sha256", WEBHOOK_SECRET)
      .update(req.rawBody)
      .digest("hex");

  const valid = crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expected)
  );

  if (!valid) console.log("❌ Signature mismatch");
  return valid;
}

function saveEvent(event, delivery, payload, deepflowResult) {
  const now = new Date().toISOString();
  const timestamp = now.replaceAll(":", "-").replaceAll(".", "-");
  const filename = `${timestamp}_${event}_${delivery || "unknown"}.json`;
  const filepath = path.join(LOGS_DIR, filename);

  const data = {
    received_at: now,
    event,
    delivery,
    payload,
    deepflow: deepflowResult || null,
  };

  fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
  return { filepath, filename };
}

function readEvents() {
  return fs
    .readdirSync(LOGS_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .reverse();
}

// ─── Dashboard ──────────────────────────────────────────────────────────────

app.get("/", (_req, res) => {
  const events = readEvents();
  const details = events.slice(0, 20).map((f) => {
    const data = JSON.parse(fs.readFileSync(path.join(LOGS_DIR, f), "utf-8"));
    return {
      file: f,
      event: data.event,
      action: data.payload?.action || null,
      delivery: data.delivery,
      received_at: data.received_at,
      sender: data.payload?.sender?.login || null,
      branch: data.deepflow?.mapping?.branch || null,
      deepflow_action: data.deepflow?.mapping?.deepflow_action || null,
      deepflow_forwarded: data.deepflow?.forward_result?.forwarded ?? false,
      deepflow_success: data.deepflow?.forward_result?.success ?? null,
    };
  });

  res.json({
    status: "ok",
    service: "GitHub → DeepFlow Webhook Bridge",
    events_received: events.length,
    recent_events: details,
  });
});

// ─── Events API ─────────────────────────────────────────────────────────────

app.get("/events", (_req, res) => {
  const events = readEvents();

  const details = events.slice(0, 50).map((f) => {
    const data = JSON.parse(fs.readFileSync(path.join(LOGS_DIR, f), "utf-8"));
    return {
      file: f,
      event: data.event,
      action: data.payload?.action || null,
      delivery: data.delivery,
      received_at: data.received_at,
      sender: data.payload?.sender?.login || null,
      deepflow: data.deepflow?.mapping
        ? {
            branch: data.deepflow.mapping.branch,
            action: data.deepflow.mapping.deepflow_action,
            target_stage: data.deepflow.mapping.target_stage,
            description: data.deepflow.mapping.description,
            forwarded: data.deepflow.forward_result?.forwarded ?? false,
          }
        : null,
    };
  });

  res.json({ total: events.length, events: details });
});

app.get("/events/:filename", (req, res) => {
  const filepath = path.join(LOGS_DIR, req.params.filename);
  if (!fs.existsSync(filepath)) {
    return res.status(404).json({ error: "Event not found" });
  }
  res.json(JSON.parse(fs.readFileSync(filepath, "utf-8")));
});

// ─── Hosted event data (DeepFlow downloads from here) ───────────────────────

app.get("/event-data/:id.json", (req, res) => {
  const filepath = path.join(EVENT_DATA_DIR, `${req.params.id}.json`);
  if (!fs.existsSync(filepath)) {
    return res.status(404).json({ error: "Event data not found" });
  }
  res.json(JSON.parse(fs.readFileSync(filepath, "utf-8")));
});

// ─── DeepFlow result receiver ───────────────────────────────────────────────

app.post("/deepflow-results", (req, res) => {
  const now = new Date().toISOString();
  const timestamp = now.replaceAll(":", "-").replaceAll(".", "-");
  const filename = `${timestamp}_result.json`;
  const filepath = path.join(RESULTS_DIR, filename);

  console.log(`\n${"─".repeat(60)}`);
  console.log(`📥 DeepFlow result received`);
  console.log(`   Time: ${new Date().toISOString()}`);
  console.log(`💾 Saved to: ${filename}`);

  fs.writeFileSync(
    filepath,
    JSON.stringify(
      { received_at: new Date().toISOString(), body: req.body },
      null,
      2
    )
  );

  res.status(200).json({ received: true });
});

app.get("/deepflow-results", (_req, res) => {
  const results = fs
    .readdirSync(RESULTS_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .reverse();

  const details = results.slice(0, 20).map((f) => {
    const data = JSON.parse(
      fs.readFileSync(path.join(RESULTS_DIR, f), "utf-8")
    );
    return { file: f, ...data };
  });

  res.json({ total: results.length, results: details });
});

// ─── GitHub Webhook Receiver ────────────────────────────────────────────────

function logMapping(mapping) {
  console.log(`\n   🔗 DeepFlow mapping:`);
  console.log(`      Branch: ${mapping.branch}`);
  console.log(`      Action: ${mapping.deepflow_action}`);
  if (mapping.target_stage) console.log(`      Target stage: ${mapping.target_stage}`);
  if (mapping.reviewers?.length) console.log(`      Reviewers: ${mapping.reviewers.join(", ")}`);
  if (mapping.requested_reviewer) console.log(`      Requested reviewer: ${mapping.requested_reviewer}`);
  console.log(`      → ${mapping.description}`);
}

function logForwardResult(result) {
  if (result.forwarded) {
    const status = result.success ? "OK" : "FAILED";
    console.log(`      Status: ${result.status} (${status})`);
    if (result.error) console.log(`      Error: ${result.error}`);
  } else {
    console.log(`      ⚠️  Not forwarded: ${result.reason}`);
  }
}

function logGenericEvent(event, body) {
  switch (event) {
    case "ping":
      console.log(`   Zen: "${body.zen}"`);
      console.log(`   Hook ID: ${body.hook_id}`);
      break;
    case "push":
      console.log(`   Ref: ${body.ref}`);
      console.log(`   Commits: ${body.commits?.length || 0}`);
      break;
    case "issues":
      console.log(`   Issue #${body.issue?.number}: ${body.issue?.title}`);
      break;
  }
}

function buildResponse(event, action, delivery, mapping) {
  return {
    received: true,
    event,
    action,
    delivery,
    deepflow: mapping
      ? {
          branch: mapping.branch,
          deepflow_action: mapping.deepflow_action,
          target_stage: mapping.target_stage || null,
          description: mapping.description,
        }
      : null,
  };
}

app.post("/webhook", async (req, res) => {
  const event = req.headers["x-github-event"] || "unknown";
  const delivery = req.headers["x-github-delivery"] || null;
  const action = req.body.action || null;

  console.log(`\n${"─".repeat(60)}`);
  console.log(`📨 Webhook received: ${event}` + (action ? ` / ${action}` : ""));
  console.log(`   Delivery: ${delivery}`);
  console.log(`   Time: ${new Date().toISOString()}`);

  if (!verifySignature(req)) {
    console.log("🚫 Rejected — invalid signature");
    return res.status(401).json({ error: "Invalid signature" });
  }

  console.log("✅ Signature verified");
  if (req.body.sender) console.log(`   Sender: ${req.body.sender.login}`);
  if (req.body.repository) console.log(`   Repo: ${req.body.repository.full_name}`);

  const deepflowResult = { mapping: null, forward_result: null };
  const mapping = mapGitHubEventToDeepFlow(event, action, req.body);

  if (mapping) {
    logMapping(mapping);
    deepflowResult.mapping = mapping;

    if (mapping.deepflow_action !== "info") {
      console.log(`\n   📤 Forwarding to DeepFlow...`);
      deepflowResult.forward_result = await forwardToDeepFlow(mapping);
      logForwardResult(deepflowResult.forward_result);
    }
  } else {
    logGenericEvent(event, req.body);
  }

  const { filename } = saveEvent(event, delivery, req.body, deepflowResult);
  console.log(`💾 Saved to: ${filename}`);

  res.status(200).json(buildResponse(event, action, delivery, mapping));
});

app.listen(PORT, "0.0.0.0", () => {
  const publicUrl = process.env.PUBLIC_BASE_URL;
  const base = publicUrl || `http://localhost:${PORT}`;
  console.log(`\n🚀 GitHub → DeepFlow Webhook Bridge`);
  console.log(`   Port:       ${PORT}`);
  console.log(`   Env:        ${process.env.NODE_ENV || "development"}`);
  console.log(`   Webhook:    ${base}/webhook`);
  console.log(`   Dashboard:  ${base}/`);
  console.log(`   Events:     ${base}/events`);
  console.log(`   DF Results: ${base}/deepflow-results`);
  console.log(
    `   Secret:     ${WEBHOOK_SECRET ? "configured ✅" : "not set ⚠️"}`
  );
  console.log(
    `   Public URL: ${publicUrl || "not set (DeepFlow forwarding will be dry-run only) ⚠️"}`
  );
  console.log(`\nListening for GitHub webhook events...\n`);
});

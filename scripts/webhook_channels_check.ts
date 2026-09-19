/**
 * Unit checks for src/lib/webhook-channels.ts — channel auto-detection and
 * per-channel payload shaping. Pure module, no database needed.
 * Run: bun scripts/webhook_channels_check.ts
 */
import {
  buildChannelPayload,
  detectWebhookChannel,
  isExternalChannel,
} from "../src/lib/webhook-channels";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, extra = "") {
  if (cond) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name} ${extra}`);
  }
}

// ---------------------------------------------------------------- detection
const cases: Array<[string, string]> = [
  ["https://discord.com/api/webhooks/123456/abcdef", "discord"],
  ["https://discordapp.com/api/webhooks/123456/abcdef", "discord"],
  ["https://discord.com/api/webhooks/123/abc?wait=true", "discord"],
  ["https://hooks.slack.com/services/T000/B000/xxxx", "slack"],
  ["https://hook.slack.com/services/T000/B000/xxxx", "slack"],
  ["https://example.webhook.office.com/webhookb2/abc", "teams"],
  ["https://example.webhook.office365.com/webhookb2/abc", "teams"],
  ["https://myhost.example.com/hook", "generic"],
  ["https://prod-05.westeurope.logic.azure.com/workflows/abc", "generic"],
  ["http://127.0.0.1:4788/discord/1/x", "generic"],
  ["", "generic"],
  ["not-a-url", "generic"],
  [undefined as unknown as string, "generic"],
];
for (const [url, expected] of cases) {
  const got = detectWebhookChannel(url);
  check(`detect(${url || "∅"}) -> ${expected}`, got === expected, `got ${got}`);
}

check(
  "external channels flagged",
  isExternalChannel("discord") && isExternalChannel("slack") && isExternalChannel("teams")
);
check("generic is not external", !isExternalChannel("generic"));

// ---------------------------------------------------------- payload shaping
const msg = {
  title: "LATE: Medical clearance over 240 min",
  lines: ["Room 201 (floor 2) — line two"],
  fields: { event: "alarm" },
};

const discord = buildChannelPayload("discord", msg) as {
  username: string;
  content: string;
  allowed_mentions: { parse: string[] };
};
check("discord payload has content", typeof discord.content === "string" && discord.content.length > 0);
check("discord payload bolds the title", discord.content.startsWith("**LATE: Medical clearance over 240 min**"));
check("discord payload sets username", discord.username === "DischargeFlow");
check(
  "discord payload disables mentions",
  Array.isArray(discord.allowed_mentions?.parse) && discord.allowed_mentions.parse.length === 0
);

const slack = buildChannelPayload("slack", msg) as { text: string } & Record<string, unknown>;
check("slack payload has text", typeof slack.text === "string" && slack.text.includes("Room 201"));
check("slack payload has no content key", !("content" in slack));

const teams = buildChannelPayload("teams", msg) as {
  type: string;
  attachments: Array<{ contentType: string; content: { body: Array<{ type: string }> } }>;
};
check("teams payload is a message", teams.type === "message");
check(
  "teams payload is an adaptive card",
  teams.attachments?.[0]?.contentType === "application/vnd.microsoft.card.adaptive"
);
check(
  "teams card body is TextBlocks",
  Array.isArray(teams.attachments?.[0]?.content?.body) &&
    teams.attachments[0].content.body.every((b) => b.type === "TextBlock")
);

const generic = buildChannelPayload("generic", msg) as Record<string, unknown>;
check("generic payload keeps structured fields", generic.event === "alarm");
check(
  "generic payload carries title + message",
  generic.title === msg.title && typeof generic.message === "string"
);

const long = buildChannelPayload("discord", {
  title: "x".repeat(100),
  lines: ["y".repeat(3000)],
}) as { content: string };
check("discord content truncated under limit", long.content.length <= 1900, long.content.length);

console.log(failed === 0 ? `\nALL ${passed} CHECKS PASS` : `\n${failed} FAILED / ${passed} passed`);
process.exit(failed === 0 ? 0 : 1);

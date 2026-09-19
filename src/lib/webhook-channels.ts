/**
 * DischargeFlow — outbound webhook channel adapters.
 *
 * A bare "POST our JSON" only works for receivers we control. Public IM
 * webhook endpoints each demand their own payload shape:
 *
 *   Discord  -> { "content": "..." }   (anything else: HTTP 400 "Cannot send
 *                                       an empty message", error 50006)
 *   Slack    -> { "text": "..." }      (incoming webhook format)
 *   Teams    -> Adaptive Card message  (Workflows / Office webhook)
 *   generic  -> full DischargeFlow JSON (self-hosted receivers, Power Automate
 *                                       HTTP triggers, ntfy-style bridges)
 *
 * The channel is auto-detected from the webhook URL, so an admin can paste a
 * Discord / Slack / Teams URL and it just works — no extra configuration.
 * Payloads to public IM channels are PHI-lite (no patient name, MRN or
 * physician — room/floor/stage timing is enough to act on the board) because
 * those services sit outside the hospital's BAA perimeter. Generic receivers
 * keep the full structured payload.
 */

export type WebhookChannel = "discord" | "slack" | "teams" | "generic";

export const WEBHOOK_CHANNELS: readonly WebhookChannel[] = [
  "discord",
  "slack",
  "teams",
  "generic",
] as const;

/** Auto-detect the channel from the webhook URL (hostname / path patterns). */
export function detectWebhookChannel(url: string | null | undefined): WebhookChannel {
  const u = (url ?? "").trim().toLowerCase();
  if (!u.startsWith("http://") && !u.startsWith("https://")) return "generic";
  if (u.includes("discord.com/api/webhooks/") || u.includes("discordapp.com/api/webhooks/")) {
    return "discord";
  }
  if (u.includes("hooks.slack.com/") || u.includes("hook.slack.com/")) return "slack";
  if (u.includes(".webhook.office.com") || u.includes(".webhook.office365.com")) {
    return "teams";
  }
  return "generic";
}

/** Public IM services — payloads to these are PHI-lite. */
export function isExternalChannel(channel: WebhookChannel): boolean {
  return channel !== "generic";
}

export const CHANNEL_META: Record<
  WebhookChannel,
  { label: string; badgeClass: string; hint: string }
> = {
  discord: {
    label: "Discord",
    badgeClass: "border-0 bg-indigo-100 text-indigo-700",
    hint:
      "URL recognized as Discord — messages are sent as formatted content with the DischargeFlow username. Patient identifiers stay off external IM channels.",
  },
  slack: {
    label: "Slack",
    badgeClass: "border-0 bg-purple-100 text-purple-700",
    hint:
      "URL recognized as Slack — messages are sent as text. Patient identifiers stay off external IM channels.",
  },
  teams: {
    label: "MS Teams",
    badgeClass: "border-0 bg-blue-100 text-blue-700",
    hint:
      "URL recognized as MS Teams — messages are sent as Adaptive Cards. Patient identifiers stay off external IM channels.",
  },
  generic: {
    label: "Generic",
    badgeClass: "border-0 bg-slate-100 text-slate-600",
    hint:
      "Receives the full DischargeFlow JSON payload (rule, patient, minutes in stage, task owners).",
  },
};

// ---------------------------------------------------------------------------
// Message -> channel payload
// ---------------------------------------------------------------------------

export interface WebhookMessage {
  title: string;
  /** Plain-text body lines, joined with newlines for text channels. */
  lines: string[];
  /** Structured extras merged into the generic JSON payload. */
  fields?: Record<string, unknown>;
}

/** Discord hard limit is 2000 chars per message — leave headroom for the title. */
const DISCORD_MAX = 1900;
const SLACK_MAX = 3500;

/** Shape a channel-agnostic message into the payload the channel expects. */
export function buildChannelPayload(
  channel: WebhookChannel,
  message: WebhookMessage
): Record<string, unknown> {
  const body = message.lines.join("\n");
  switch (channel) {
    case "discord":
      return {
        username: "DischargeFlow",
        content: `**${message.title}**\n${body}`.slice(0, DISCORD_MAX),
        allowed_mentions: { parse: [] as string[] },
      };
    case "slack":
      return { text: `*${message.title}*\n${body}`.slice(0, SLACK_MAX) };
    case "teams":
      return {
        type: "message",
        attachments: [
          {
            contentType: "application/vnd.microsoft.card.adaptive",
            content: {
              type: "AdaptiveCard",
              $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
              version: "1.4",
              body: [
                { type: "TextBlock", text: message.title, weight: "Bolder", wrap: true },
                ...(body ? [{ type: "TextBlock", text: body, wrap: true }] : []),
              ],
            },
          },
        ],
      };
    default:
      return { title: message.title, message: body, ...(message.fields ?? {}) };
  }
}

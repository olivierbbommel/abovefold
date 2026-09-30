import PostalMime from "postal-mime";

/*
 * Cloudflare Email Worker: the only way mail reaches abovefold.
 *
 * Many hosts block inbound port 25, so there is no SMTP daemon to run.
 * Cloudflare Email Routing accepts the message instead, hands it to this
 * Worker, and the Worker POSTs the parsed result to the instance's
 * /api/inbound-email (ABOVEFOLD_INBOUND_URL in wrangler.toml).
 *
 * Routing is catch-all: everything for the domain arrives here, and abovefold
 * decides whether the local part matches a real address. Mail for an unknown
 * address is dropped with a 200 so senders cannot probe which addresses exist.
 */

const MAX_BODY_BYTES = 400_000;

function clamp(value) {
  if (typeof value !== "string" || value.length === 0) return null;
  return value.length > MAX_BODY_BYTES ? value.slice(0, MAX_BODY_BYTES) : value;
}

export default {
  async email(message, env) {
    const parsed = await PostalMime.parse(message.raw);

    // message.to is the envelope recipient, which is the one that actually
    // routed here. Header To/Cc are included because list mail often rewrites
    // the envelope, and abovefold picks whichever lands on its own domain.
    const recipients = [
      message.to,
      ...(parsed.to ?? []).map((entry) => entry.address),
      ...(parsed.cc ?? []).map((entry) => entry.address),
    ].filter(Boolean);

    const payload = {
      to: recipients,
      from: parsed.from?.address ?? message.from ?? null,
      fromName: parsed.from?.name ?? null,
      subject: parsed.subject ?? null,
      html: clamp(parsed.html),
      text: clamp(parsed.text),
      messageId: parsed.messageId ?? null,
      date: parsed.date ?? null,
    };

    const response = await fetch(env.ABOVEFOLD_INBOUND_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Abovefold-Secret": env.ABOVEFOLD_INBOUND_SECRET,
      },
      body: JSON.stringify(payload),
    });

    // Throwing tells Cloudflare the delivery failed, and it retries. Only do
    // that for a genuine server-side failure, a 4xx means the message will
    // never be accepted and retrying just replays it.
    if (response.status >= 500) {
      throw new Error(`abovefold returned ${response.status}`);
    }
  },
};

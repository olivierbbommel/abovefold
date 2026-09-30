import { randomBytes } from "node:crypto";
import { publicUrl } from "./public-url";
import { pool } from "@/lib/db";

/*
 * Newsletters-as-feeds. See db/init/10-inbound-email.sql for why delivery
 * goes through a Cloudflare Email Worker rather than an SMTP daemon here.
 */

/** How many messages an address's generated feed exposes. */
export const FEED_WINDOW = 50;

/** Cap on stored HTML per message. Newsletters are big; runaway ones are bugs. */
export const MAX_HTML_BYTES = 400_000;

/*
 * Cap on stored issues per address.
 *
 * An inbound address is handed to a third party by design, so it will leak
 * eventually, and anyone holding one can mail it without limit. Message-ID is
 * attacker-controlled, so dedupe does not bound anything. Without this, a
 * single leaked address is unbounded growth in Postgres at up to ~800KB a
 * message. 200 issues is years of a weekly newsletter and roughly 160MB
 * worst case per address.
 */
export const MAX_STORED_PER_ADDRESS = 200;

export type MessageKind = "issue" | "admin";

export type InboundAddress = {
  id: number;
  token: string;
  label: string;
  minifluxFeedId: number | null;
  createdAt: Date;
  lastReceivedAt: Date | null;
  /** Messages actually stored, i.e. what the card can open. NOT a lifetime total. */
  messageCount: number;
  /** Most recent verification / welcome / confirmation mail, if any. */
  pendingAdmin: { id: number; subject: string; receivedAt: Date } | null;
};

/*
 * Verification and welcome mail is not an issue, and treating it as one put
 * "Gates Notes Resending Verification Link" in Today as if it were reading.
 * Subject only: bodies are noisy and a real issue can quote anything, but a
 * real issue's subject almost never reads like an account message. Kept
 * deliberately narrow; a miss here just means one admin mail shows as an
 * issue, which the user can mark read, whereas a false positive hides a
 * real issue. "Welcome" alone is NOT matched: some newsletters send a
 * substantive welcome issue.
 */
const ADMIN_SUBJECT = new RegExp(
  [
    // Not bare "verification": an essay titled "Why verification matters" is
    // an issue. It has to read like an account message.
    "\\bverify your\\b",
    "\\bverification (?:link|code|e-?mail|required|needed)\\b",
    "\\b(?:e-?mail|address|account)\\b.{0,20}\\bverif",
    "\\bverif\\w*\\b.{0,20}\\b(?:e-?mail|address|account)\\b",
    "\\bconfirm(?:ation)?\\b.{0,24}\\b(?:e-?mail|subscription|address|sign ?up|account)\\b",
    "\\bactivate your\\b",
    "\\bthank(?:s| you) for (?:subscribing|becoming|joining|signing up|confirming)\\b",
    "\\byou(?:'|\u2019)?re (?:now )?(?:subscribed|on the list)\\b",
    "\\byou are (?:now )?subscribed\\b",
    "\\bsubscription (?:is )?confirmed\\b",
    "\\bplease confirm\\b",
  ].join("|"),
  "i"
);

export function classifyMessage(subject: string): MessageKind {
  return ADMIN_SUBJECT.test(subject) ? "admin" : "issue";
}

export type InboundMessage = {
  id: number;
  messageId: string;
  subject: string;
  fromName: string | null;
  fromAddress: string | null;
  html: string | null;
  bodyText: string | null;
  sentAt: Date | null;
  receivedAt: Date;
};

/** The domain newsletter addresses live on. Newsletters need your own domain. */
export function inboundDomain(): string {
  const domain = process.env.ABOVEFOLD_INBOUND_DOMAIN;
  if (!domain) throw new Error("ABOVEFOLD_INBOUND_DOMAIN is not set: newsletters by email need your own domain (see docs/newsletters.md)");
  return domain;
}

export function addressFor(token: string): string {
  return `${token}@${inboundDomain()}`;
}

/**
 * `<slug>.<random>`, the slug so a glance at a signup form tells you which
 * newsletter an address belongs to, the random suffix so the address is not
 * guessable from the publication's name. 8 hex chars is 32 bits, which is
 * ample against an attacker who has to send email to probe it.
 */
export function mintToken(label: string): string {
  const slug =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 24) || "news";
  return `${slug}.${randomBytes(4).toString("hex")}`;
}

type AddressRow = {
  id: string;
  token: string;
  label: string;
  miniflux_feed_id: string | null;
  created_at: Date;
  last_received_at: Date | null;
  message_count: number;
  admin_id: string | null;
  admin_subject: string | null;
  admin_received_at: Date | null;
};

function mapAddress(row: AddressRow): InboundAddress {
  return {
    id: Number(row.id),
    token: row.token,
    label: row.label,
    minifluxFeedId: row.miniflux_feed_id === null ? null : Number(row.miniflux_feed_id),
    createdAt: row.created_at,
    lastReceivedAt: row.last_received_at,
    messageCount: row.message_count,
    pendingAdmin:
      row.admin_id !== null && row.admin_subject !== null && row.admin_received_at !== null
        ? { id: Number(row.admin_id), subject: row.admin_subject, receivedAt: row.admin_received_at }
        : null,
  };
}

const ADDRESS_COLUMNS = `id, token, label, miniflux_feed_id, created_at, last_received_at, message_count,
  null::bigint as admin_id, null::text as admin_subject, null::timestamptz as admin_received_at`;

/* The same columns, plus the newest admin message for the card. */
/*
 * message_count on the row is a LIFETIME total, which made the card claim
 * "2 received" for an address whose messages had all been dismissed, with
 * nothing to open. The card counts what is actually there.
 */
const ADDRESS_WITH_ADMIN = `
  a.id, a.token, a.label, a.miniflux_feed_id, a.created_at, a.last_received_at,
  (select count(*)::int from app.inbound_message im where im.address_id = a.id) as message_count,
  m.id as admin_id, m.subject as admin_subject, m.received_at as admin_received_at`;

export async function listAddresses(): Promise<InboundAddress[]> {
  const { rows } = await pool.query<AddressRow>(
    `select ${ADDRESS_WITH_ADMIN}
       from app.inbound_address a
       left join lateral (
         select id, subject, received_at from app.inbound_message
          where address_id = a.id and kind = 'admin'
          order by received_at desc limit 1
       ) m on true
      order by a.created_at desc`
  );
  return rows.map(mapAddress);
}

export async function addressByToken(token: string): Promise<InboundAddress | null> {
  const { rows } = await pool.query<AddressRow>(
    `select ${ADDRESS_COLUMNS} from app.inbound_address where token = $1`,
    [token]
  );
  return rows[0] ? mapAddress(rows[0]) : null;
}

export async function createAddress(label: string): Promise<InboundAddress> {
  const trimmed = label.trim().slice(0, 80) || "Newsletter";
  // Retry on the (vanishingly unlikely) token collision rather than surfacing
  // a unique-violation to the user.
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const { rows } = await pool.query<AddressRow>(
        `insert into app.inbound_address (token, label)
         values ($1, $2)
         returning ${ADDRESS_COLUMNS}`,
        [mintToken(trimmed), trimmed]
      );
      return mapAddress(rows[0]);
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code !== "23505" || attempt === 4) throw error;
    }
  }
  throw new Error("could not mint a unique inbound address");
}

/*
 * The feed of a newsletter was unfollowed (directly, or with its folder).
 * Its address would otherwise keep accepting mail and counting it on
 * Newsletters while no issue could ever appear again. Unfollow means stop,
 * so the address goes too (its stored messages cascade), and any
 * feed-based newsletter marking with it.
 */
export async function retireNewsletterFeeds(feedIds: number[]): Promise<number> {
  if (feedIds.length === 0) return 0;
  const { rowCount } = await pool.query(`delete from app.inbound_address where miniflux_feed_id = any($1)`, [feedIds]);
  await pool.query(`delete from app.newsletter_feed where miniflux_feed_id = any($1)`, [feedIds]);
  return rowCount ?? 0;
}

export async function attachFeed(addressId: number, minifluxFeedId: number): Promise<void> {
  await pool.query(`update app.inbound_address set miniflux_feed_id = $2 where id = $1`, [
    addressId,
    minifluxFeedId,
  ]);
}

export async function deleteAddress(token: string): Promise<InboundAddress | null> {
  console.log(`deleteAddress: token=${token} (cascades every stored message)`);
  const { rows } = await pool.query<AddressRow>(
    `delete from app.inbound_address where token = $1 returning ${ADDRESS_COLUMNS}`,
    [token]
  );
  return rows[0] ? mapAddress(rows[0]) : null;
}

export type IncomingMessage = {
  kind: MessageKind;
  messageId: string;
  subject: string;
  fromName: string | null;
  fromAddress: string | null;
  html: string | null;
  bodyText: string | null;
  sentAt: Date | null;
};

/** @returns true if stored, false if it was a duplicate Message-ID. */
export async function storeMessage(
  addressId: number,
  message: IncomingMessage
): Promise<boolean> {
  const { rowCount } = await pool.query(
    `insert into app.inbound_message
       (address_id, message_id, subject, from_name, from_address, html, body_text, sent_at, kind)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     on conflict (address_id, message_id) do nothing`,
    [
      addressId,
      message.messageId,
      message.subject,
      message.fromName,
      message.fromAddress,
      message.html,
      message.bodyText,
      message.sentAt,
      message.kind,
    ]
  );

  if (rowCount === 0) return false;

  await pool.query(
    `update app.inbound_address
        set last_received_at = now(), message_count = message_count + 1
      where id = $1`,
    [addressId]
  );

  // Drop anything past the cap, oldest first. message_count deliberately
  // stays a lifetime total rather than a row count: it is the honest answer
  // to "how much has this address received", and the pruned issues really
  // were delivered.
  await pool.query(
    `delete from app.inbound_message
      where address_id = $1
        and id not in (
          select id from app.inbound_message
           where address_id = $1
           order by coalesce(sent_at, received_at) desc
           limit $2
        )`,
    [addressId, MAX_STORED_PER_ADDRESS]
  );

  return true;
}

type MessageRow = {
  id: string;
  message_id: string;
  subject: string;
  from_name: string | null;
  from_address: string | null;
  html: string | null;
  body_text: string | null;
  sent_at: Date | null;
  received_at: Date;
};

export async function recentMessages(
  addressId: number,
  limit = FEED_WINDOW
): Promise<InboundMessage[]> {
  const { rows } = await pool.query<MessageRow>(
    `select id, message_id, subject, from_name, from_address, html, body_text, sent_at, received_at
       from app.inbound_message
      where address_id = $1 and kind = 'issue'
      order by coalesce(sent_at, received_at) desc
      limit $2`,
    [addressId, limit]
  );
  return rows.map((row) => ({
    id: Number(row.id),
    messageId: row.message_id,
    subject: row.subject,
    fromName: row.from_name,
    fromAddress: row.from_address,
    html: row.html,
    bodyText: row.body_text,
    sentAt: row.sent_at,
    receivedAt: row.received_at,
  }));
}

/**
 * Miniflux feed ids for every inbound address that has one.
 *
 * This is what makes a "Newsletters" view possible without a second storage
 * path: newsletters are ordinary feeds, so the view is just the ordinary
 * article query restricted to these ids.
 */
export async function newsletterFeedIds(): Promise<number[]> {
  const { rows } = await pool.query<{ miniflux_feed_id: string }>(
    `select miniflux_feed_id from app.inbound_address where miniflux_feed_id is not null
     union
     select miniflux_feed_id from app.newsletter_feed`
  );
  return rows.map((row) => Number(row.miniflux_feed_id));
}

export type NewsletterFeed = { feedId: number; title: string; categoryTitle: string; unread: number };

/** Feeds the user marked as newsletters that arrive by RSS rather than email. */
export async function listNewsletterFeeds(): Promise<number[]> {
  const { rows } = await pool.query<{ miniflux_feed_id: string }>(
    `select miniflux_feed_id from app.newsletter_feed order by added_at`
  );
  return rows.map((r) => Number(r.miniflux_feed_id));
}

export async function markFeedAsNewsletter(feedId: number): Promise<void> {
  await pool.query(
    `insert into app.newsletter_feed (miniflux_feed_id) values ($1) on conflict do nothing`,
    [feedId]
  );
}

export async function unmarkFeedAsNewsletter(feedId: number): Promise<boolean> {
  const { rowCount } = await pool.query(`delete from app.newsletter_feed where miniflux_feed_id = $1`, [feedId]);
  return (rowCount ?? 0) > 0;
}

export function publicBaseUrl(): string {
  return publicUrl();
}

/**
 * Remove one admin message (verification, welcome). Only admin: an issue has
 * an article behind it, and possibly interaction rows, and is never deleted
 * from here. Returns false if nothing matched, including an id that belongs
 * to a different address than the token names.
 */
export async function deleteAdminMessage(token: string, messageId: number): Promise<boolean> {
  // Logged because these messages are irreplaceable: a verification link
  // cannot be re-derived, and an issue's article URL points at the row.
  // Messages once went missing with no record of what removed them, which is
  // its own bug.
  console.log(`deleteAdminMessage: token=${token} id=${messageId}`);

  // Hide any article this message produced BEFORE deleting the message.
  // Two admin mails became articles before classification existed, and the
  // only thing keeping them out of the list used to be a query-time join
  // against this row. Dismiss deleted the row and both reappeared.
  await pool.query(
    `update app.article set hidden = true
      where url = $1 || '/newsletter/' || $2 || '/' || $3::text`,
    [publicBaseUrl(), token, messageId]
  );

  const { rowCount } = await pool.query(
    `delete from app.inbound_message m
      using app.inbound_address a
      where a.id = m.address_id and a.token = $1 and m.id = $2 and m.kind = 'admin'`,
    [token, messageId]
  );
  return (rowCount ?? 0) > 0;
}

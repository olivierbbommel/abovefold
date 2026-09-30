# Newsletters by email (optional)

Abovefold can give each newsletter its own email address, for example
`stratechery.1a2b3c4d@example.com`. Mail sent there becomes a story in your
reader, and the Newsletters section lists every issue. This is for newsletters
that have no RSS feed.

It needs **your own domain** on Cloudflare (the free plan is enough), because
mail arrives through Cloudflare Email Routing and a small Cloudflare Worker.
You do not need to run a mail server, and nothing on your server has to accept
mail on port 25. Everything else in Abovefold works without this.

## How it works

```
sender --> Cloudflare Email Routing (catch-all on your domain)
       --> Email Worker (workers/abovefold-email) parses the message
       --> POST https://<your instance>/api/inbound-email  (shared secret)
       --> stored, served back to Miniflux as a feed, shown in Newsletters
```

The part before the `@` contains a random token. Only addresses created in the
app are accepted; mail to any other address on the domain is silently dropped.
Treat the addresses like passwords: anyone who has one can send into that feed.

## Setup

1. **Set the two variables** in `.env` and restart (`docker compose up -d`):

   ```
   ABOVEFOLD_INBOUND_DOMAIN=example.com
   ABOVEFOLD_INBOUND_SECRET=<any long random string>
   ```

   `scripts/setup.sh` already generated the secret.

2. **Create a Cloudflare API token** at
   https://dash.cloudflare.com/profile/api-tokens with:
   - Account, Workers Scripts, Edit
   - Zone, Email Routing Rules, Edit (your domain)
   - Zone, Zone, Read (your domain)
   - Zone, DNS, Edit (your domain; Email Routing adds MX records)

3. **Enable Email Routing** for the domain in the Cloudflare dashboard (Email,
   Email Routing, Get started). It adds the MX and SPF records. If the domain
   already receives mail elsewhere, use a subdomain instead.

4. **Deploy the Worker:**

   ```bash
   cd workers/abovefold-email
   # set your instance's address in wrangler.toml (ABOVEFOLD_INBOUND_URL)
   export CLOUDFLARE_API_TOKEN=<token from step 2>
   npm install
   npx wrangler deploy
   npx wrangler secret put ABOVEFOLD_INBOUND_SECRET   # paste the value from .env
   ```

5. **Send everything to the Worker:** Email Routing, Routing rules, Catch-all
   address, action "Send to a Worker", choose `abovefold-email`, save.
   Catch-all means creating an address in the app needs no Cloudflare change.

## Using it

In Abovefold: Newsletters, Add newsletter (or Add a source, then "Follow by
email"). Name it, copy the address, and subscribe to the newsletter with it.
Confirmation emails are recognised and shown separately so you can click the
link.

## Checking it works

```bash
npx wrangler tail   # live log of deliveries, from workers/abovefold-email
```

To test the app side without Cloudflare, post what the Worker would send:

```bash
SECRET=$(grep '^ABOVEFOLD_INBOUND_SECRET=' .env | cut -d= -f2-)
curl -s -X POST http://127.0.0.1:8090/api/inbound-email \
  -H 'Content-Type: application/json' -H "X-Abovefold-Secret: $SECRET" \
  -d '{"to":["<address created in the app>"],"from":"a@b.com","subject":"Hello",
       "html":"<p>Body</p>","messageId":"<1@b.com>","date":"2026-01-01T00:00:00Z"}'
```

## Notes

- A 4xx answer is final and the Worker does not retry; only a 5xx makes
  Cloudflare try again.
- Bodies are limited to 400 KB, and each address keeps a bounded number of
  issues.
- Newsletter HTML is sanitised and its images are proxied, so opening an issue
  does not tell the sender you read it.

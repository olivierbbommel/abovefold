# Deploying

Abovefold runs as four Docker Compose services on one machine: Postgres with
pgvector, Miniflux (fetches feeds), a Python worker (extracts, embeds,
summarises, ranks) and the Next.js web app. A small VPS with 2 GB of RAM is
plenty for one reader.

## Install

```bash
git clone https://github.com/olivierbbommel/abovefold.git
cd abovefold
./scripts/setup.sh
```

`setup.sh` creates `.env` with generated secrets, asks for your OpenRouter key
and public URL, starts everything, mints the Miniflux API token and prints your
login password. Run it again at any time; it never overwrites a value you set.
Every setting is documented in [.env.example](../.env.example).

The web app listens on `127.0.0.1:8090` only (change with `ABOVEFOLD_PORT`). It
speaks plain HTTP, so never publish that port directly; put HTTPS in front.

## Putting it on the internet

Pick one.

**Cloudflare Tunnel** (no open ports, free):

```bash
cloudflared tunnel create abovefold
cloudflared tunnel route dns abovefold news.example.com
```

with an ingress rule pointing `news.example.com` at `http://127.0.0.1:8090` and
a catch-all `http_status:404`. Set `ABOVEFOLD_CLIENT_IP_HEADER=cf-connecting-ip`
so login throttling sees real client addresses.

**Caddy** (automatic HTTPS):

```
news.example.com {
    reverse_proxy 127.0.0.1:8090 {
        header_up X-Real-IP {remote_host}
    }
}
```

and set `ABOVEFOLD_CLIENT_IP_HEADER=x-real-ip`.

Only name a client IP header that your proxy always sets and overwrites. If it
is unset, all login attempts share one throttle, which is safe but coarse.

## Adding sources

Open the site, log in, and pick starter packs or paste an OPML export from
another reader. After that, the Add box takes a site name, a URL, `r/subreddit`,
a YouTube channel or `@handle`, or an email newsletter (see
[newsletters.md](newsletters.md)).

## Updating

```bash
git pull
docker compose up -d --build
```

Database migrations in `db/init` run on the first start only. When an update
adds a migration, apply it with:

```bash
docker compose exec -T db psql -U abovefold -d abovefold < db/init/<new file>.sql
```

## Backups

Everything worth keeping is in Postgres:

```bash
docker compose exec -T db pg_dump -U abovefold -d abovefold | gzip > abovefold-$(date +%F).sql.gz
```

`app.interaction` holds your reading history, which is what ranking learns
from. Back it up before anything risky.

## Costs

Summaries and embeddings go through OpenRouter. With the default models it is
roughly 2 US cents per 100 articles, so a few hundred articles a day is a few
dollars a month. `ABOVEFOLD_MONTHLY_COST_CAP_USD` (default 5) stops paid calls
for the rest of the month when reached; feeds keep updating either way.

## Reader apps

Miniflux's Fever and Google Reader APIs are proxied at `/v1` and
`/googlereader`, protected by the Miniflux admin account, so apps such as
Reeder or NetNewsWire can sync. Ranking and summaries are only in the web app.

## Troubleshooting

- `docker compose logs -f web worker` shows what each service is doing.
- A source stuck on "Not updating" is one Miniflux gave up on; the reason is
  shown on the source page. Many are sites that block automated requests.
- Nothing summarised: check the OpenRouter key and the monthly cap in the
  worker log line (`cost=` and `cap=`).

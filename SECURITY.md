# Security

## Reporting a vulnerability

Please do not open a public issue. Use GitHub's private vulnerability
reporting on this repository (Security, Report a vulnerability). I will
acknowledge within a few days.

## Design, in short

Abovefold is a single-user application. What it relies on:

- **One password, one session.** Every page and API route requires the session
  cookie except a short allowlist enforced in code (`web/middleware.ts`): the
  login page, the inbound-email endpoint (shared secret), newsletter issue
  pages (unguessable token) and Miniflux's own API paths (Miniflux auth). Login
  attempts are throttled.
- **Server-side fetches are guarded.** Every URL the server fetches for you
  (feed discovery, images, article extraction) goes through a guard that
  refuses private and loopback addresses, checks every redirect hop, pins the
  DNS answer it checked, and caps response size (`web/lib/safe-fetch.ts`,
  `worker/abovefold_worker/safe_fetch.py`).
- **Feeds and newsletters are untrusted.** Newsletter HTML is sanitised with an
  allowlist and its images are proxied, so opening an issue neither runs
  script nor tells the sender you read it. Images are never hotlinked and
  favicons are fetched server-side, so your subscription list does not leak to
  third parties.
- **Miniflux may fetch private addresses** (`FETCHER_ALLOW_PRIVATE_NETWORKS`),
  because it polls the app's own newsletter feeds over the Docker network. The
  app therefore vets every URL before handing it to Miniflux.

## Running it safely

- Keep port 8090 bound to 127.0.0.1 and put HTTPS in front
  ([docs/deploying.md](docs/deploying.md)).
- Use a long random password; `scripts/setup.sh` generates one.
- `.env` holds every secret. Keep it out of version control and readable only
  by you (`chmod 600 .env`).
- If you want a second gate, an access proxy such as Cloudflare Access works;
  exempt `/api/inbound-email` and `/newsletter/*` or newsletters stop arriving.

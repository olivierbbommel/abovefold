# abovefold-email

Cloudflare Email Worker that turns mail sent to an Abovefold newsletter
address into a story. Setup and background: [docs/newsletters.md](../../docs/newsletters.md).

- A 4xx from Abovefold is final and not retried; only a 5xx throws, which makes
  Cloudflare try again.
- Mail to an address that does not exist is accepted and dropped, so senders
  cannot probe which addresses are real.
- Bodies are clamped to 400 KB.

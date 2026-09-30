"""Worker entrypoint. `python -m abovefold_worker` loops; `--once` runs a single pass."""
from __future__ import annotations

import logging
import os
import sys
import time

from .config import Settings
from .miniflux import MinifluxClient
from .pipeline import Clients, rescore_all, run_once
from .store import PgStore, connect

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
log = logging.getLogger("abovefold")


# Any constant; it only has to be the same in every worker process.
PASS_LOCK_KEY = 0x6F6C6E73  # "olns"

# A full rescore when nothing new arrived still refreshes recency decay and
# reading-based relevance, but hourly is plenty for that.
RESCORE_EVERY_S = 3600
_last_rescore = 0.0


def _one_pass(settings: Settings) -> None:
    conn = connect(settings)
    try:
        # Two workers once ran side by side for three weeks: most articles were
        # summarised twice and the second bill never reached the cost cap.
        # A session advisory lock makes a second process skip the pass; it is
        # released when this connection closes, even if the pass crashes.
        with conn.cursor() as cur:
            cur.execute("select pg_try_advisory_lock(%s)", (PASS_LOCK_KEY,))
            (got,) = cur.fetchone()
        conn.commit()
        if not got:
            log.warning("another worker holds the pass lock; skipping this pass")
            return
        store = PgStore(conn)
        clients = Clients(miniflux=MinifluxClient(settings.miniflux_url, settings.miniflux_token))
        global _last_rescore
        due = time.monotonic() - _last_rescore >= RESCORE_EVERY_S
        report = run_once(store, clients, settings, rescore_due=due)
        if report.scored:
            _last_rescore = time.monotonic()
        log.info(
            "run fetched=%d skipped=%d archive=%d filtered=%d embedded=%d clustered=%d "
            "summarised=%d scored=%d cost=$%.4f cap=%s errors=%d",
            report.fetched, report.skipped_existing, report.skipped_archive, report.prefiltered_out,
            report.embedded, report.clustered, report.summarised, report.scored,
            report.cost_usd, report.cap_reached, len(report.errors),
        )
        for err in report.errors[:10]:
            log.warning("  %s", err)
    finally:
        conn.close()


def _rescore(settings: Settings) -> None:
    conn = connect(settings)
    try:
        n = rescore_all(PgStore(conn))
        log.info("rescored %d articles (no API spend)", n)
    finally:
        conn.close()


def main() -> int:
    settings = Settings.from_env(os.environ)
    if "--rescore" in sys.argv:
        _rescore(settings)
        return 0
    once = "--once" in sys.argv
    while True:
        try:
            _one_pass(settings)
        except Exception:
            log.exception("run failed")   # the loop must never die
        if once:
            return 0
        time.sleep(settings.poll_seconds)


if __name__ == "__main__":
    raise SystemExit(main())

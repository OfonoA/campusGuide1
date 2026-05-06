"""Seed script that runs the crawler once and ingests its URLs."""
import argparse
import json
import logging
import os
import sys
from dataclasses import asdict
from pathlib import Path
from typing import Dict, List, Optional, Set

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.scraper.crawler import CrawlConnectivityError, MUSTCrawler
from app.scraper.ingest_web import WebIngestionService
from app.scraper.scheduler import HIGH_CHURN_URLS, MEDIUM_CHURN_URLS, LOW_CHURN_URLS
from database.database import SessionLocal
from database.orm_models import WatchedURL

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("must.scraper.initial_crawl")
DEFAULT_BATCH_SIZE = 25
DEFAULT_CHECKPOINT_PATH = Path(__file__).resolve().parents[1] / "crawl_checkpoint.json"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run the MUST web crawler once.")
    parser.add_argument("--max-pages", type=int, default=1200)
    parser.add_argument("--batch-size", type=int, default=DEFAULT_BATCH_SIZE)
    parser.add_argument("--checkpoint-path", type=Path, default=DEFAULT_CHECKPOINT_PATH)
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def ingest_urls(session, urls: List[str]):
    service = WebIngestionService(session)
    return service.ingest_batch(urls)


def seed_watched_urls(session, urls: List[str], frequency: int, label_prefix: str):
    for url in urls:
        existing = session.query(WatchedURL).filter(WatchedURL.url == url).first()
        if existing:
            existing.frequency_hours = frequency
            existing.label = existing.label or f"{label_prefix}"
            existing.is_active = True
        else:
            session.add(
                WatchedURL(
                    url=url,
                    label=label_prefix,
                    frequency_hours=frequency,
                    created_by="system",
                )
            )
    session.commit()


def load_checkpoint(path: Path) -> Optional[Dict]:
    if not path.exists():
        return None
    with path.open("r", encoding="utf-8") as fh:
        return json.load(fh)


def save_checkpoint(
    path: Path,
    crawler: MUSTCrawler,
    pending_ingest: List[str],
    processed_urls: Set[str],
    failed_urls: Dict[str, str],
    stats: Dict[str, int],
    crawl_completed: bool,
    watched_urls_seeded: bool,
) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    crawler_state = asdict(crawler.get_state())
    payload = {
        "version": 1,
        "crawler": crawler_state,
        "pending_ingest": pending_ingest,
        "processed_urls": sorted(processed_urls),
        "failed_urls": dict(sorted(failed_urls.items())),
        "stats": stats,
        "crawl_completed": crawl_completed,
        "watched_urls_seeded": watched_urls_seeded,
    }
    temp_path = path.with_suffix(path.suffix + ".tmp")
    with temp_path.open("w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=2, sort_keys=True)
    temp_path.replace(path)


def remove_checkpoint(path: Path) -> None:
    if path.exists():
        path.unlink()


def normalize_checkpoint_urls(crawler: MUSTCrawler, urls: List[str]) -> List[str]:
    normalized: List[str] = []
    seen: Set[str] = set()
    for url in urls:
        cleaned = crawler._normalize_url(url) or url
        if cleaned in seen:
            continue
        normalized.append(cleaned)
        seen.add(cleaned)
    return normalized


def main() -> None:
    args = parse_args()
    if args.batch_size < 1:
        raise SystemExit("--batch-size must be at least 1")

    checkpoint_path = args.checkpoint_path.resolve()

    with SessionLocal() as session:
        crawler = MUSTCrawler(session, max_pages=args.max_pages)
        pending_ingest: List[str] = []
        pending_lookup: Set[str] = set()
        processed_urls: Set[str] = set()
        failed_urls: Dict[str, str] = {}
        stats = {"discovered_html": 0, "discovered_pdf": 0, "batches_flushed": 0}
        crawl_completed = False
        watched_urls_seeded = False
        ingested_total = 0
        skipped_total = 0
        failed_total = 0

        if args.resume:
            checkpoint = load_checkpoint(checkpoint_path)
            if checkpoint:
                crawler.load_state(checkpoint.get("crawler", {}))
                pending_ingest = normalize_checkpoint_urls(crawler, list(checkpoint.get("pending_ingest", [])))
                pending_lookup = set(pending_ingest)
                processed_urls = set(checkpoint.get("processed_urls", []))
                failed_urls = {
                    crawler._normalize_url(url) or url: error
                    for url, error in dict(checkpoint.get("failed_urls", {})).items()
                }
                stats.update(checkpoint.get("stats", {}))
                crawl_completed = bool(checkpoint.get("crawl_completed", False))
                watched_urls_seeded = bool(checkpoint.get("watched_urls_seeded", False))
                logger.info("Resuming crawl from checkpoint: %s", checkpoint_path)
            else:
                logger.info("No checkpoint found at %s; starting fresh", checkpoint_path)
        else:
            remove_checkpoint(checkpoint_path)

        def persist() -> None:
            save_checkpoint(
                checkpoint_path,
                crawler,
                pending_ingest,
                processed_urls,
                failed_urls,
                stats,
                crawl_completed,
                watched_urls_seeded,
            )

        def flush_pending() -> None:
            nonlocal pending_ingest, pending_lookup
            nonlocal ingested_total, skipped_total, failed_total
            if not pending_ingest:
                return

            batch = list(pending_ingest)
            if args.dry_run:
                for url in batch:
                    print(url)
                    processed_urls.add(url)
                    failed_urls.pop(url, None)
                pending_ingest = []
                pending_lookup = set()
            else:
                result = ingest_urls(session, batch)
                # accumulate global counters
                ingested_total += result.ingested
                skipped_total += result.skipped
                failed_total += result.failed
                failed_map = {url: error for url, error in result.errors}
                retry_urls: List[str] = []
                for url in batch:
                    if url in failed_map:
                        failed_urls[url] = failed_map[url]
                        retry_urls.append(url)
                        continue
                    processed_urls.add(url)
                    failed_urls.pop(url, None)
                pending_ingest = retry_urls
                pending_lookup = set(retry_urls)
                logger.info(
                    "Flushed batch of %d URLs (ingested=%d skipped=%d failed=%d retrying=%d)",
                    len(batch),
                    result.ingested,
                    result.skipped,
                    result.failed,
                    len(retry_urls),
                )

            stats["batches_flushed"] += 1
            persist()

        if pending_ingest:
            logger.info("Resuming with %d pending URLs queued for ingestion", len(pending_ingest))
            flush_pending()

        try:
            if not crawl_completed:
                for batch in crawler.iter_discovered_batches():
                    for kind, url in batch:
                        if kind == "html":
                            stats["discovered_html"] += 1
                        else:
                            stats["discovered_pdf"] += 1

                        if url in processed_urls or url in pending_lookup:
                            continue

                        pending_ingest.append(url)
                        pending_lookup.add(url)

                    persist()

                    if len(pending_ingest) >= args.batch_size:
                        flush_pending()
                crawl_completed = True
                persist()
        except CrawlConnectivityError as exc:
            logger.error(str(exc))
            raise SystemExit(1) from exc

        flush_pending()
        logger.info(
            "Discovered %d HTML pages and %d PDFs",
            stats["discovered_html"],
            stats["discovered_pdf"],
        )
        # Summary and completion message
        total_duration = None
        try:
            # if batches were tracked, compute a total approximate duration from DB or checkpoint stats
            # fallback: we don't have a main timer here; provide counts instead
            logger.info(
                "Crawl summary: ingested=%d skipped=%d failed=%d batches=%d",
                ingested_total,
                skipped_total,
                failed_total,
                stats.get("batches_flushed", 0),
            )
        except Exception:
            pass
        if args.dry_run:
            logger.info("Dry run complete. Checkpoint retained at %s", checkpoint_path)
            return

        if pending_ingest:
            logger.warning(
                "Crawl finished with %d URLs still pending ingestion retry. Resume with --resume.",
                len(pending_ingest),
            )
            raise SystemExit(1)

        if not watched_urls_seeded:
            seed_watched_urls(session, HIGH_CHURN_URLS, 6, "tier1")
            seed_watched_urls(session, MEDIUM_CHURN_URLS, 24, "tier2")
            seed_watched_urls(session, LOW_CHURN_URLS, 168, "tier3")
            watched_urls_seeded = True
            persist()
        logger.info("Initial crawl complete. Watched URLs seeded.")
        remove_checkpoint(checkpoint_path)


if __name__ == "__main__":
    main()

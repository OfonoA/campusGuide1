"""APScheduler jobs for periodic web scraping."""
import logging
from datetime import datetime, timedelta
from typing import List

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.interval import IntervalTrigger
from app.scraper.ingest_web import WebIngestionService
from database.database import SessionLocal
from database.orm_models import WatchedURL

logger = logging.getLogger("must.scraper.scheduler")

HIGH_CHURN_URLS = [
    "https://www.must.ac.ug/notice-board/",
    "https://www.must.ac.ug/news/",
    "https://www.must.ac.ug/announcement_type/call-for-applications/",
    "https://www.must.ac.ug/announcement_type/scholarship-opportunities/",
    "https://www.must.ac.ug/admission-lists/",
    "https://www.must.ac.ug/academic-calendar/",
]

MEDIUM_CHURN_URLS = [
    "https://www.must.ac.ug/study-at-must/admissions/application-guidelines/",
    "https://www.must.ac.ug/undergraduate-programmes/",
    "https://www.must.ac.ug/graduate-programmes/",
    "https://www.must.ac.ug/about-us/governance/university-policies/",
    "https://www.must.ac.ug/university_unit/faculty-of-medicine/",
    "https://www.must.ac.ug/university_unit/faculty-of-computing-and-informatics/",
    "https://www.must.ac.ug/university_unit/faculty-of-science/",
    "https://www.must.ac.ug/university_unit/faculty-of-applied-sciences-and-technology/",
    "https://www.must.ac.ug/university_unit/faculty-of-business-and-management-sciences/",
    "https://www.must.ac.ug/university_unit/faculty-of-interdisciplinary-studies/",
    "https://www.must.ac.ug/university_unit/maternal-newborn-and-child-health-institute/",
    "https://www.must.ac.ug/university_unit/institute-of-tropical-forest-conservation/",
    "https://profiles.must.ac.ug/academic-staff/",
    "https://profiles.must.ac.ug/administrative-staff/",
    "https://vle.must.ac.ug/course/index.php",
]

LOW_CHURN_URLS = [
    "https://www.must.ac.ug/about-us/about-must/history/",
    "https://www.must.ac.ug/about-us/about-must/vision-and-mission/",
    "https://www.must.ac.ug/about-us/about-must/facts-figures/",
    "https://www.must.ac.ug/about-us/governance/the-chancellor/",
    "https://www.must.ac.ug/about-us/governance/the-vice-chancellor/",
    "https://www.must.ac.ug/about-us/governance/university-management/",
    "https://www.must.ac.ug/about-us/governance/annual-reports/",
    "https://www.must.ac.ug/research-and-innovation/collaboration-and-partnership/",
    "https://www.must.ac.ug/institutions-that-must-has-mous-with/",
    "https://www.must.ac.ug/downloads/MBARARA%20UNIVERSITY%20OF%20SCIENCE%20AND%20TECHNOLOGY%20STATUTE%201989.pdf",
    "https://www.must.ac.ug/download/university-council-charter/",
]

scheduler = BackgroundScheduler(timezone="UTC")


def _run_job(urls: List[str]) -> None:
    logger.info("Starting scheduled crawl for %d URLs", len(urls))
    with SessionLocal() as session:
        service = WebIngestionService(session)
        try:
            service.ingest_batch(urls)
        except Exception as exc:
            logger.exception("Scheduled ingestion job failed: %s", exc)


def scrape_tier1_urls() -> None:
    """Runs every 24 hours for high churn content."""
    try:
        _run_job(HIGH_CHURN_URLS)
    except Exception as exc:
        logger.exception("Tier1 job failed: %s", exc)


def scrape_tier2_urls() -> None:
    """Runs every 24 hours for medium churn content."""
    try:
        _run_job(MEDIUM_CHURN_URLS)
    except Exception as exc:
        logger.exception("Tier2 job failed: %s", exc)


def scrape_tier3_urls() -> None:
    """Runs every 7 days for low churn content plus watched URLs."""
    urls = list(LOW_CHURN_URLS)
    with SessionLocal() as session:
        now = datetime.utcnow()
        watches = (
            session.query(WatchedURL)
            .filter(WatchedURL.is_active.is_(True))
            .all()
        )
        for watch in watches:
            threshold = watch.last_scraped_at or datetime.min
            if watch.last_scraped_at and now < threshold + timedelta(hours=watch.frequency_hours):
                continue
            urls.append(watch.url)
            watch.last_scraped_at = now
        session.commit()
    try:
        _run_job(urls)
    except Exception as exc:
        logger.exception("Tier3 job failed: %s", exc)


def start_scheduler(app_state) -> None:
    """Initialize and start the scraping scheduler."""
    if scheduler.running:
        return
    scheduler.add_job(
        scrape_tier1_urls,
        trigger=IntervalTrigger(hours=24),
        id="scrape_tier1",
        max_instances=1,
        coalesce=True,
    )
    scheduler.add_job(
        scrape_tier2_urls,
        trigger=IntervalTrigger(hours=24),
        id="scrape_tier2",
        max_instances=1,
        coalesce=True,
    )
    scheduler.add_job(
        scrape_tier3_urls,
        trigger=IntervalTrigger(days=7),
        id="scrape_tier3",
        max_instances=1,
        coalesce=True,
    )
    scheduler.start()
    app_state.scraper_scheduler = scheduler
    logger.info("Scraper scheduler started")


def stop_scheduler(app_state) -> None:
    """Gracefully stop the scheduler."""
    sched = getattr(app_state, "scraper_scheduler", None)
    if sched and sched.running:
        sched.shutdown(wait=False)
        logger.info("Scraper scheduler stopped")

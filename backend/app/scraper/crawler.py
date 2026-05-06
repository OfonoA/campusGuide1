"""BFS crawler for must.ac.ug pages and PDFs."""
import logging
import random
import re
import time
from collections import deque
from dataclasses import dataclass
from typing import Any, Deque, Dict, Iterator, List, Optional, Set, Tuple
from urllib.parse import urljoin, urlparse, urldefrag

import requests
from bs4 import BeautifulSoup
from requests.adapters import HTTPAdapter, Retry

SEED_URLS = ["https://www.must.ac.ug/", "https://profiles.must.ac.ug"]
ALLOWED_DOMAINS = {"www.must.ac.ug", "profiles.must.ac.ug", "vle.must.ac.ug"}
SKIP_DOMAINS = {
    "applications.must.ac.ug",
    "student.must.ac.ug",
    "timetable.must.ac.ug",
    "elearning.must.ac.ug",
    "grants.must.ac.ug",
    "ir.must.ac.ug",
    "pharmbiotrac.must.ac.ug",
    "misa.must.ac.ug",
    "lms.must.ac.ug",
}
MAX_PAGES = 1200
MAX_DEPTH = 7
CRAWL_DELAY_SECONDS = 1.5
REQUEST_TIMEOUT = 15
USER_AGENT = "MUSTRagBot/1.0 (university internal search assistant)"

HIGH_PRIORITY_PATTERNS = [
    "/notice-board/",
    "/announcement",
    "/news/",
    "/admission-lists/",
    "/academic-calendar/",
    "/announcement_type/call-for-applications/",
    "/announcement_type/scholarship-opportunities/",
    "/undergraduate-programmes/",
    "/graduate-programmes/",
]

PAGINATED_PATTERNS = ["/news/page/", "/notice-board/page/"]
DOWNLOAD_PATH_DUPLICATION_RE = re.compile(r"(/downloads/policies)+/", re.IGNORECASE)
logger = logging.getLogger("must.scraper.crawler")


@dataclass
class CrawlResult:
    html_urls: List[str]
    pdf_urls: List[str]


class CrawlConnectivityError(RuntimeError):
    """Raised when the crawler cannot reach any configured seed URL."""


@dataclass
class CrawlState:
    queue: List[Tuple[str, int]]
    visited: List[str]
    pdf_seen: List[str]
    html_count: int
    seed_failures: Dict[str, str]


class MUSTCrawler:
    """Breadth-first crawler that discovers HTML and PDF URLs."""

    def __init__(
        self,
        db_session,
        max_pages: int = MAX_PAGES,
        max_depth: int = MAX_DEPTH,
        seed_urls: Optional[List[str]] = None,
    ) -> None:
        self.db_session = db_session
        self.max_pages = max_pages
        self.max_depth = max_depth
        self.seed_urls = seed_urls or SEED_URLS
        self.session = self._build_session()
        self.visited: Set[str] = set()
        self.pdf_seen: Set[str] = set()
        self.seed_failures: Dict[str, str] = {}
        self.html_count = 0
        self.queue: Deque[Tuple[str, int]] = deque()
        self._initialized = False

    def _build_session(self) -> requests.Session:
        session = requests.Session()
        retries = Retry(
            total=3,
            connect=0,
            read=0,
            other=0,
            redirect=0,
            status=3,
            backoff_factor=0.3,
            status_forcelist=[429, 500, 502, 503, 504],
            allowed_methods=["GET", "HEAD"],
        )
        adapter = HTTPAdapter(max_retries=retries)
        session.mount("https://", adapter)
        session.mount("http://", adapter)
        session.headers.update({"User-Agent": USER_AGENT})
        return session

    def _initialize_state(self) -> None:
        if self._initialized:
            return
        self.queue = deque((seed, 0) for seed in self.seed_urls)
        self.visited = set()
        self.pdf_seen = set()
        self.seed_failures = {}
        self.html_count = 0
        self._initialized = True

    def get_state(self) -> CrawlState:
        self._initialize_state()
        return CrawlState(
            queue=list(self.queue),
            visited=sorted(self.visited),
            pdf_seen=sorted(self.pdf_seen),
            html_count=self.html_count,
            seed_failures=dict(self.seed_failures),
        )

    def load_state(self, state: CrawlState | Dict[str, Any]) -> None:
        if isinstance(state, dict):
            state = CrawlState(
                queue=[(item[0], int(item[1])) for item in state.get("queue", [])],
                visited=list(state.get("visited", [])),
                pdf_seen=list(state.get("pdf_seen", [])),
                html_count=int(state.get("html_count", 0)),
                seed_failures=dict(state.get("seed_failures", {})),
            )
        self.queue = deque((url, depth) for url, depth in state.queue)
        self.visited = set(state.visited)
        self.pdf_seen = set(state.pdf_seen)
        self.html_count = state.html_count
        self.seed_failures = dict(state.seed_failures)
        self._initialized = True

    def crawl(self) -> Tuple[List[str], List[str]]:
        """Run BFS crawl, returning html and pdf URLs."""
        html_urls: List[str] = []
        pdf_urls: List[str] = []
        for batch in self.iter_discovered_batches():
            for kind, url in batch:
                if kind == "html":
                    html_urls.append(url)
                else:
                    pdf_urls.append(url)
        return html_urls, pdf_urls

    def iter_discovered_batches(self) -> Iterator[List[Tuple[str, str]]]:
        self._initialize_state()

        while self.queue and self.html_count < self.max_pages:
            url, depth = self.queue.popleft()
            normalized = self._normalize_url(url)
            if normalized in self.visited:
                continue
            if not self._is_allowed(normalized, depth):
                continue

            response, error = self._fetch(normalized)
            if response is None:
                if depth == 0 and error:
                    self.seed_failures[normalized] = error
                continue

            self.seed_failures.pop(normalized, None)
            self.visited.add(normalized)
            self.html_count += 1
            discovered_batch: List[Tuple[str, str]] = [("html", normalized)]
            internal_links, new_pdfs = self._extract_links(response.text, normalized)
            for pdf in new_pdfs:
                if pdf not in self.pdf_seen:
                    self.pdf_seen.add(pdf)
                    discovered_batch.append(("pdf", pdf))
            for link in internal_links:
                if self.html_count + len(self.queue) >= self.max_pages:
                    break
                if link in self.visited:
                    continue
                if any(pat in link for pat in PAGINATED_PATTERNS):
                    self.queue.append((link, depth + 1))
                elif any(pat in link for pat in HIGH_PRIORITY_PATTERNS):
                    self.queue.appendleft((link, depth + 1))
                else:
                    self.queue.append((link, depth + 1))
            if depth >= self.max_depth:
                yield discovered_batch
                continue
            self._delay()
            yield discovered_batch

        if self.html_count == 0 and self.seed_failures:
            details = "; ".join(f"{url}: {message}" for url, message in self.seed_failures.items())
            raise CrawlConnectivityError(
                "Unable to reach any crawl seed URL. "
                "Check internet access, DNS, firewall/proxy settings, or try again later. "
                f"Seed failures: {details}"
            )

    def iter_discovered_urls(self) -> Iterator[Tuple[str, str]]:
        for batch in self.iter_discovered_batches():
            for item in batch:
                yield item

    def _is_allowed(self, url: str, depth: int) -> bool:
        if depth > self.max_depth:
            return False
        parsed = urlparse(url)
        domain = parsed.netloc.lower()
        if not domain:
            return False
        if domain in SKIP_DOMAINS:
            return False
        if domain not in ALLOWED_DOMAINS:
            return False
        if any(domain.endswith(skip) for skip in SKIP_DOMAINS):
            return False
        if domain == "vle.must.ac.ug" and not parsed.path.startswith("/course/"):
            return False
        if parsed.scheme not in {"http", "https"}:
            return False
        if url.split("?")[0].lower().endswith(tuple([".jpg", ".jpeg", ".png", ".mp4", ".zip"])):
            return False
        return True

    def _extract_links(self, html: str, base_url: str) -> Tuple[List[str], List[str]]:
        soup = BeautifulSoup(html, "html.parser")
        internal_html: List[str] = []
        pdf_links: List[str] = []

        for anchor in soup.find_all("a", href=True):
            href = anchor["href"]
            if href.startswith("mailto:") or href.startswith("tel:") or href.startswith("javascript:"):
                continue
            resolved = urljoin(base_url, href)
            cleaned = self._normalize_url(resolved)
            if not cleaned:
                continue
            if cleaned in self.visited:
                continue
            if self._is_pdf_link(cleaned):
                pdf_links.append(cleaned)
                continue
            if not self._is_allowed(cleaned, 0):
                continue
            internal_html.append(cleaned)
        return internal_html, pdf_links

    def _is_pdf_link(self, url: str) -> bool:
        if url.lower().endswith(".pdf"):
            return True
        try:
            headers = self.session.head(url, timeout=REQUEST_TIMEOUT, allow_redirects=True).headers
        except Exception as exc:  # pragma: no cover
            logger.debug("Skipping HEAD for %s: %s", url, exc)
            return False
        content_type = headers.get("Content-Type", "").lower()
        return "application/pdf" in content_type

    def _fetch(self, url: str) -> Tuple[Optional[requests.Response], Optional[str]]:
        logger.info("Fetching URL: %s", url)
        try:
            response = self.session.get(url, timeout=REQUEST_TIMEOUT)
            if response.status_code != 200:
                logger.warning("Skipping %s: status %s", url, response.status_code)
                return None, f"status {response.status_code}"
            return response, None
        except requests.RequestException as exc:
            logger.warning("Failed to fetch %s: %s", url, exc)
            return None, str(exc)

    def _normalize_url(self, url: str) -> str:
        parsed = urlparse(url)
        if not parsed.scheme or not parsed.netloc:
            return ""
        scheme = parsed.scheme
        netloc = parsed.netloc.lower()
        path = parsed.path or "/"
        path = self._dedupe_known_path_segments(path)
        if path.endswith("/") and path != "/":
            path = path.rstrip("/")
        normalized = urljoin(f"{scheme}://{netloc}", path)
        return urldefrag(normalized)[0]

    def _dedupe_known_path_segments(self, path: str) -> str:
        if "/downloads/policies/downloads/policies/" in path.lower():
            return DOWNLOAD_PATH_DUPLICATION_RE.sub("/downloads/policies/", path, count=1)
        return path

    def _delay(self) -> None:
        jitter = random.uniform(0, 0.5)
        time.sleep(CRAWL_DELAY_SECONDS + jitter)

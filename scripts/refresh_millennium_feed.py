#!/usr/bin/env python3
"""Build a small research feed for the Millennium atlas.

The site is static, so this script runs in GitHub Actions and writes a JSON
snapshot that the browser can fetch without CORS or API keys.
"""

from __future__ import annotations

import html
import json
import os
import re
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "data" / "millennium-feed.json"
OPENAI_RSS = "https://openai.com/news/rss.xml"
CLAY_RSS = "https://www.claymath.org/news/feed/"
ARXIV_API = "https://export.arxiv.org/api/query"
USER_AGENT = "YuchengLu-profile/1.0 (+https://yllllllllllll.github.io/)"
ATOM = {"a": "http://www.w3.org/2005/Atom"}
SCHEMA_VERSION = 2
ARXIV_RESULTS = 2
PROBLEM_ITEM_LIMIT = 4
WIRE_LIMIT = 3
RECENT_WINDOW_DAYS = 730


PROBLEMS = {
    "pnp": {
        "name": "P vs NP",
        "arxiv": 'all:"P vs NP" OR all:"P versus NP" OR all:"computational complexity"',
        "exact": ["p vs np", "p versus np", "p = np", "p not equal np"],
    },
    "riemann": {
        "name": "Riemann Hypothesis",
        "arxiv": 'all:"Riemann hypothesis" OR all:"Riemann zeta function"',
        "exact": ["riemann hypothesis", "riemann zeta"],
    },
    "yangmills": {
        "name": "Yang-Mills & Mass Gap",
        "arxiv": 'all:"Yang-Mills" AND all:"mass gap"',
        "exact": ["yang mills", "mass gap"],
    },
    "navier": {
        "name": "Navier-Stokes",
        "arxiv": 'all:"Navier-Stokes" AND (all:regularity OR all:singularity OR all:turbulence)',
        "exact": ["navier stokes"],
    },
    "hodge": {
        "name": "Hodge Conjecture",
        "arxiv": 'all:"Hodge conjecture"',
        "exact": ["hodge conjecture"],
    },
    "bsd": {
        "name": "Birch-Swinnerton-Dyer",
        "arxiv": 'all:"Birch-Swinnerton-Dyer" OR all:"Birch and Swinnerton-Dyer"',
        "exact": ["birch swinnerton dyer", "birch and swinnerton dyer"],
    },
    "poincare": {
        "name": "Poincare Conjecture",
        "arxiv": 'all:"Poincare conjecture" OR all:"Poincaré conjecture" OR all:"geometrization conjecture"',
        "exact": ["poincare conjecture", "geometrization conjecture", "perelman"],
    },
}

OPENAI_WIRE_TERMS = [
    "mathematics",
    "mathematical",
    "theoretical computer science",
    "open problem",
    "millennium prize",
    "formal proof",
    "lean proof",
    "proof formalization",
    "proof assistant",
    "discrete geometry",
    "number theory",
    "quantum computing",
    "quantum experiment",
    "navier stokes",
    "riemann",
    "yang mills",
    "hodge",
    "poincare",
    "birch swinnerton dyer",
]


def request_text(url: str, attempts: int = 3, timeout: int = 20) -> str:
    request = urllib.request.Request(
        url,
        headers={"User-Agent": USER_AGENT, "Accept-Encoding": "identity"},
    )
    last_error: Exception | None = None
    for attempt in range(attempts):
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return response.read().decode("utf-8", errors="replace")
        except (urllib.error.URLError, TimeoutError, ConnectionError) as error:
            last_error = error
            if attempt < attempts - 1:
                time.sleep(3 * (attempt + 1))
    raise RuntimeError(f"Unable to fetch {url}: {last_error}")


def clean_text(value: str | None, limit: int = 360) -> str:
    if not value:
        return ""
    text = re.sub(r"<[^>]+>", " ", value)
    text = html.unescape(html.unescape(text))
    text = re.sub(r"\s+", " ", text).strip()
    return text[:limit].rstrip()


def iso_date(value: str | None) -> str | None:
    if not value:
        return None
    try:
        parsed = parsedate_to_datetime(value)
    except (TypeError, ValueError):
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def normalize_text(value: str) -> str:
    """Normalize prose for phrase matching, including en/em dashes and accents."""
    text = re.sub(r"[\u2010-\u2015\u2212-]", " ", value or "")
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii")
    return " ".join(re.findall(r"[a-z0-9]+", text.lower()))


def searchable_text(item: dict) -> str:
    return normalize_text(
        " ".join(
            [
                item.get("title", ""),
                item.get("summary", ""),
                " ".join(item.get("tags", [])),
            ]
        )
    )


def has_phrase(text: str, phrases: list[str]) -> bool:
    return any(normalize_text(phrase) in text for phrase in phrases)


def is_openai_wire_item(item: dict) -> bool:
    return has_phrase(searchable_text(item), OPENAI_WIRE_TERMS)


def openai_topic(item: dict) -> str:
    text = searchable_text(item)
    if has_phrase(text, ["navier stokes", "riemann", "yang mills", "hodge", "poincare", "birch swinnerton dyer", "millennium prize"]):
        return "Millennium"
    if has_phrase(text, ["quantum"]):
        return "Quantum"
    if has_phrase(text, ["discrete geometry"]):
        return "Geometry"
    return "Mathematics"


def is_recent(item: dict, now: datetime) -> bool:
    value = item.get("published")
    if not value:
        return False
    try:
        published = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return False
    return now - published <= timedelta(days=RECENT_WINDOW_DAYS)


def parse_rss(xml_text: str, source: str) -> list[dict]:
    root = ET.fromstring(xml_text)
    channel = root.find("channel")
    if channel is None:
        return []
    items = []
    for item in channel.findall("item"):
        title = clean_text(item.findtext("title"), 180)
        link = (item.findtext("link") or "").strip()
        published = iso_date(item.findtext("pubDate"))
        if not title or not link:
            continue
        categories = [clean_text(node.text, 50) for node in item.findall("category") if node.text]
        items.append(
            {
                "source": source,
                "title": title,
                "url": link,
                "published": published,
                "summary": clean_text(item.findtext("description")),
                "tags": categories,
            }
        )
    return items


def parse_arxiv(xml_text: str, problem: str) -> list[dict]:
    root = ET.fromstring(xml_text)
    items = []
    for entry in root.findall("a:entry", ATOM):
        title = clean_text(entry.findtext("a:title", namespaces=ATOM), 220)
        link = ""
        for node in entry.findall("a:link", ATOM):
            if node.attrib.get("rel") == "alternate":
                link = node.attrib.get("href", "")
                break
        if not link:
            link = entry.findtext("a:id", namespaces=ATOM) or ""
        published = iso_date(entry.findtext("a:published", namespaces=ATOM))
        if not title or not link:
            continue
        authors = [
            clean_text(node.findtext("a:name", namespaces=ATOM), 80)
            for node in entry.findall("a:author", ATOM)
            if node.findtext("a:name", namespaces=ATOM)
        ][:3]
        categories = [node.attrib.get("term", "") for node in entry.findall("a:category", ATOM)]
        items.append(
            {
                "source": "arxiv",
                "problem": problem,
                "title": title,
                "url": link,
                "published": published,
                "summary": clean_text(entry.findtext("a:summary", namespaces=ATOM), 320),
                "authors": authors,
                "tags": [category for category in categories if category][:4],
            }
        )
    return items


def exact_problem_match(item: dict, problem: dict) -> bool:
    return has_phrase(searchable_text(item), problem["exact"])


def tagged(item: dict, kind: str) -> dict:
    result = {key: value for key, value in item.items() if key != "problem"}
    result["kind"] = kind
    return result


def newest(items: list[dict]) -> list[dict]:
    return sorted(items, key=lambda item: item.get("published") or "", reverse=True)


def main() -> None:
    now = datetime.now(timezone.utc).replace(microsecond=0)
    generated_at = now.isoformat().replace("+00:00", "Z")
    source_status: dict[str, dict] = {}
    previous: dict = {}
    if OUTPUT.exists():
        try:
            previous = json.loads(OUTPUT.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            previous = {}

    openai_items: list[dict] = []
    clay_items: list[dict] = []
    arxiv_by_problem: dict[str, list[dict]] = {}

    try:
        openai_items = newest(parse_rss(request_text(OPENAI_RSS), "openai"))
        source_status["openai"] = {"ok": True, "count": len(openai_items)}
    except Exception as error:  # keep the feed alive if one source is down
        source_status["openai"] = {"ok": False, "count": 0, "error": str(error)[:240]}

    try:
        clay_items = newest(parse_rss(request_text(CLAY_RSS), "clay"))
        source_status["clay"] = {"ok": True, "count": len(clay_items)}
    except Exception as error:
        source_status["clay"] = {"ok": False, "count": 0, "error": str(error)[:240]}

    arxiv_failures: list[str] = []
    arxiv_reused: list[str] = []
    arxiv_count = 0
    skip_arxiv = os.environ.get("FEED_SKIP_ARXIV", "").strip().lower() in {"1", "true", "yes"}
    for index, (key, problem) in enumerate(PROBLEMS.items()):
        if index and not skip_arxiv:
            time.sleep(3)
        previous_papers = [
            item
            for item in previous.get("problems", {}).get(key, {}).get("items", [])
            if item.get("source") == "arxiv"
        ]
        if skip_arxiv:
            arxiv_by_problem[key] = newest(previous_papers)[:ARXIV_RESULTS]
            if arxiv_by_problem[key]:
                arxiv_reused.append(key)
                arxiv_count += len(arxiv_by_problem[key])
            continue
        query = urllib.parse.urlencode(
            {
                "search_query": problem["arxiv"],
                "sortBy": "submittedDate",
                "sortOrder": "descending",
                "max_results": ARXIV_RESULTS,
            }
        )
        try:
            arxiv_by_problem[key] = newest(
                parse_arxiv(request_text(f"{ARXIV_API}?{query}", attempts=2, timeout=15), key)
            )
            arxiv_count += len(arxiv_by_problem[key])
        except Exception as error:
            arxiv_by_problem[key] = newest(previous_papers)[:ARXIV_RESULTS]
            if arxiv_by_problem[key]:
                arxiv_reused.append(key)
                arxiv_count += len(arxiv_by_problem[key])
            arxiv_failures.append(f"{key}: {str(error)[:120]}")

    source_status["arxiv"] = {"ok": arxiv_count > 0, "count": arxiv_count}
    if arxiv_failures:
        source_status["arxiv"]["partial"] = True
        source_status["arxiv"]["failures"] = arxiv_failures
    if arxiv_reused:
        source_status["arxiv"]["reused_from_previous"] = arxiv_reused

    if not openai_items and not clay_items and arxiv_count == 0:
        raise SystemExit("All research sources failed; keeping the previous snapshot")

    problems: dict[str, dict] = {}
    for key, problem in PROBLEMS.items():
        direct_openai = newest(
            [item for item in openai_items if is_recent(item, now) and exact_problem_match(item, problem)]
        )[:1]
        direct_clay = newest(
            [item for item in clay_items if is_recent(item, now) and exact_problem_match(item, problem)]
        )[:1]
        papers = arxiv_by_problem.get(key, [])[:ARXIV_RESULTS]
        official = [tagged(item, "official") for item in direct_openai + direct_clay]
        paper_items = [tagged(item, "paper") for item in papers]
        items = newest(official + paper_items)[:PROBLEM_ITEM_LIMIT]
        problems[key] = {
            "name": problem["name"],
            "items": items,
            "source_counts": {
                "openai": sum(1 for item in items if item["source"] == "openai"),
                "clay": sum(1 for item in items if item["source"] == "clay"),
                "arxiv": sum(1 for item in items if item["source"] == "arxiv"),
            },
            "openai_exact": bool(direct_openai),
        }

    wire = newest(
        [item for item in openai_items if is_recent(item, now) and is_openai_wire_item(item)]
    )[:WIRE_LIMIT]
    wire = [{**tagged(item, "official"), "topic": openai_topic(item)} for item in wire]

    payload = {
        "schema_version": SCHEMA_VERSION,
        "generated_at": generated_at,
        "refresh_hours": 6,
        "sources": source_status,
        "wire": wire,
        "problems": problems,
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    temporary = OUTPUT.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(OUTPUT)
    print(f"Wrote {OUTPUT.relative_to(ROOT)}")
    print(f"Wire: {len(wire)} OpenAI items · Problems: {len(problems)}")
    print(json.dumps(source_status, indent=2))


if __name__ == "__main__":
    main()

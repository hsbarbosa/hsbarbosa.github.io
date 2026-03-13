#!/usr/bin/env python3
"""Build data/auto/stats.json from Semantic Scholar + ORCID."""

from __future__ import annotations

import json
import os
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen


SEMANTIC_SCHOLAR_AUTHOR_ID = os.getenv("S2_AUTHOR_ID", "144447784")
ORCID_ID = os.getenv("ORCID_ID", "0000-0002-3927-969X")
OPENALEX_AUTHOR_ID = os.getenv("OPENALEX_AUTHOR_ID", "A5068497573")
RECENT_YEAR_WINDOW = int(os.getenv("RECENT_YEAR_WINDOW", "5"))
S2_MAX_PAPERS = int(os.getenv("S2_MAX_PAPERS", "1000"))
OUTPUT_PATH = Path("data/auto/stats.json")
S2_API_KEY = os.getenv("S2_API_KEY", "").strip()
SMALL_TITLE_WORDS = {
    "a",
    "an",
    "and",
    "as",
    "at",
    "but",
    "by",
    "for",
    "from",
    "in",
    "into",
    "nor",
    "of",
    "on",
    "or",
    "per",
    "the",
    "to",
    "via",
    "with",
}
TITLE_ACRONYMS = {
    "ai": "AI",
    "covid": "COVID",
    "covid-19": "COVID-19",
    "dna": "DNA",
    "eu": "EU",
    "gis": "GIS",
    "gps": "GPS",
    "ml": "ML",
    "rna": "RNA",
    "sars-cov-2": "SARS-CoV-2",
    "uk": "UK",
    "usa": "USA",
}


def fetch_json(url: str, accept: str = "application/json") -> dict:
    headers = {
        "Accept": accept,
        "User-Agent": "hsbarbosa.github.io-stats-fetch/1.0",
    }
    if S2_API_KEY and "api.semanticscholar.org" in url:
        headers["x-api-key"] = S2_API_KEY

    req = Request(url, headers=headers)
    try:
        with urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except (HTTPError, URLError, TimeoutError) as exc:
        raise RuntimeError(f"Failed to fetch {url}: {exc}") from exc


def fetch_s2_author_with_retry() -> dict:
    url = (
        f"https://api.semanticscholar.org/graph/v1/author/{SEMANTIC_SCHOLAR_AUTHOR_ID}"
        "?fields=name,citationCount,hIndex,paperCount"
    )
    delay = 12
    for attempt in range(1, 6):
        payload = fetch_json(url)
        paper_count = payload.get("paperCount")
        if paper_count is not None:
            return payload
        if attempt < 5:
            time.sleep(delay)
    return payload


def fetch_s2_author_papers() -> dict:
    url = (
        f"https://api.semanticscholar.org/graph/v1/author/{SEMANTIC_SCHOLAR_AUTHOR_ID}/papers"
        f"?fields=influentialCitationCount,authors,title,year,paperId&limit={S2_MAX_PAPERS}"
    )
    return fetch_json(url)


def fetch_openalex_author() -> dict:
    return fetch_json(f"https://api.openalex.org/authors/{OPENALEX_AUTHOR_ID}")


def decode_openalex_inverted_index(index_obj: dict | None) -> str:
    if not isinstance(index_obj, dict):
        return ""
    positioned = []
    for word, positions in index_obj.items():
        if not isinstance(positions, list):
            continue
        for pos in positions:
            if isinstance(pos, int):
                positioned.append((pos, word))
    positioned.sort(key=lambda item: item[0])
    return " ".join(word for _, word in positioned).strip()


def fetch_openalex_top_publications(limit: int = 5) -> list[dict]:
    url = (
        "https://api.openalex.org/works"
        f"?filter=author.id:{OPENALEX_AUTHOR_ID},has_doi:true"
        f"&sort=cited_by_count:desc&per-page={limit}"
    )
    payload = fetch_json(url)
    results = payload.get("results") or []
    top = []
    for work in results:
        doi_url = work.get("doi")
        doi_value = None
        if isinstance(doi_url, str) and doi_url:
            doi_value = doi_url.replace("https://doi.org/", "").strip()

        authorships = work.get("authorships") or []
        authors = []
        for authorship in authorships:
            name = ((authorship.get("author") or {}).get("display_name") or "").strip()
            if name:
                authors.append(name)

        venue = (
            ((work.get("primary_location") or {}).get("source") or {}).get("display_name")
            or ""
        )
        abstract = decode_openalex_inverted_index(work.get("abstract_inverted_index"))
        top.append(
            {
                "year": work.get("publication_year"),
                "title": work.get("display_name") or "Untitled",
                "authors": authors,
                "venue": venue,
                "doiValue": doi_value,
                "doiUrl": doi_url if isinstance(doi_url, str) else None,
                "citationCount": work.get("cited_by_count"),
                "abstract": abstract or None,
            }
        )
    return top


def fetch_openalex_work_for_doi(doi_value: str) -> dict | None:
    doi_norm = (doi_value or "").strip().lower()
    if not doi_norm:
        return None
    oa_url = (
        "https://api.openalex.org/works"
        f"?filter=doi:{quote(doi_norm, safe='')}&per-page=1"
    )
    try:
        payload = fetch_json(oa_url)
    except RuntimeError:
        return None
    results = payload.get("results") or []
    if not results:
        return None
    return results[0]


def normalize_text(value: str) -> str:
    return " ".join((value or "").split()).strip()


def looks_all_caps_title(value: str) -> bool:
    letters = [char for char in value if char.isalpha()]
    return bool(letters) and all(char.isupper() for char in letters)


def format_title_piece(piece: str, force_capitalize: bool) -> str:
    lower = piece.lower()
    if lower in TITLE_ACRONYMS:
        return TITLE_ACRONYMS[lower]
    if lower in SMALL_TITLE_WORDS and not force_capitalize:
        return lower
    return lower[:1].upper() + lower[1:]


def title_case_token(token: str, force_capitalize: bool) -> str:
    match = re.match(r"^([^A-Za-z0-9]*)(.*?)([^A-Za-z0-9]*)$", token)
    if not match:
        return token
    prefix, core, suffix = match.groups()
    if not core:
        return token

    parts = re.split(r"([/-])", core)
    rendered = []
    part_force_capitalize = force_capitalize
    for part in parts:
        if part in {"-", "/"}:
            rendered.append(part)
            part_force_capitalize = True
            continue
        rendered.append(format_title_piece(part, part_force_capitalize))
        part_force_capitalize = False
    return prefix + "".join(rendered) + suffix


def normalize_title(value: str) -> str:
    title = normalize_text(value)
    if not looks_all_caps_title(title):
        return title

    tokens = re.split(r"(\s+)", title)
    rendered = []
    force_capitalize = True
    for token in tokens:
        if not token:
            continue
        if token.isspace():
            rendered.append(token)
            continue
        rendered_token = title_case_token(token, force_capitalize)
        rendered.append(rendered_token)
        force_capitalize = rendered_token.rstrip().endswith(":")
    return "".join(rendered)


def fetch_openalex_citation_for_doi(doi_value: str) -> int | None:
    work = fetch_openalex_work_for_doi(doi_value)
    if not work:
        return None
    return work.get("cited_by_count")


def best_int(*values: int | None) -> int | None:
    ints = [v for v in values if isinstance(v, int)]
    return max(ints) if ints else None


def year_from_orcid_summary(summary: dict) -> int:
    pub_date = summary.get("publication-date") or {}
    year_obj = pub_date.get("year") or {}
    value = year_obj.get("value")
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def get_external_id(full_work: dict, ext_type: str) -> str:
    ids = (full_work.get("external-ids") or {}).get("external-id", [])
    for item in ids:
        if (item.get("external-id-type") or "").lower() == ext_type.lower():
            return item.get("external-id-value") or ""
    return ""


def label_work_type(work_type: str) -> str:
    labels = {
        "conference-paper": "Conference Paper",
        "conference-abstract": "Conference Abstract",
        "conference-poster": "Conference Poster",
        "book-chapter": "Book Chapter",
        "book": "Book",
        "edited-book": "Edited Book",
        "report": "Report",
        "preprint": "Preprint",
        "dissertation": "Dissertation",
        "journal-article": "",
    }
    return labels.get(work_type, work_type.replace("-", " ").title())


def enrich_orcid_recent_works(
    recent_groups: list[dict], doi_citation_cache: dict[str, int | None]
) -> list[dict]:
    enriched = []
    doi_work_cache: dict[str, dict | None] = {}
    for group in recent_groups:
        summary = (group.get("work-summary") or [{}])[0]
        put_code = summary.get("put-code")
        if put_code is None:
            continue

        detail_url = f"https://pub.orcid.org/v3.0/{ORCID_ID}/work/{put_code}"
        try:
            full = fetch_json(detail_url)
        except RuntimeError:
            continue

        title = normalize_title(
            ((full.get("title") or {}).get("title") or {}).get("value")
            or "Untitled"
        )
        work_type = full.get("type") or ""
        venue = (
            ((full.get("journal-title") or {}).get("value") or "")
            or label_work_type(work_type)
        )

        contributors = (full.get("contributors") or {}).get("contributor", [])
        authors = []
        for contributor in contributors:
            attrs = contributor.get("contributor-attributes") or {}
            role = attrs.get("contributor-role", "author")
            if role != "author" and contributor.get("contributor-attributes"):
                continue
            name = ((contributor.get("credit-name") or {}).get("value") or "").strip()
            if name:
                authors.append(name)

        doi_value = get_external_id(full, "doi")
        if doi_value:
            doi_value = doi_value.replace("https://doi.org/", "").strip()
        doi_url = (
            f"https://doi.org/{doi_value}"
            if doi_value
            else ((full.get("url") or {}).get("value") or None)
        )

        citation_count = None
        abstract = normalize_text(full.get("short-description") or "")
        if doi_value:
            doi_key = doi_value.lower()
            if doi_key not in doi_work_cache:
                doi_work_cache[doi_key] = fetch_openalex_work_for_doi(doi_value)
                time.sleep(0.15)
            oa_work = doi_work_cache[doi_key]
            if oa_work:
                oa_title = normalize_text(oa_work.get("display_name") or "")
                if oa_title:
                    title = oa_title

            doi_quoted = quote(doi_value, safe="")
            s2_url = (
                "https://api.semanticscholar.org/graph/v1/paper/DOI:"
                f"{doi_quoted}?fields=citationCount,abstract"
            )
            try:
                s2_paper = fetch_json(s2_url)
                citation_count = s2_paper.get("citationCount")
                s2_abstract = normalize_text(s2_paper.get("abstract") or "")
                if s2_abstract:
                    abstract = s2_abstract
            except RuntimeError:
                citation_count = None
            time.sleep(0.35)
            if citation_count is None:
                if doi_key not in doi_citation_cache:
                    doi_citation_cache[doi_key] = fetch_openalex_citation_for_doi(
                        doi_value
                    )
                    time.sleep(0.15)
                citation_count = doi_citation_cache[doi_key]

        enriched.append(
            {
                "year": summary.get("publication-date", {})
                .get("year", {})
                .get("value", "Unknown"),
                "title": title,
                "authors": authors,
                "venue": venue,
                "doiValue": doi_value or None,
                "doiUrl": doi_url,
                "citationCount": citation_count,
                "abstract": abstract or None,
            }
        )
        time.sleep(0.2)

    return enriched


def build_stats() -> dict:
    s2_author = fetch_s2_author_with_retry()
    s2_papers = fetch_s2_author_papers()
    try:
        oa_author = fetch_openalex_author()
    except RuntimeError:
        oa_author = {}
    influential = sum(
        (paper.get("influentialCitationCount") or 0)
        for paper in (s2_papers.get("data") or [])
    )
    top_publications = fetch_openalex_top_publications(limit=5)

    orcid_works = fetch_json(
        f"https://pub.orcid.org/v3.0/{ORCID_ID}/works",
        accept="application/json",
    )

    current_year = datetime.now(timezone.utc).year
    min_year = current_year - (RECENT_YEAR_WINDOW - 1)

    groups = orcid_works.get("group") or []
    recent_groups = []
    for group in groups:
        summary = (group.get("work-summary") or [{}])[0]
        if year_from_orcid_summary(summary) >= min_year:
            recent_groups.append(group)

    doi_citation_cache: dict[str, int | None] = {}
    publications = enrich_orcid_recent_works(recent_groups, doi_citation_cache)
    publications.sort(
        key=lambda p: (
            int(p.get("year")) if str(p.get("year", "")).isdigit() else 0,
            p.get("citationCount") or -1,
        ),
        reverse=True,
    )

    return {
        "updated": datetime.now(timezone.utc).isoformat(),
        "source": "semantic-scholar+orcid+openalex-fallback",
        "author": {
            "name": s2_author.get("name") or "Hugo Barbosa",
            "semanticScholarAuthorId": SEMANTIC_SCHOLAR_AUTHOR_ID,
            "orcid": ORCID_ID,
            "openAlexAuthorId": OPENALEX_AUTHOR_ID,
        },
        "stats": {
            "paperCount": best_int(
                s2_author.get("paperCount"), oa_author.get("works_count")
            ),
            "hIndex": best_int(
                s2_author.get("hIndex"),
                (oa_author.get("summary_stats") or {}).get("h_index"),
            ),
            "citationCount": best_int(
                s2_author.get("citationCount"), oa_author.get("cited_by_count")
            ),
            "i10Index": best_int(
                (oa_author.get("summary_stats") or {}).get("i10_index")
            ),
            "influentialCitationCount": influential,
        },
        "publications": publications,
        "topPublications": top_publications,
    }


def main() -> int:
    payload = build_stats()
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(
        "Wrote "
        f"{OUTPUT_PATH} with {len(payload.get('publications') or [])} publications."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())

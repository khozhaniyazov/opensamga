from __future__ import annotations

import re
from collections.abc import Iterable

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import MajorGroup

_MAJOR_CODE_RE = re.compile(r"^[A-Za-z]\d{3}$")

_IT_MAJOR_HINTS = (
    "айти",
    "айтишк",
    "информац",
    "информат",
    "программ",
    "computer science",
)


def _normalize_raw_values(raw_values: Iterable[object] | object) -> list[str]:
    if isinstance(raw_values, (str, bytes)):
        values = [raw_values]
    else:
        try:
            values = list(raw_values)  # type: ignore[arg-type]
        except TypeError:
            values = [raw_values]

    normalized: list[str] = []
    seen: set[str] = set()
    for raw in values:
        text = str(raw or "").strip()
        if not text:
            continue
        key = text.casefold()
        if key in seen:
            continue
        seen.add(key)
        normalized.append(text)
    return normalized


def looks_like_major_code(value: str | None) -> bool:
    return bool(value and _MAJOR_CODE_RE.fullmatch(value.strip()))


def normalize_major_code(value: str) -> str:
    return value.strip().upper()


def _contains_it_major_hint(value: str) -> bool:
    lowered = value.casefold()
    if (
        re.search(r"\bit\b", lowered)
        or re.search(r"\bcs\b", lowered)
        or re.search(r"\bит\b", lowered)
    ):
        return True
    return any(hint in lowered for hint in _IT_MAJOR_HINTS)


def expand_major_search_terms(raw_values: Iterable[object] | object) -> list[str]:
    base_values = _normalize_raw_values(raw_values)
    terms: list[str] = []
    seen: set[str] = set()

    def add(term: str) -> None:
        cleaned = term.strip()
        if not cleaned:
            return
        key = cleaned.casefold()
        if key in seen:
            return
        seen.add(key)
        terms.append(cleaned)

    for value in base_values:
        add(value)
        if _contains_it_major_hint(value):
            add("информационные технологии")
            add("информатика")
            add("computer science")
            add("it")

    return terms


async def resolve_major_codes(
    db: AsyncSession,
    raw_values: Iterable[object] | object,
) -> list[str]:
    terms = expand_major_search_terms(raw_values)
    if not terms:
        return []

    resolved_codes: list[str] = []
    seen_codes: set[str] = set()

    def add_code(code: str | None) -> None:
        if not code:
            return
        normalized = normalize_major_code(code)
        if normalized in seen_codes:
            return
        seen_codes.add(normalized)
        resolved_codes.append(normalized)

    for term in terms:
        if looks_like_major_code(term):
            add_code(term)

    conditions = []
    for term in terms:
        lowered = term.casefold()
        if looks_like_major_code(term):
            conditions.append(func.upper(MajorGroup.group_code) == normalize_major_code(term))
        conditions.append(func.lower(MajorGroup.group_name).contains(lowered))
        conditions.append(
            func.lower(func.coalesce(MajorGroup.search_keywords, "")).contains(lowered)
        )

    if conditions:
        query = select(MajorGroup).where(or_(*conditions)).limit(20)
        result = await db.execute(query)
        for group in result.scalars().all():
            add_code(group.group_code)

    return resolved_codes


async def resolve_major_titles(
    db: AsyncSession,
    raw_values: Iterable[object] | object,
) -> list[str]:
    raw_items = _normalize_raw_values(raw_values)
    if not raw_items:
        return []

    resolved_codes = await resolve_major_codes(db, raw_items)
    groups_by_code: dict[str, MajorGroup] = {}

    if resolved_codes:
        result = await db.execute(
            select(MajorGroup).where(
                or_(*[func.upper(MajorGroup.group_code) == code for code in resolved_codes])
            )
        )
        groups_by_code = {
            normalize_major_code(group.group_code): group for group in result.scalars().all()
        }

    titles: list[str] = []
    seen: set[str] = set()
    for code in resolved_codes:
        group = groups_by_code.get(code)
        if not group:
            continue
        label = f"{code} — {group.group_name}"
        if label.casefold() in seen:
            continue
        seen.add(label.casefold())
        titles.append(label)

    for raw in raw_items:
        if looks_like_major_code(raw) and normalize_major_code(raw) in groups_by_code:
            continue
        if raw.casefold() in seen:
            continue
        seen.add(raw.casefold())
        titles.append(raw)

    return titles

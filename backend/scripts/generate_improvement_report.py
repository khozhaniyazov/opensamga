"""
Generate Improvement Report from Failed Queries

This script analyzes the FailedQuery table and generates a Markdown report
summarizing:
- Top Missing Data issues
- Top Retrieval Bugs
- Suggested fixes
"""

import asyncio
import sys
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlalchemy import desc
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.future import select
from sqlalchemy.orm import sessionmaker

from app.database import DATABASE_URL
from app.models import FailedQuery, FailedQueryStatus, FailureReason

# Create async engine
engine = create_async_engine(DATABASE_URL, echo=False)
AsyncSessionLocal = sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


async def generate_report(output_path: str = None):
    """
    Generate improvement report from failed queries.
    """
    async with AsyncSessionLocal() as db:
        # Get all analyzed failed queries
        query = (
            select(FailedQuery)
            .where(FailedQuery.status == FailedQueryStatus.ANALYZED)
            .order_by(desc(FailedQuery.timestamp))
        )

        result = await db.execute(query)
        failed_queries = result.scalars().all()

        if not failed_queries:
            print("No analyzed failed queries found. Run analyze_failed_queries first.")
            return

        # Statistics
        total_queries = len(failed_queries)
        by_reason = Counter()
        missing_data_queries = []
        retrieval_bug_queries = []
        ambiguous_queries = []

        # Group queries by reason
        for fq in failed_queries:
            by_reason[fq.failure_reason.value if fq.failure_reason else "UNKNOWN"] += 1

            if fq.failure_reason == FailureReason.MISSING_DATA:
                missing_data_queries.append(fq)
            elif fq.failure_reason == FailureReason.RETRIEVAL_BUG:
                retrieval_bug_queries.append(fq)
            elif fq.failure_reason == FailureReason.AMBIGUOUS:
                ambiguous_queries.append(fq)

        # Group missing data queries by query text (to find patterns)
        missing_data_patterns = Counter()
        for fq in missing_data_queries:
            # Extract key terms from query (simple approach)
            query_lower = fq.user_query.lower()
            # Try to identify university names, major codes, etc.
            if any(term in query_lower for term in ["политех", "polytech", "satbayev"]):
                missing_data_patterns["Политех/Satbayev"] += 1
            elif any(term in query_lower for term in ["сду", "sdu", "демирель", "demirel"]):
                missing_data_patterns["СДУ/Демирель"] += 1
            elif any(term in query_lower for term in ["кбту", "kbtu", "британский"]):
                missing_data_patterns["КБТУ/Британский"] += 1
            elif any(term in query_lower for term in ["ену", "enu", "гумилев"]):
                missing_data_patterns["ЕНУ/Гумилев"] += 1
            elif any(term in query_lower for term in ["нархоз", "narxoz"]):
                missing_data_patterns["Нархоз/Narxoz"] += 1
            elif "b057" in query_lower or "айти" in query_lower or "it" in query_lower:
                missing_data_patterns["IT/B057"] += 1
            elif "медицин" in query_lower or "мед" in query_lower:
                missing_data_patterns["Медицина"] += 1
            else:
                missing_data_patterns["Другое"] += 1

        # Group retrieval bugs by suggested fix
        retrieval_bug_fixes = defaultdict(list)
        for fq in retrieval_bug_queries:
            if fq.suggested_fix:
                # Extract key part of fix suggestion
                fix_key = fq.suggested_fix[:100]  # First 100 chars
                retrieval_bug_fixes[fix_key].append(fq)

        # Generate Markdown report
        report_lines = [
            "# Samga.ai - Improvement Report",
            "",
            f"**Generated:** {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
            f"**Total Analyzed Queries:** {total_queries}",
            "",
            "---",
            "",
            "## Summary Statistics",
            "",
            "| Failure Reason | Count | Percentage |",
            "|----------------|-------|------------|",
        ]

        for reason, count in by_reason.most_common():
            percentage = (count / total_queries * 100) if total_queries > 0 else 0
            report_lines.append(f"| {reason} | {count} | {percentage:.1f}% |")

        report_lines.extend(
            [
                "",
                "---",
                "",
                "## Top Missing Data Issues",
                "",
                f"**Total Missing Data Queries:** {len(missing_data_queries)}",
                "",
                "### Patterns in Missing Data Queries",
                "",
                "| Pattern | Count |",
                "|---------|-------|",
            ]
        )

        for pattern, count in missing_data_patterns.most_common(10):
            report_lines.append(f"| {pattern} | {count} |")

        report_lines.extend(
            [
                "",
                "### Top 10 Missing Data Queries",
                "",
                "| Query | AI Response | Timestamp |",
                "|-------|-------------|-----------|",
            ]
        )

        for fq in missing_data_queries[:10]:
            query_short = fq.user_query[:60] + "..." if len(fq.user_query) > 60 else fq.user_query
            response_short = (
                fq.ai_response[:60] + "..." if len(fq.ai_response) > 60 else fq.ai_response
            )
            timestamp = fq.timestamp.strftime("%Y-%m-%d %H:%M")
            report_lines.append(f"| {query_short} | {response_short} | {timestamp} |")

        report_lines.extend(
            [
                "",
                "---",
                "",
                "## Top Retrieval Bugs",
                "",
                f"**Total Retrieval Bug Queries:** {len(retrieval_bug_queries)}",
                "",
                "### Suggested Fixes (Grouped)",
                "",
            ]
        )

        # Group fixes by common patterns
        fix_groups = defaultdict(list)
        for fix_key, queries in retrieval_bug_fixes.items():
            # Try to categorize fixes
            fix_lower = fix_key.lower()
            if "алиас" in fix_lower or "alias" in fix_lower:
                fix_groups["Add Aliases"].extend(queries)
            elif "поиск" in fix_lower or "search" in fix_lower:
                fix_groups["Fix Search Logic"].extend(queries)
            elif "код" in fix_lower or "code" in fix_lower:
                fix_groups["Fix Code Mapping"].extend(queries)
            else:
                fix_groups["Other Fixes"].extend(queries)

        for group_name, queries in fix_groups.items():
            report_lines.extend(
                [
                    f"### {group_name} ({len(queries)} queries)",
                    "",
                ]
            )

            # Show top 5 from this group
            for fq in queries[:5]:
                report_lines.extend(
                    [
                        f"**Query:** {fq.user_query}",
                        f"**Suggested Fix:** {fq.suggested_fix or 'N/A'}",
                        f"**Analysis Notes:** {fq.analysis_notes or 'N/A'}",
                        "",
                    ]
                )

        report_lines.extend(
            [
                "",
                "### Top 10 Retrieval Bug Queries",
                "",
                "| Query | AI Response | Suggested Fix |",
                "|-------|-------------|---------------|",
            ]
        )

        for fq in retrieval_bug_queries[:10]:
            query_short = fq.user_query[:50] + "..." if len(fq.user_query) > 50 else fq.user_query
            response_short = (
                fq.ai_response[:50] + "..." if len(fq.ai_response) > 50 else fq.ai_response
            )
            fix_short = (
                (fq.suggested_fix[:50] + "...")
                if fq.suggested_fix and len(fq.suggested_fix) > 50
                else (fq.suggested_fix or "N/A")
            )
            report_lines.append(f"| {query_short} | {response_short} | {fix_short} |")

        if ambiguous_queries:
            report_lines.extend(
                [
                    "",
                    "---",
                    "",
                    "## Ambiguous Queries",
                    "",
                    f"**Total Ambiguous Queries:** {len(ambiguous_queries)}",
                    "",
                    "These queries are too vague or require clarification.",
                    "",
                    "| Query | AI Response |",
                    "|-------|-------------|",
                ]
            )

            for fq in ambiguous_queries[:10]:
                query_short = (
                    fq.user_query[:60] + "..." if len(fq.user_query) > 60 else fq.user_query
                )
                response_short = (
                    fq.ai_response[:60] + "..." if len(fq.ai_response) > 60 else fq.ai_response
                )
                report_lines.append(f"| {query_short} | {response_short} |")

        report_lines.extend(
            [
                "",
                "---",
                "",
                "## Recommendations",
                "",
                "### Immediate Actions:",
                "",
                "1. **For Missing Data:**",
                "   - Review top missing data patterns",
                "   - Prioritize scraping/importing data for frequently requested items",
                "   - Consider adding placeholder responses with estimated data",
                "",
                "2. **For Retrieval Bugs:**",
                "   - Implement suggested fixes (aliases, search improvements)",
                "   - Review tool descriptions and search logic",
                "   - Add more synonyms to search_keywords fields",
                "",
                "3. **For Ambiguous Queries:**",
                "   - Improve prompt to ask clarifying questions",
                "   - Add examples of well-formed queries",
                "",
                "---",
                "",
                f"*Report generated from {total_queries} analyzed failed queries.*",
            ]
        )

        # Write report
        report_content = "\n".join(report_lines)

        if output_path:
            output_file = Path(output_path)
        else:
            # Default to reports directory
            reports_dir = Path(__file__).parent.parent / "reports"
            reports_dir.mkdir(exist_ok=True)
            output_file = (
                reports_dir / f"improvement_report_{datetime.now().strftime('%Y%m%d_%H%M%S')}.md"
            )

        output_file.write_text(report_content, encoding="utf-8")
        print(f"✅ Report generated: {output_file}")
        print(f"   Total queries analyzed: {total_queries}")
        print(f"   - Missing Data: {len(missing_data_queries)}")
        print(f"   - Retrieval Bugs: {len(retrieval_bug_queries)}")
        print(f"   - Ambiguous: {len(ambiguous_queries)}")


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Generate improvement report from failed queries")
    parser.add_argument(
        "--output",
        "-o",
        type=str,
        help="Output file path (default: reports/improvement_report_TIMESTAMP.md)",
    )

    args = parser.parse_args()

    asyncio.run(generate_report(args.output))

"""
parent_report_pdf.py
--------------------

v3.27 — Server-side HTML + PDF rendering for the parent report.

The HTML template is the single source of truth; PDF is produced by
rendering the same HTML through WeasyPrint.

Dependencies:
    - jinja2 (now pinned in backend/requirements.txt as of v3.27)
    - weasyprint (new in v3.27)
    - System libs: libpango, libcairo, libgdk-pixbuf, fontconfig, plus
      a Cyrillic + KZ-capable font (Noto Sans). Wired in
      backend/Dockerfile in this same tag.

The Jinja template is small enough to embed inline rather than carry
a separate templates/ directory — keeps the BE deployment artifact
self-contained.
"""

from __future__ import annotations

import io
from typing import Any

from jinja2 import Environment, select_autoescape

# ──────────────────────────────────────────────────────────────────────────
# Inline Jinja template
# ──────────────────────────────────────────────────────────────────────────
PARENT_REPORT_HTML_TEMPLATE = """<!DOCTYPE html>
<html lang="{{ payload.language }}">
<head>
<meta charset="utf-8">
<title>{{ payload.strings.title }}</title>
<style>
  @page { size: A4; margin: 18mm 16mm; }
  body { font-family: "Noto Sans", "DejaVu Sans", sans-serif;
         color: #0a0a0a; line-height: 1.45; }
  h1 { font-size: 22px; margin: 0 0 4px 0; }
  h2 { font-size: 15px; margin: 18px 0 8px 0;
       color: #1f2937; border-bottom: 1px solid #d4d4d8; padding-bottom: 4px; }
  .subtitle { color: #52525b; font-size: 11px; margin-bottom: 14px; }
  .meta { font-size: 11px; color: #52525b; }
  table { border-collapse: collapse; width: 100%; margin-top: 6px;
          font-size: 11px; }
  th, td { border: 1px solid #e4e4e7; padding: 6px 8px; text-align: left; }
  th { background: #f4f4f5; font-weight: 600; }
  .pill { display: inline-block; padding: 2px 8px; border-radius: 999px;
          background: #f4f4f5; color: #18181b; font-size: 10px;
          margin-right: 4px; }
  .footer { margin-top: 28px; font-size: 10px; color: #71717a;
            border-top: 1px solid #e4e4e7; padding-top: 6px; }
  .empty { font-size: 11px; color: #71717a; font-style: italic; }
  ul.tight { padding-left: 18px; margin: 4px 0; font-size: 11px; }
  ul.tight li { margin: 2px 0; }
</style>
</head>
<body>
  <h1>{{ payload.strings.title }}</h1>
  <p class="subtitle">{{ payload.strings.subtitle }}</p>

  <div class="meta">
    <strong>{{ payload.strings.student }}:</strong>
      {{ payload.student.first_name }}
      {% if payload.student.grade %} · {{ payload.student.grade }}
        {{ payload.strings.grade }}{% endif %}
    {% if payload.current_score is not none %}
      &nbsp;|&nbsp; <strong>{{ payload.strings.current_score }}:</strong>
      {{ payload.current_score }}
    {% else %}
      &nbsp;|&nbsp; <em>{{ payload.strings.score_unknown }}</em>
    {% endif %}
  </div>

  <h2>{{ payload.strings.recent_exams }}</h2>
  {% if payload.exam_attempts %}
    <table>
      <thead>
        <tr>
          <th>{{ payload.strings.subjects }}</th>
          <th>{{ payload.strings.score }}</th>
          <th>{{ payload.strings.date }}</th>
        </tr>
      </thead>
      <tbody>
        {% for row in payload.exam_attempts %}
          <tr>
            <td>{{ row.subjects | join(", ") }}</td>
            <td>{{ row.score }} / {{ row.max_score }}</td>
            <td>{{ row.submitted_at[:10] if row.submitted_at else "" }}</td>
          </tr>
        {% endfor %}
      </tbody>
    </table>
  {% else %}
    <p class="empty">{{ payload.strings.exam_no_history }}</p>
  {% endif %}

  <h2>{{ payload.strings.target_universities }}</h2>
  {% if payload.target_universities %}
    <ul class="tight">
      {% for u in payload.target_universities %}
        <li>
          <strong>{{ u.name }}</strong>
          {% if u.city %}<span class="pill">{{ u.city }}</span>{% endif %}
        </li>
      {% endfor %}
    </ul>
  {% else %}
    <p class="empty">{{ payload.strings.no_targets }}</p>
  {% endif %}

  <div class="footer">
    {{ payload.strings.footer_disclaimer }}<br>
    <em>{{ payload.strings.generated_at }}: {{ payload.generated_at[:19] }}</em>
  </div>
</body>
</html>
"""


_jinja_env: Environment | None = None


def _get_env() -> Environment:
    global _jinja_env
    if _jinja_env is None:
        _jinja_env = Environment(
            autoescape=select_autoescape(["html", "xml"]),
            trim_blocks=True,
            lstrip_blocks=True,
        )
    return _jinja_env


def render_parent_report_html(payload: dict[str, Any]) -> str:
    """Render the parent report HTML for a given payload."""

    env = _get_env()
    template = env.from_string(PARENT_REPORT_HTML_TEMPLATE)
    return template.render(payload=payload)


def render_parent_report_pdf(payload: dict[str, Any]) -> bytes:
    """Render the parent report as PDF bytes via WeasyPrint.

    Imports weasyprint lazily so the broader app (and most tests) don't
    pay the import cost or require the system libs at import time.
    """

    # Lazy import — weasyprint pulls heavy native libs and we don't
    # want to crash the whole API process if they are absent in dev.
    from weasyprint import HTML  # type: ignore[import-not-found]

    html_str = render_parent_report_html(payload)
    out = io.BytesIO()
    HTML(string=html_str).write_pdf(out)
    return out.getvalue()

"""v3.55 (2026-05-02): pin notifications.py print sweep.

Continues the post-v3.47 print-sweep arc:
  v3.45 (auth) -> v3.48 (library PDF) -> v3.49 (services x6)
  -> v3.51 (chat router) -> v3.52 (chat sub-services)
  -> v3.53 (question_generator)
  -> v3.54 (5 RAG/ingestion/strategy modules)
  -> v3.55 (notifications digest job).

Closes audit finding #33 from the v3.44 post-ship inventory.
``app/services/notifications.py`` is the email-digest service —
runs as a daily cron job (``run_daily_digest_job``) plus the
on-demand ``send_email`` / ``send_batch_emails`` helpers.

**Why this was the priority pick.** Highest operational impact
remaining on the audit shelf:

- The digest job runs as scheduled cron (daily). Pre-v3.55 every
  job run dumped 4-5 banner prints + per-user success / per-user
  failure prints to stdout. None of that landed in standard log
  scrapers — operators had no way to see digest-run health
  without tailing the cron stdout.
- ``send_email`` is invoked from the digest run AND from
  application-status notifications + poster-alert paths. Its
  pre-v3.55 catch-all printed the SMTP failure to stdout; failed
  deliveries were invisible to monitoring.

**Per-call-site rationale (durable):**

- ``send_email`` (2 sites):
  - Dry-run guard (no SMTP creds): print -> ``logger.info(...)``.
    The "[DRY RUN]" prefix is preserved as part of the message
    text since it's a meaningful operational marker.
  - SMTP-failure catch-all: ``print(f"❌ ... : {e}")`` ->
    ``logger.exception("Email send failed to %s", payload.to_email)``.
    ``as e`` collapsed (str(e) only used in the removed print).
- ``run_daily_digest_job`` (5 sites):
  - 3 banner prints (`'=' * 60`, "Daily Digest Job - {ts}",
    `'=' * 60`) -> single ``logger.info("Daily digest job
    started | run_at=%s", ...)``. Same banner-collapse pattern
    as v3.53.
  - "Found N users to send digest to" -> ``logger.info(...)``.
  - Per-user success: ``print(f"  ✅ Sent to {email}")`` ->
    ``logger.debug``. Down-leveled because success is the
    common case; a 100-user digest run shouldn't pollute INFO
    with 100 lines.
  - Per-user failure: ``print(f"  ❌ Failed for {email}: {e}")``
    -> ``logger.exception(...)``. Up-leveled to attach stack so
    operators can distinguish SMTP failures (transient) from
    template/serialization bugs (real). ``as e`` collapsed.
  - Final summary: ``print(f"\nSent {sent}/{len(users)} digests")``
    -> ``logger.info("Daily digest job complete | sent=%d/%d",
    ...)`` so log scrapers can index ``sent=`` field.

Same AST + source-substring pattern as v3.49 / v3.51 / v3.52 /
v3.53 / v3.54.
"""

from __future__ import annotations

import ast
import inspect
from pathlib import Path

from app.services import notifications as notifications_module


def _module_ast() -> ast.Module:
    path = Path(inspect.getfile(notifications_module))
    return ast.parse(path.read_text(encoding="utf-8"), filename=str(path))


def test_notifications_has_logger_attribute():
    """v3.55 contract: ``app.services.notifications`` defines a
    module logger. Without the attribute pin, a future refactor
    that drops the import would silently regress observability on
    the daily digest cron path."""
    import logging as _logging

    assert hasattr(notifications_module, "logger"), (
        "app.services.notifications must define `logger = logging.getLogger(__name__)`."
    )
    assert isinstance(notifications_module.logger, _logging.Logger)


def test_no_print_in_notifications():
    """v3.55 contract: zero ``print(...)`` calls survive in
    ``app/services/notifications.py``. Pin the daily-digest cron
    output route so a future regression can't silently move it
    back to stdout-only."""
    tree = _module_ast()
    print_calls: list[int] = []
    for node in ast.walk(tree):
        if (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Name)
            and node.func.id == "print"
        ):
            print_calls.append(node.lineno)
    assert not print_calls, (
        f"app/services/notifications.py must not call print(); "
        f"found {len(print_calls)} at lines {print_calls}. "
        "Use the module logger."
    )


def test_no_traceback_print_exc_in_notifications():
    """v3.55 contract: ``traceback.print_exc()`` is redundant
    alongside ``logger.exception(...)`` and never made sense in
    a cron-job context where the log feed is the operator's
    only window into the run."""
    tree = _module_ast()
    bad: list[int] = []
    for node in ast.walk(tree):
        if (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and node.func.attr == "print_exc"
        ):
            bad.append(node.lineno)
    assert not bad, (
        f"app/services/notifications.py must not call traceback.print_exc(); found at lines {bad}."
    )


def test_notifications_canonical_logger_call_sites():
    """Belt-and-suspenders: pin the v3.55 logger call sites so a
    future refactor that drops them in favour of returning silently
    fails this test, even if the AST walks above keep passing.

    The five canonical sites are the digest-run lifecycle: started,
    user-count found, per-user success debug, per-user failure
    exception, and run-complete summary. Plus the SMTP-failure
    exception in send_email."""
    src = Path(inspect.getfile(notifications_module)).read_text(encoding="utf-8")
    expected = [
        # send_email: SMTP failure
        'logger.exception("Email send failed to %s", payload.to_email)',
        # run_daily_digest_job: lifecycle
        '"Daily digest job started | run_at=%s"',
        '"Daily digest: found %d users to notify"',
        # The per-user paths:
        '"Daily digest sent to %s"',
        '"Daily digest failed for user_id=%s email=%s"',
        '"Daily digest job complete | sent=%d/%d"',
    ]
    missing = [e for e in expected if e not in src]
    assert not missing, (
        "v3.55 notifications.py must keep these canonical logger "
        f"call-site message strings: missing {missing}. If you renamed "
        "any of these deliberately, update this test."
    )

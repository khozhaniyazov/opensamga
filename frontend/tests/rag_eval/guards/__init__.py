"""Golden-set v2 methodology guards.

Two guards that audit individual golden-set Qs before they are used to
score the RAG stack:

- ``numeric_guard``          — detects numeric-calc MCQs and re-solves
                                the stem with qwen-max (no retrieval);
                                flags Qs where the computed answer
                                disagrees with the recorded gold.
- ``anchor_cooccurrence``    — extracts distinctive anchor phrases from
                                the gold answer and checks that they
                                co-occur in at least one chunk of the
                                same-language textbook corpus for the
                                inferred subject; flags Qs where the
                                corpus does not corroborate the gold.

Each guard exposes a single callable:

    run(golden_rows: list[dict], *, openai_client, db_conn=None) ->
        list[GuardFinding]

So the guards can be driven from a golden-set audit runner or
unit-tested with mocked clients (see ``test_guards.py``).
"""
from .numeric_guard import run as run_numeric_guard  # noqa: F401
from .anchor_cooccurrence import run as run_anchor_guard  # noqa: F401

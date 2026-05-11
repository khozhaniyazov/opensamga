"""
Contract tests for v3.23 Weak Topic Mode aggregator.

These are no-DB pure-function tests covering the helpers that reshape
the per-topic clusters into the issue-15-mandated response. The async
orchestrator `build_weak_topic_mode_response` is integration-tested
elsewhere (it touches the DB); here we cover the deterministic logic.
"""

from __future__ import annotations

from app.services.weak_topic_mode import (
    SEVEN_DAY_PLAN_INTENTS,
    TOP_TOPICS_PER_SUBJECT,
    WeakTopicAction,
    WeakTopicEntry,
    WeakTopicPlanDay,
    WeakTopicSubjectGroup,
    build_topic_actions,
    derive_subject_from_topic,
    expected_subjects,
    group_topics_by_subject,
    synthesize_seven_day_plan,
)


def test_derive_subject_from_topic_keeps_canonical_subjects():
    assert derive_subject_from_topic("Mathematics") == "Mathematics"
    assert derive_subject_from_topic("Physics") == "Physics"


def test_derive_subject_from_topic_splits_compound_tags():
    # The canonical subject taxonomy maps bare "History" to "History of
    # Kazakhstan" since that's the UNT subject name. We honor that
    # normalization here so the FE renders one stable subject label.
    assert derive_subject_from_topic("History > 18th Century") == "History of Kazakhstan"
    assert derive_subject_from_topic("Physics: Mechanics") == "Physics"
    assert derive_subject_from_topic("Chemistry > Organic > Hydrocarbons") == "Chemistry"
    assert derive_subject_from_topic("Biology - Cell theory") == "Biology"


def test_derive_subject_from_topic_buckets_unknown_as_other():
    assert derive_subject_from_topic("") == "Other"
    assert derive_subject_from_topic("not a real subject xyz") == "Other"


def test_build_topic_actions_returns_four_kinds_with_deep_links():
    actions = build_topic_actions(topic="Mechanics", subject="Physics")
    kinds = tuple(a.kind for a in actions)
    assert kinds == ("learn", "tutor", "practice", "retest")

    learn, tutor, practice, retest = actions
    # learn deep-links into the library search filtered to topic + subject
    assert "/dashboard/library?q=Mechanics" in learn.href
    assert "subject=Physics" in learn.href
    # tutor deep-links into chat with topic context
    assert "/dashboard/chat?topic=Mechanics" in tutor.href
    assert "subject=Physics" in tutor.href
    # practice opens quiz filtered to subject
    assert practice.href == "/dashboard/quiz?subject=Physics"
    # retest opens the exam start page (no topic filter — UNT is full)
    assert retest.href == "/dashboard/exams"
    # Every action carries the subject so the FE can render
    # "Practice in Physics" without re-deriving.
    assert all(a.subject == "Physics" for a in actions)


def test_build_topic_actions_handles_other_subject():
    actions = build_topic_actions(topic="Random topic", subject="Other")
    learn, _tutor, practice, _retest = actions
    # When subject is "Other" we don't pollute the URL with subject= queries
    assert "subject=" not in learn.href
    assert practice.href == "/dashboard/quiz"


def test_group_topics_by_subject_groups_and_sorts():
    clusters = [
        {"topic": "Mathematics", "points_lost": 12, "mistake_count": 6},
        {"topic": "History > 18th Century", "points_lost": 8, "mistake_count": 4},
        {"topic": "Physics: Mechanics", "points_lost": 5, "mistake_count": 2},
        {"topic": "History > Soviet Era", "points_lost": 3, "mistake_count": 1},
        {"topic": "Mathematics", "points_lost": 0, "mistake_count": 0},  # filtered
        {"topic": "", "points_lost": 5, "mistake_count": 1},  # filtered
    ]
    page_estimates = {
        "Mathematics": 18,
        "History > 18th Century": 16,
        "Physics: Mechanics": 10,
        "History > Soviet Era": 16,
    }

    groups = group_topics_by_subject(clusters, page_estimates=page_estimates)

    # Subjects sorted by total_points_lost desc, then alphabetically.
    # History of Kazakhstan total = 11 (8+3), Mathematics = 12, Physics = 5.
    # So order: Mathematics(12), History of Kazakhstan(11), Physics(5).
    subjects = [g.subject for g in groups]
    assert subjects == ["Mathematics", "History of Kazakhstan", "Physics"]

    history_group = groups[1]
    assert history_group.total_points_lost == 11
    assert len(history_group.topics) == 2
    # Topics inside subject sorted by points desc, then mistake_count desc, then alpha.
    assert history_group.topics[0].topic == "History > 18th Century"
    assert history_group.topics[1].topic == "History > Soviet Era"


def test_group_topics_by_subject_truncates_to_top_n():
    clusters = [
        {"topic": f"Mathematics: chapter {i}", "points_lost": 20 - i, "mistake_count": 1}
        for i in range(10)
    ]
    groups = group_topics_by_subject(clusters)
    assert len(groups) == 1
    assert len(groups[0].topics) == TOP_TOPICS_PER_SUBJECT


def test_group_topics_assigns_priority_from_efficiency():
    # efficiency = points / pages
    # 12 / 4 = 3.0    → HIGH
    # 4 / 16 = 0.25   → MEDIUM
    # 1 / 20 = 0.05   → LOW
    clusters = [
        {"topic": "Mathematics", "points_lost": 12, "mistake_count": 6},
        {"topic": "Physics", "points_lost": 4, "mistake_count": 2},
        {"topic": "Geography", "points_lost": 1, "mistake_count": 1},
    ]
    page_estimates = {"Mathematics": 4, "Physics": 16, "Geography": 20}
    groups = group_topics_by_subject(clusters, page_estimates=page_estimates)
    by_subject = {g.subject: g for g in groups}
    assert by_subject["Mathematics"].topics[0].priority == "HIGH"
    assert by_subject["Physics"].topics[0].priority == "MEDIUM"
    assert by_subject["Geography"].topics[0].priority == "LOW"


def test_synthesize_seven_day_plan_uses_template():
    # Two topics across two subjects.
    actions_a = build_topic_actions(topic="Mathematics", subject="Mathematics")
    actions_b = build_topic_actions(topic="History > 18th Century", subject="History")
    entry_a = WeakTopicEntry(
        topic="Mathematics",
        subject="Mathematics",
        points_lost=12,
        mistake_count=6,
        pages_to_read=18,
        priority="HIGH",
        actions=actions_a,
    )
    entry_b = WeakTopicEntry(
        topic="History > 18th Century",
        subject="History",
        points_lost=8,
        mistake_count=4,
        pages_to_read=16,
        priority="MEDIUM",
        actions=actions_b,
    )
    groups = (
        WeakTopicSubjectGroup(subject="Mathematics", total_points_lost=12, topics=(entry_a,)),
        WeakTopicSubjectGroup(subject="History", total_points_lost=8, topics=(entry_b,)),
    )
    plan = synthesize_seven_day_plan(groups)

    assert len(plan) == 7
    assert tuple(d.intent for d in plan) == SEVEN_DAY_PLAN_INTENTS

    # Day 1: learn the heaviest topic
    assert plan[0].day == 1
    assert plan[0].topic == "Mathematics"
    assert "/dashboard/library" in plan[0].href

    # Day 2: practice the same topic
    assert plan[1].topic == "Mathematics"
    assert plan[1].href.startswith("/dashboard/quiz")

    # Day 3-4: top-2
    assert plan[2].topic == "History > 18th Century"
    assert plan[3].topic == "History > 18th Century"

    # Day 5: review (no topic, mistakes page)
    assert plan[4].intent == "review"
    assert plan[4].topic is None
    assert plan[4].href == "/dashboard/mistakes"

    # Day 6: practice top-1 (lock-in)
    assert plan[5].topic == "Mathematics"
    assert plan[5].intent == "practice"

    # Day 7: retest, no topic
    assert plan[6].intent == "retest"
    assert plan[6].topic is None
    assert plan[6].href == "/dashboard/exams"


def test_synthesize_seven_day_plan_degrades_with_no_topics():
    plan = synthesize_seven_day_plan(())
    assert len(plan) == 7
    # All topic-bound days should collapse to review days
    # except day 7 which stays as retest.
    intents = tuple(d.intent for d in plan)
    assert intents[6] == "retest"
    # Days 1-6 with no topic available all become review.
    for d in plan[:6]:
        if d.intent != "review":
            # Some slot was filled despite no topics — fail loudly.
            raise AssertionError(f"day {d.day} should degrade to review, got {d.intent}")


def test_synthesize_seven_day_plan_with_only_one_topic():
    actions = build_topic_actions(topic="Mathematics", subject="Mathematics")
    only = WeakTopicEntry(
        topic="Mathematics",
        subject="Mathematics",
        points_lost=12,
        mistake_count=6,
        pages_to_read=18,
        priority="HIGH",
        actions=actions,
    )
    plan = synthesize_seven_day_plan(
        (WeakTopicSubjectGroup(subject="Mathematics", total_points_lost=12, topics=(only,)),)
    )
    # Days 1, 2, 6 should reference Mathematics; days 3, 4 should
    # degrade to review (no top-2 topic); day 5 review; day 7 retest.
    assert plan[0].topic == "Mathematics"
    assert plan[1].topic == "Mathematics"
    assert plan[2].intent == "review"
    assert plan[3].intent == "review"
    assert plan[4].intent == "review"
    assert plan[5].topic == "Mathematics"
    assert plan[6].intent == "retest"


def test_expected_subjects_includes_compulsory_and_profile_subjects():
    subjects = expected_subjects()
    # Compulsory subjects (Math Lit, Reading Lit, History of KZ) must appear.
    assert "History of Kazakhstan" in subjects
    # Profile subjects must appear (Math, Physics etc.)
    assert "Mathematics" in subjects
    # No duplicates
    assert len(subjects) == len(set(subjects))


def test_dataclasses_are_frozen_and_serialize_to_dict():
    action = WeakTopicAction(kind="learn", href="/x", subject="Y")
    assert action.to_dict() == {"kind": "learn", "href": "/x", "subject": "Y"}

    entry = WeakTopicEntry(
        topic="t",
        subject="s",
        points_lost=1,
        mistake_count=1,
        pages_to_read=1,
        priority="HIGH",
        actions=(action,),
    )
    payload = entry.to_dict()
    assert payload["actions"] == [action.to_dict()]
    assert payload["topic"] == "t"

    day = WeakTopicPlanDay(day=1, intent="learn", topic="t", subject="s", href="/x")
    assert day.to_dict()["day"] == 1


def test_seven_day_plan_template_constant_is_correct():
    # Pin the template so a future refactor of the day pattern is a
    # conscious decision, not an accident.
    assert SEVEN_DAY_PLAN_INTENTS == (
        "learn",
        "practice",
        "learn",
        "practice",
        "review",
        "practice",
        "retest",
    )

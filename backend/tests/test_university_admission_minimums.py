from app.services.university_admission_minimums import official_paid_min_score


def test_official_paid_min_score_for_high_floor_groups():
    assert official_paid_min_score("Regional University", "B001") == 75
    assert official_paid_min_score("Regional University", "B049") == 75
    assert official_paid_min_score("Regional University", "B086") == 70


def test_official_paid_min_score_for_general_and_national_universities():
    assert official_paid_min_score("Regional University", "B057") == 50
    assert official_paid_min_score("Kazakh National University", "B057") == 65


def test_official_paid_min_score_for_agriculture_and_water_exception():
    assert official_paid_min_score("Kazakh National Agrarian University", "B183") == 65
    assert official_paid_min_score("Regional Agrarian University", "B183") == 50
    assert (
        official_paid_min_score(
            "Казахский национальный университет водного хозяйства и ирригации",
            "B057",
        )
        == 50
    )

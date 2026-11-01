"""Тесты Python-части: проверка фактов в письмах, маскирование ПДн, прогноз. Запуск: python -m pytest tests -q"""
from pipeline.build_demo import mask_pii, validate_letter
from pipeline.forecast import featurize, FEATURES

INV = {"id": "1042", "amount": 184000, "paid": 0, "due": "2026-10-04", "issued": "2026-09-19",
       "messages": [{"date": "2026-10-07", "from": "client", "text": "Не получили акт за сентябрь."}]}


def test_validator_accepts_known_numbers():
    assert validate_letter("Счёт № 1042 на 184 000 ₽, письмо от 7 октября.", INV) == []


def test_validator_flags_invented_numbers():
    assert validate_letter("Оплатите 190 000 ₽ до 17:00.", INV) == ["190 000", "17"]


def test_mask_pii():
    s = mask_pii("Звоните +7 (912) 345-67-89, ivan@firma.ru, паспорт 4510 123456. Счёт 1042 на 184 000")
    assert "[телефон]" in s and "[email]" in s and "[паспорт]" in s and "1042" in s and "184 000" in s


def test_features_shape():
    assert len(featurize(0.3, 7, 10, 2e5, 1, 1, 0.1, 0, "documents")) == len(FEATURES)


def test_confidence_interval_for_perfect_score():
    from pipeline.honest_eval import ci
    r = ci(42, 42)
    assert r["acc"] == 1.0 and 0.91 < r["lo"] < 0.92  # 42 из 42 — это «не ниже ~92%», а не 100%


def test_forecast_model_only_recovers_generator():
    from pipeline.honest_eval import forecast_eval
    f = forecast_eval()
    assert abs(f["auc_model"] - f["auc_ceiling"]) < 0.01  # упирается в потолок своего же генератора
    assert f["auc_other_world"] < f["auc_model"] - 0.1     # при других допущениях качество падает

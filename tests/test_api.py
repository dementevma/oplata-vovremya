"""Тесты локального сервера: Jev и LLM подменены заглушками, сеть не нужна. Запуск: python -m pytest tests -q"""
import pytest
from fastapi.testclient import TestClient

import server.app as srv

BODY = {
    "invoice": {"id": "1042", "inn": "7701000000", "amount": 184000, "paid": 0, "due": "2026-10-04", "issued": "2026-09-19",
                "messages": [{"date": "2026-10-07", "from": "client", "text": "Не получили акт. Звоните +7 (912) 345-67-89"},
                             {"date": "2026-10-08", "from": "us", "text": "Отправим сегодня"},
                             {"date": "2026-10-09", "from": "client", "text": "Акт так и не пришёл, пишите ivan@firma.ru"}]},
    "client": {"name": "ООО Ромашка", "sector": "стройка"},
    "today": "2026-10-28",
}
CAUSE = {"choice": "documents", "confidence": 0.9, "probabilities": {"documents": 0.9}}


class FakeJev:
    available, model = True, "jev-test"

    def __init__(self, fail=False):
        self.fail, self.states = fail, []

    def ask(self, state, questions):
        if self.fail:
            raise RuntimeError("timeout")
        self.states.append(state)
        return {"model": self.model, "latency_ms": 5, "answers": {"cause": CAUSE}}


class FakeLLM:
    available, model = True, "llm-test"

    def __init__(self, reply='{"subject": "Акт", "body": "Счёт № 1042 на 184 000 ₽: отправим акт сегодня."}', fail=False):
        self.reply, self.fail, self.prompts = reply, fail, []

    def chat(self, system, user):
        if self.fail:
            raise RuntimeError("LLM недоступна")
        self.prompts.append(user)
        return self.reply


@pytest.fixture
def client(monkeypatch):
    def make(jev=None, llm=None):
        monkeypatch.setattr(srv, "JEV", jev or FakeJev())
        monkeypatch.setattr(srv, "LLM", llm or FakeLLM())
        return TestClient(srv.app)
    return make


def test_health_reports_models(client):
    r = client().get("/api/health").json()
    assert r == {"ok": True, "jev": True, "llm": True, "jev_model": "jev-test", "llm_model": "llm-test"}


def test_analyze_returns_cause_per_client_message_and_letter(client):
    r = client().post("/api/analyze", json=BODY)
    assert r.status_code == 200
    d = r.json()
    assert d["jev"]["answers"]["cause"]["choice"] == "documents"
    assert [m["index"] for m in d["messages"]] == [0, 2]  # только письма клиента, в исходном порядке
    assert d["llm"]["model"] == "llm-test" and d["llm"]["invalid_numbers"] == []


def test_pii_is_masked_before_models(client):
    jev, llm = FakeJev(), FakeLLM()
    client(jev, llm).post("/api/analyze", json=BODY)
    sent = " ".join(jev.states + llm.prompts)
    assert "345-67-89" not in sent and "ivan@firma.ru" not in sent
    assert "[телефон]" in sent and "[email]" in sent


def test_invented_numbers_in_letter_are_flagged(client):
    llm = FakeLLM('{"subject": "Оплата", "body": "Оплатите 190 000 ₽ до 30 октября."}')
    d = client(llm=llm).post("/api/analyze", json=BODY).json()
    assert "190 000" in d["llm"]["invalid_numbers"]


def test_jev_failure_gives_502_not_500(client):
    r = client(jev=FakeJev(fail=True)).post("/api/analyze", json=BODY)
    assert r.status_code == 502


def test_llm_failure_keeps_cause(client):
    d = client(llm=FakeLLM(fail=True)).post("/api/analyze", json=BODY).json()
    assert d["jev"]["answers"]["cause"]["choice"] == "documents" and "llm" not in d


def test_jev_without_key_gives_503(client):
    jev = FakeJev()
    jev.available = False
    assert client(jev=jev).post("/api/analyze", json=BODY).status_code == 503


def test_message_length_is_limited(client):
    body = {**BODY, "invoice": {**BODY["invoice"], "messages": [{"date": "2026-10-07", "from": "client", "text": "x"}] * 51}}
    assert client().post("/api/analyze", json=body).status_code == 422


def test_letter_llm_prefers_on_prem(monkeypatch):
    from pipeline import clients
    monkeypatch.setitem(clients.ENV, "OPENAI_BASE_URL", "http://vllm.local/v1")
    monkeypatch.setitem(clients.ENV, "OPENAI_MODEL", "t-pro")
    assert isinstance(clients.letter_llm(), clients.OpenAICompat)
    monkeypatch.setitem(clients.ENV, "OPENAI_BASE_URL", "")
    assert isinstance(clients.letter_llm(), clients.GigaChat)


def test_gigachat_tls_is_verified_by_default(monkeypatch):
    from pipeline import clients
    monkeypatch.setitem(clients.ENV, "GIGACHAT_INSECURE_TLS", "")
    monkeypatch.setitem(clients.ENV, "GIGACHAT_CA_BUNDLE", "")
    assert clients.gigachat_verify() is True
    monkeypatch.setitem(clients.ENV, "GIGACHAT_CA_BUNDLE", "certs/russian_trusted_root_ca.pem")
    assert clients.gigachat_verify() == "certs/russian_trusted_root_ca.pem"


def test_survey_answer_is_saved_outside_git(client, tmp_path, monkeypatch):
    monkeypatch.setattr(srv, "SURVEY_FILE", tmp_path / "survey.jsonl")
    ans = {"at": "2026-10-30T20:00:00Z", "screen": "Да", "role": "Собственник", "invoices": "10–50", "late_share": "10–30%",
           "when": "За последний месяц", "cause": "Нет денег", "story": "Клиент сослался на кассовый разрыв, заплатил через месяц",
           "minutes": "10–30 минут", "where": ["Почта"], "gap": "Да", "call": "Нет", "nick": "@ivan", "consent": False}
    assert client().post("/api/survey", json=ans).json() == {"ok": True}
    saved = (tmp_path / "survey.jsonl").read_text(encoding="utf-8")
    assert "Нет денег" in saved and "@ivan" not in saved  # без согласия ник не сохраняется
    client().post("/api/survey", json={**ans, "consent": True})
    assert "@ivan" in (tmp_path / "survey.jsonl").read_text(encoding="utf-8")
    assert client().post("/api/survey", json={**ans, "story": "x" * 601}).status_code == 422


def test_counterparty_rejects_bad_inn(client):
    assert client().get("/api/counterparty/123").status_code == 422


def test_message_needs_text(client):
    assert client().post("/api/message", json={"text": ""}).status_code == 422


def test_message_masks_pii_before_jev(client):
    jev = FakeJev()
    r = client(jev=jev).post("/api/message", json={"text": "Звоните +7 (912) 345-67-89"})
    assert r.status_code == 200 and r.json()["cause"] == "documents"
    assert "345-67-89" not in jev.states[0] and "[телефон]" in jev.states[0]

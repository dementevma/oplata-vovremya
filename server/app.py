"""Локальный сервер «живого режима»: то же демо + живые вызовы Jev и GigaChat.

Запуск:  pip install -r requirements.txt  →  python -m server.app  →  http://127.0.0.1:8000
Ключи — в .env (см. .env.example). Без ключа Jev /api/health сообщает jev=false, и интерфейс разбирает
переписку правилами в браузере, как статическое демо. Письма пишет on-prem модель, если задан OPENAI_BASE_URL,
иначе GigaChat. Перед отправкой в любую модель телефоны, почта, паспорт и СНИЛС заменяются метками.

В банке этот же сервер разворачивается в закрытом контуре: Jev — on-prem, генеративная модель —
GigaChat on-prem / T-Pro / Qwen3 через OpenAI-совместимый API (vLLM). Наружу данные не уходят.
"""
from __future__ import annotations

import json
import logging
import re
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import httpx
import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from pipeline.build_demo import LETTER_SYSTEM, letter_prompt, mask_pii, validate_letter
from pipeline.causes import INVOICE_QUESTIONS, MESSAGE_QUESTIONS, invoice_state
from pipeline.clients import Jev, letter_llm

ROOT = Path(__file__).resolve().parent.parent
app = FastAPI(title="Оплата вовремя", version="2.0")
JEV, LLM = Jev(), letter_llm()
log = logging.getLogger("oplata")


class Message(BaseModel):
    date: str
    text: str = Field(max_length=5000)
    model_config = {"extra": "allow"}


class Invoice(BaseModel):
    id: str
    inn: str
    amount: float
    paid: float = 0
    due: str
    issued: str | None = None
    docs: dict = {}
    messages: list[dict] = Field(default_factory=list, max_length=50)


class AnalyzeRequest(BaseModel):
    invoice: Invoice
    client: dict
    today: str


@app.get("/api/health")
def health():
    return {"ok": True, "jev": JEV.available, "llm": LLM.available, "jev_model": JEV.model, "llm_model": LLM.model}


@app.post("/api/analyze")
def analyze(req: AnalyzeRequest):
    """Ответ в том же формате, что и записи demo.json → analysis[id]: интерфейс не различает источники."""
    if not JEV.available:
        raise HTTPException(503, "Jev недоступна: нет TYPESAFE_API_KEY")
    inv = req.invoice.model_dump()
    inv.setdefault("issued", inv["due"])
    inv["messages"] = [{**m, "text": mask_pii(str(m.get("text", "")))} for m in inv["messages"]]  # ПДн не уходят в модели
    client = {"name": req.client.get("name", "Клиент"), "sector": req.client.get("sector", ""), "contact": req.client.get("contact", "")}
    client_msgs = [(i, m) for i, m in enumerate(inv["messages"]) if m.get("from") == "client"]

    def ask_message(m):
        return JEV.ask(f"MESSAGE from client to supplier about an unpaid invoice:\n{m['text']}", MESSAGE_QUESTIONS)["answers"]["cause"]

    try:
        with ThreadPoolExecutor(max_workers=6) as pool:  # вопросы к счёту и к каждому письму независимы
            whole = pool.submit(JEV.ask, invoice_state(inv, client, req.today), INVOICE_QUESTIONS)
            per_msg = list(pool.map(ask_message, [m for _, m in client_msgs]))
            r = whole.result()
    except Exception as e:
        log.warning("Jev не ответила по счёту %s: %s", inv["id"], e)
        raise HTTPException(502, "Jev не ответила, интерфейс разберёт счёт правилами") from e
    out = {"id": inv["id"], "jev": {"model": r.get("model"), "latency_ms": r.get("latency_ms"), "answers": r["answers"]},
           "messages": [{"index": i, "choice": a["choice"], "confidence": a.get("confidence"), "p": a.get("probabilities")}
                        for (i, _), a in zip(client_msgs, per_msg)]}
    if LLM.available:
        try:
            raw = LLM.chat(LETTER_SYSTEM, letter_prompt(inv, client, r["answers"]["cause"]["choice"]))
            m = re.search(r"\{.*\}", raw, re.S)
            llm = json.loads(m.group(0)) if m else {}
            if llm.get("body"):
                llm["invalid_numbers"] = validate_letter(llm["body"], inv)
                llm["model"] = LLM.model
                out["llm"] = llm
        except Exception as e:  # письмо — не критичная часть ответа: без него интерфейс покажет шаблон
            log.warning("Письмо по счёту %s не сгенерировано: %s", inv["id"], e)
    return out


class MessageRequest(BaseModel):
    text: str = Field(min_length=1, max_length=5000)


@app.post("/api/message")
def message(req: MessageRequest):
    """Разбор одного письма без реестра: причина и вероятности. «Причина не названа» = класс «молчит»."""
    if not JEV.available:
        raise HTTPException(503, "Jev недоступна: нет TYPESAFE_API_KEY")
    try:
        a = JEV.ask(f"MESSAGE from client to supplier about an unpaid invoice:\n{mask_pii(req.text)}", MESSAGE_QUESTIONS)["answers"]["cause"]
    except Exception as e:
        log.warning("Jev не ответила на письмо: %s", e)
        raise HTTPException(502, "Jev не ответила, интерфейс разберёт письмо правилами") from e
    return {"cause": "silence" if a["choice"] == "none" else a["choice"], "p": a.get("probabilities") or {}}


EGRUL = "https://egrul.nalog.ru"


@app.get("/api/counterparty/{inn}")
def counterparty(inn: str):
    """Статус компании из открытого поиска ФНС: название, актуальный КПП, ОГРН, дата прекращения деятельности."""
    if not re.fullmatch(r"\d{10}(\d{2})?", inn):
        raise HTTPException(422, "ИНН: 10 или 12 цифр")
    try:
        with httpx.Client(timeout=15, headers={"User-Agent": "Mozilla/5.0"}) as c:
            token = c.post(EGRUL + "/", data={"query": inn}).json()["t"]
            rows = c.get(f"{EGRUL}/search-result/{token}").json().get("rows") or []
    except (httpx.HTTPError, KeyError, ValueError) as e:
        log.warning("ЕГРЮЛ не ответил: %s", e)
        raise HTTPException(502, "ЕГРЮЛ не ответил") from e
    row = next((r for r in rows if r.get("i") == inn), None)
    if not row:
        return {"found": False}
    return {"found": True, "name": row.get("c") or row.get("n"), "kpp": row.get("p", ""), "ogrn": row.get("o", ""),
            "registered": row.get("r", ""), "liquidated": row.get("e", "")}


class SurveyAnswer(BaseModel):
    """Ответ на опрос со страницы «Опрос». Ник нужен только для звонка и сохраняется лишь с согласием."""
    at: str = Field(max_length=40)
    screen: str = Field(max_length=20)
    role: str = Field(default="", max_length=60)
    invoices: str = Field(default="", max_length=30)
    late_share: str = Field(default="", max_length=30)
    when: str = Field(default="", max_length=30)
    cause: str = Field(default="", max_length=60)
    story: str = Field(default="", max_length=600)
    minutes: str = Field(default="", max_length=30)
    where: list[str] = Field(default_factory=list, max_length=10)
    gap: str = Field(default="", max_length=20)
    call: str = Field(default="", max_length=10)
    nick: str = Field(default="", max_length=40)
    consent: bool = False


SURVEY_FILE = ROOT / "output" / "survey.jsonl"  # output/ в .gitignore: ответы не попадают в репозиторий


@app.post("/api/survey")
def survey(ans: SurveyAnswer):
    SURVEY_FILE.parent.mkdir(parents=True, exist_ok=True)
    with SURVEY_FILE.open("a", encoding="utf-8") as f:
        row = ans.model_dump()
        if not row["consent"]:
            row["nick"] = ""  # без согласия контакт не храним
        f.write(json.dumps(row, ensure_ascii=False) + "\n")
    return {"ok": True}


@app.get("/")
def index():
    return FileResponse(ROOT / "index.html")


for sub in ("web", "assets"):
    app.mount(f"/{sub}", StaticFiles(directory=ROOT / sub), name=sub)


@app.get("/favicon.svg")
def favicon():
    return FileResponse(ROOT / "favicon.svg")


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8000)

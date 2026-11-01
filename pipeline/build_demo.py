"""Собирает web/data/demo.json: демо-данные + заранее полученные ответы Jev и GigaChat.

Запуск: python -m pipeline.build_demo [--reuse-letters]
Статическое демо на GitHub Pages не хранит ключей, поэтому ответы моделей вычисляются здесь и
кладутся в JSON вместе с моделью, версией и временем ответа. Для своих данных демо использует
правила в браузере, а локальный сервер (server/app.py) — живые вызовы Jev и GigaChat.
"""
import json
import re
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime

from pipeline import demo_source as S
from pipeline.causes import CAUSES, INVOICE_QUESTIONS, MESSAGE_QUESTIONS, invoice_state
from pipeline.clients import ROOT, GigaChat, Jev

LETTER_SYSTEM = (
    "Ты — финансовый менеджер российской B2B-компании. Пишешь короткие вежливые деловые письма клиентам о неоплаченных счетах. "
    "Правила: 1) Используй только факты из входных данных, не придумывай суммы, даты, номера документов и обещания. "
    "2) Не угрожай и не дави; тон спокойный и конкретный. 3) Одно ясное следующее действие для клиента. "
    "4) Не пиши, что документ уже отправлен, если это не указано в действии. 5) Не больше 90 слов в теле письма. "
    "6) Закрывающие документы (акт, УПД, счёт-фактуру) оформляем МЫ: не проси клиента прислать или предоставить их, "
    "проси только подписать или подтвердить получение. 7) Даты пиши словами («12 октября»), не в формате ГГГГ-ММ-ДД. "
    "8) Не вставляй ссылки: платёжную ссылку добавит сервис. "
    "Ответь строго JSON: {\"subject\": \"...\", \"body\": \"...\", \"summary\": \"одно предложение: что происходит со счётом\", "
    "\"promised_date\": \"ГГГГ-ММ-ДД или null\", \"client_asks\": \"что конкретно просит клиент или null\"}"
)


def fmt_rub(n):
    return f"{n:,.0f}".replace(",", " ") + " ₽"


PII = [
    (re.compile(r"[\w.+-]+@[\w-]+\.[\w.]+"), "[email]"),
    (re.compile(r"(?:\+7|8)[\s(-]*\d{3}[\s)-]*\d{3}[\s-]*\d{2}[\s-]*\d{2}"), "[телефон]"),
    (re.compile(r"\b\d{4}\s?\d{6}\b"), "[паспорт]"),
    (re.compile(r"\b\d{3}-\d{3}-\d{3}\s?\d{2}\b"), "[СНИЛС]"),
]


def mask_pii(text: str) -> str:
    """Персональные данные не уходят в генеративную модель: телефоны, почта, паспорт, СНИЛС заменяются метками."""
    for rx, tag in PII:
        text = rx.sub(tag, text)
    return text


def letter_prompt(inv, client, cause):
    c = CAUSES[cause]
    msgs = "\n".join(f"[{m['date']}] {'Клиент' if m['from'] == 'client' else 'Мы'}: {mask_pii(m['text'])}" for m in inv["messages"]) or "(переписки нет)"
    return (f"Сегодня {S.DEMO_DATE}. Мы — {S.SUPPLIER['name']}. Клиент: {client['name']}, контакт: {client['contact']}.\n"
            f"Счёт № {inv['id']} на {fmt_rub(inv['amount'])}, оплачено {fmt_rub(inv['paid'])}, остаток {fmt_rub(inv['amount'] - inv['paid'])}, "
            f"срок оплаты {inv['due']}.\nПереписка:\n{msgs}\n\n"
            f"Определённая причина задержки: {c['ru']}. Наше следующее действие: {c['action']}.\n"
            f"Напиши письмо клиенту, которое делает это действие и просит подтвердить дату оплаты.")


NUM = re.compile(r"\d[\d\s  ]*(?:[.,]\d+)?")


def validate_letter(body: str, inv: dict) -> list[str]:
    """Каждое число в письме должно встречаться во входных данных: защита от выдуманных сумм и дат."""
    allowed = {re.sub(r"\D", "", str(x)) for x in (inv["amount"], inv["paid"], inv["amount"] - inv["paid"], inv["id"])}
    src = " ".join(m["text"] + " " + m["date"] for m in inv["messages"]) + f" {inv['due']} {inv['issued']} {S.DEMO_DATE}"
    allowed |= {re.sub(r"\D", "", n) for n in NUM.findall(src)}
    allowed |= {p.lstrip("0") or "0" for d in re.findall(r"\d{4}-\d{2}-\d{2}", src) for p in d.split("-")}
    allowed |= {re.sub(r"\D", "", p) for d in re.findall(r"\d{4}-\d{2}-\d{2}", src) for p in d.split("-")}
    bad = []
    for n in NUM.findall(body):
        digits = re.sub(r"\D", "", n)
        if len(digits) >= 2 and digits not in allowed and not any(digits in a for a in allowed):
            bad.append(n.strip())
    return bad


def bank_portfolio(n=48, seed=11):
    """Обезличенный синтетический портфель клиентов МСБ для экрана менеджера банка.

    Показывает, что видит банк, если сервис встроен в интернет-банк: дебиторка клиентов, причины
    просрочки, потенциал факторинга и ранние сигналы риска. Все значения синтетические.
    """
    import random
    rnd = random.Random(seed)
    sectors = ["Строительство", "Оптовая торговля", "Проектирование", "Логистика", "IT-услуги", "Производство", "Агропром", "Медиа"]
    out = []
    for i in range(n):
        revenue = rnd.choice([3, 5, 8, 12, 20, 35, 60]) * 1_000_000
        ar = revenue * rnd.uniform(0.6, 1.6)
        overdue_share = min(0.75, rnd.betavariate(2, 5) * (1.4 if i % 7 == 0 else 1))
        mix = {k: rnd.random() ** 2 for k in CAUSES}
        tot = sum(mix.values())
        mix = {k: round(v / tot, 3) for k, v in mix.items()}
        fixable = sum(mix[k] for k in ("documents", "details", "paid", "silence", "dispute"))
        factorable = ar * (1 - overdue_share) * rnd.uniform(0.35, 0.7)
        out.append({
            "id": f"К-{1000 + i}", "sector": rnd.choice(sectors), "revenue_month": revenue, "ar": round(ar),
            "overdue": round(ar * overdue_share), "dso": round(30 * ar / revenue), "mix": mix,
            "fixable_share": round(fixable, 2), "factorable": round(factorable),
            "debtor_alerts": rnd.choice([0, 0, 0, 1, 1, 2, 3]) if overdue_share > 0.25 else rnd.choice([0, 0, 1]),
            "uses_factoring": rnd.random() < 0.08,
        })
    return out


OLD_LETTERS: dict = {}


def main():
    jev, gc = Jev(), GigaChat()
    if "--reuse-letters" in sys.argv:
        old = json.loads((ROOT / "web" / "data" / "demo.json").read_text(encoding="utf-8"))
        OLD_LETTERS.update({k: v["llm"] for k, v in old["analysis"].items() if v.get("llm")})
    clients = {inn: {**c, "inn": inn, "kpp": S.KPP.get(inn, "")} for inn, c in S.CLIENTS.items()}
    analysis = {}

    def work(inv):
        client = clients[inv["inn"]]
        open_ = inv["amount"] - inv["paid"] > 0
        res = {"id": inv["id"]}
        if inv["messages"] and open_:
            r = jev.ask(invoice_state(inv, client, S.DEMO_DATE), INVOICE_QUESTIONS)
            res["jev"] = {"model": r.get("model"), "latency_ms": r.get("latency_ms"), "answers": r["answers"], "usage": r.get("usage")}
            res["messages"] = []
            for i, m in enumerate(inv["messages"]):
                if m["from"] != "client":
                    continue
                a = jev.ask(f"MESSAGE from client to supplier about an unpaid invoice:\n{m['text']}", MESSAGE_QUESTIONS)["answers"]["cause"]
                res["messages"].append({"index": i, "choice": a["choice"], "confidence": a.get("confidence"), "p": a.get("probabilities")})
            cause = r["answers"]["cause"]["choice"]
            if inv["id"] in OLD_LETTERS:  # --reuse-letters: письма из прошлой сборки, без обращения к модели
                res["llm"] = OLD_LETTERS[inv["id"]]
            elif gc.available:
                raw = gc.chat(LETTER_SYSTEM, letter_prompt(inv, client, cause), temperature=0.2)
                m = re.search(r"\{.*\}", raw, re.S)
                try:
                    llm = json.loads(m.group(0)) if m else {}
                except json.JSONDecodeError:
                    llm = {}
                if llm.get("body"):
                    llm["invalid_numbers"] = validate_letter(llm["body"], inv)
                    llm["model"] = gc.model
                    res["llm"] = llm
        return res

    with ThreadPoolExecutor(4) as ex:
        for res in ex.map(work, S.INVOICES):
            analysis[res["id"]] = res

    demo = {
        "meta": {"built_at": datetime.now().isoformat(timespec="seconds"), "demo_date": S.DEMO_DATE,
                 "jev_model": jev.model, "llm_model": gc.model,
                 "note": "Компании и переписка вымышлены. Ответы Jev и GigaChat получены заранее и сохранены в этот файл."},
        "supplier": S.SUPPLIER, "clients": clients, "registry": S.REGISTRY,
        "invoices": S.INVOICES, "statement": S.STATEMENT, "outflows": S.OUTFLOWS,
        "causes": CAUSES, "analysis": analysis, "doc_samples": S.DOC_SAMPLES, "bank_portfolio": bank_portfolio(),
    }
    out = ROOT / "web" / "data" / "demo.json"
    out.write_text(json.dumps(demo, ensure_ascii=False, indent=1), encoding="utf-8")
    labeled = [i for i in S.INVOICES if i["label"] not in ("none",) and i["id"] in analysis and "jev" in analysis[i["id"]]]
    hit = sum(analysis[i["id"]]["jev"]["answers"]["cause"]["choice"] == i["label"] for i in labeled)
    bad = {k: v["llm"]["invalid_numbers"] for k, v in analysis.items() if v.get("llm", {}).get("invalid_numbers")}
    print(f"invoices={len(S.INVOICES)} analysed={len(labeled)} jev_hit={hit}/{len(labeled)} letters={sum('llm' in v for v in analysis.values())} "
          f"letters_with_unverified_numbers={bad}")
    for i in labeled:
        a = analysis[i["id"]]["jev"]["answers"]["cause"]
        if a["choice"] != i["label"]:
            print("  miss", i["id"], i["label"], "->", a["choice"], a.get("probabilities"))


if __name__ == "__main__":
    main()

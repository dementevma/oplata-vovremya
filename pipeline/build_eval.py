"""Собирает выборку для оценки качества: ручные письма + письма от GigaChat, ответы Jev на каждое.

Запуск: python -m pipeline.build_eval   (нужны GIGACHAT_AUTH_KEY и TYPESAFE_API_KEY в .env)
Результат: web/data/eval.json. Правила оцениваются в браузере и в tests/ на этом же файле.
"""
import json
import re
from concurrent.futures import ThreadPoolExecutor

from pipeline.causes import CAUSES, MESSAGE_QUESTIONS
from pipeline.clients import ROOT, GigaChat, Jev
from pipeline.eval_source import HAND

STYLES = "официальный деловой; разговорный в мессенджере; короткий в одну фразу; длинный с подробностями; с опечатками; раздражённый"

SYSTEM = ("Ты помогаешь собрать обезличенную тестовую выборку для российского B2B-сервиса контроля оплат. "
          "Пишешь правдоподобные письма бухгалтеров, финансистов и менеджеров компании-заказчика поставщику услуг. "
          "Компании и люди вымышленные. Отвечай только JSON-массивом строк.")


def generate(gc: GigaChat, key: str, n: int = 10) -> list[str]:
    c = CAUSES[key]
    prompt = (f"Напиши {n} разных сообщений от заказчика поставщику, из которых понятно, почему счёт до сих пор не оплачен. "
              f"Причина во всех сообщениях одна: «{c['ru']}». Пояснение: {c['en']}.\n"
              f"Разнообразь стиль ({STYLES}), длину, отрасль и формулировки. Не используй одни и те же слова, "
              f"в двух-трёх сообщениях опиши причину косвенно, без прямых ключевых слов. Не упоминай другие причины. "
              f"Ответ: JSON-массив из {n} строк.")
    raw = gc.chat(SYSTEM, prompt, temperature=0.9, max_tokens=2500)
    m = re.search(r"\[.*\]", raw, re.S)
    items = json.loads(m.group(0)) if m else []
    texts = [x.get("text", "") if isinstance(x, dict) else x for x in items]
    return [t.strip() for t in texts if isinstance(t, str) and len(t.strip()) > 5][:n]


# Ручная проверка сгенерированных писем (28.10.2026): исключены письма, написанные от лица поставщика
# (напоминания «где наши деньги?» вместо ответа клиента) и неоднозначные. Решение принято до подсчёта метрик правил.
EXCLUDED = {
    **{f"g-silence-{i}": "написано от лица поставщика, а не клиента" for i in range(1, 10)},
    "g-approval-1": "согласование у «нашего клиента» — это нехватка денег, а не согласование",
    "g-approval-3": "написано от лица поставщика", "g-approval-5": "написано от лица поставщика",
    "g-approval-6": "противоречивое: «оплатили бы» и «деньги в пути»", "g-approval-7": "написано от лица поставщика",
    "g-approval-8": "нет причины, написано от лица поставщика", "g-approval-9": "написано от лица поставщика",
    "g-paid-1": "бессвязное", "g-paid-3": "противоречивое", "g-paid-7": "диалог, а не письмо клиента",
    "g-documents-2": "написано от лица поставщика", "g-documents-10": "от третьего лица",
}


def main():
    gc, jev = GigaChat(), Jev()
    rows = [{"id": f"h{i+1}", "source": "hand", "label": lab, "text": t} for i, (lab, t) in enumerate(HAND)]
    for key in CAUSES:
        for j, t in enumerate(generate(gc, key)):
            rows.append({"id": f"g-{key}-{j+1}", "source": "gigachat", "label": key, "text": t})

    def ask(r):
        a = jev.ask(f"MESSAGE from client to supplier about an unpaid invoice:\n{r['text']}", MESSAGE_QUESTIONS)["answers"]["cause"]
        return {"choice": a["choice"], "confidence": a.get("confidence"), "p": a.get("probabilities", {})}

    with ThreadPoolExecutor(6) as ex:
        for r, ans in zip(rows, ex.map(ask, rows)):
            r["jev"] = ans
    for r in rows:
        if r["id"] in EXCLUDED:
            r["excluded"] = EXCLUDED[r["id"]]
        # На уровне письма «причина не названа» = класс «молчит / забыл»: письмо не объясняет задержку.
        r["jev"]["pred"] = "silence" if r["jev"]["choice"] == "none" else r["jev"]["choice"]
    out = ROOT / "web" / "data" / "eval.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({"model": jev.model, "rows": rows}, ensure_ascii=False, indent=1), encoding="utf-8")
    kept = [r for r in rows if "excluded" not in r]
    acc = sum(r["jev"]["pred"] == r["label"] for r in kept) / len(kept)
    print(f"eval rows={len(rows)} kept={len(kept)}  jev accuracy={acc:.3f}  jev calls={jev.calls}")


if __name__ == "__main__":
    main()

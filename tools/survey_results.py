"""Считает итоги опроса из выгрузки Яндекс Форм.

Запуск: python tools/survey_results.py <выгрузка.xlsx|.csv> [--paid 100] [--exclude 7 12] [--quote "цитата"]
Выгрузку с никами в репозиторий не кладём: она лежит в приватных материалах.
Результат без персональных данных: docs/research/custdev/survey_results.json и .md, его читает tools/build_deck.py.
Правило отбора и гипотезы заданы заранее: docs/research/custdev/survey_ai_prompt.md.
"""
import argparse
import csv
import json
import math
import re
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs" / "research" / "custdev"
COLUMNS = {
    "screen": "выставляет счета другим компаниям", "role": "ваша роль", "invoices": "сколько счетов", "late_share": "какая доля счетов",
    "when": "последний раз не оплатил", "cause": "почему клиент не оплатил", "story": "опишите этот случай", "minutes": "сколько времени ушло",
    "where": "где обычно ищете", "gap": "кассовый разрыв", "nick": "ник в telegram",
}
FIXABLE = {"Ждал документ или исправление", "Ошибка в реквизитах, платёж вернулся", "Спор о сумме или качестве", "Уже оплатил, но не сверили", "Молчит, причина неизвестна"}
MINUTES = {"До 10 минут": 5, "10–30 минут": 20, "30–60 минут": 45, "Больше часа": 75, "Так и не выяснили": 90}
MIN_N = 15


def read_table(path):
    path = Path(path)
    if path.suffix.lower() != ".csv":
        from openpyxl import load_workbook
        return [["" if c is None else str(c) for c in r] for r in load_workbook(path, read_only=True, data_only=True).active.iter_rows(values_only=True)]
    raw = path.read_bytes()
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = raw.decode("cp1251")
    first = text.splitlines()[0]
    return list(csv.reader(text.splitlines(), delimiter=";" if ";" in first else ","))


def read_rows(path):
    table = read_table(path)
    head = [h.lower() for h in table[0]]
    missing = [k for k, n in COLUMNS.items() if not any(n in h for h in head)]
    if missing:
        raise SystemExit(f"В выгрузке не нашлись столбцы: {missing}. Заголовки: {table[0]}")
    rows = []
    for line in table[1:]:
        if not any(str(c).strip() for c in line):
            continue
        row = {}
        for key, needle in COLUMNS.items():
            vals = [str(line[i]).strip() for i, h in enumerate(head) if needle in h and i < len(line) and str(line[i]).strip()]
            row[key] = ", ".join(vals)
        rows.append(row)
    return rows


def wilson(k, n, z=1.96):
    if not n:
        return None, None
    p, d = k / n, 1 + z * z / n
    c, h = (p + z * z / (2 * n)) / d, z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return max(0.0, c - h), min(1.0, c + h)


def had_case(r):
    return r["when"] and r["when"] != "Такого не было"


def select(rows, exclude=()):
    """Правило отбора: не наша аудитория, бессмысленное описание, повтор, ручное исключение по номеру строки."""
    kept, dropped, seen = [], Counter(), set()
    for i, r in enumerate(rows, 1):
        story = re.sub(r"\s+", " ", r["story"].lower()).strip()
        keys = {x for x in (r["nick"].lower().lstrip("@"), story) if x}
        if i in exclude:
            dropped["не о неоплате (вручную)"] += 1
        elif r["screen"] == "Нет":
            dropped["не выставляет счета с отсрочкой"] += 1
        elif had_case(r) and len(re.findall(r"[а-яёa-z]{2,}", story)) < 3:
            dropped["бессмысленное описание"] += 1
        elif keys & seen:
            dropped["повтор"] += 1
        else:
            seen |= keys
            kept.append(r)
    return kept, dropped


def verdict(n, bad, good):
    return "данных мало" if n < MIN_N else "опровергнута" if bad else "подтверждается" if good else "не решено"


def summarize(rows, exclude=(), paid=0, quotes=()):
    ok, dropped = select(rows, exclude)
    known = [r for r in ok if r["cause"] and r["cause"] != "Другое"]
    fix = sum(r["cause"] in FIXABLE for r in known)
    mins = sorted(MINUTES[r["minutes"]] for r in ok if r["minutes"] in MINUTES)
    lo, hi = wilson(fix, len(known))
    share = fix / len(known) if known else None
    med = mins[len(mins) // 2] if mins else None
    count = lambda k: Counter(r[k] for r in ok if r[k]).most_common()
    return {
        "n": len(ok), "total": len(rows), "dropped": dict(dropped), "paid_rub": paid,
        "h1": {"fixable": fix, "known": len(known), "share": share, "lo": lo, "hi": hi,
               "verdict": verdict(len(known), share is not None and share < .2, share is not None and share >= 1 / 3)},
        "h2": {"median_min": med, "answers": len(mins), "verdict": verdict(len(mins), med is not None and med < 10, med is not None and med >= 20)},
        "causes": count("cause"), "roles": count("role"), "when": count("when"),
        "where": Counter(x.strip() for r in ok for x in r["where"].split(",") if x.strip()).most_common(),
        "gap_yes": sum(r["gap"] == "Да" for r in ok), "quotes": list(quotes),
    }


def slide_line(s):
    drop = sum(s["dropped"].values())
    paid = f", участникам платили {s['paid_rub']} ₽" if s["paid_rub"] else ""
    head = f"Анкет: {s['n']}, отсеяно {drop} по правилу, заданному заранее. Выборка из чатов{paid}, нерепрезентативна."
    h1, h2 = s["h1"], s["h2"]
    if h1["share"] is None:
        return head
    pc = lambda x: f"{x * 100:.0f}%"
    return f"{head} Устранимых причин {pc(h1['share'])} (95% интервал {pc(h1['lo'])}–{pc(h1['hi'])}), медиана времени на выяснение около {h2['median_min']} мин."


def to_md(s):
    rows = lambda items: "\n".join(f"| {k} | {v} |" for k, v in items)
    quotes = "\n## Цитаты\n\n" + "\n\n".join(f"> {q}" for q in s["quotes"]) + "\n" if s["quotes"] else ""
    return f"""# Итоги опроса

Собрано автоматически: `python tools/survey_results.py`. Персональных данных здесь нет.

{slide_line(s)}

- H1, не меньше трети просрочек устранимы: {s['h1']['fixable']} из {s['h1']['known']}, вердикт: {s['h1']['verdict']}.
- H2, на выяснение причины от 20 минут: медиана {s['h2']['median_min']} мин по {s['h2']['answers']} ответам, вердикт: {s['h2']['verdict']}.
- Кассовый разрыв за полгода: {s['gap_yes']} из {s['n']}.
- Отсеяно: {s['dropped'] or 'никого'}.

## Причины

| Причина | Анкет |
|---|---|
{rows(s['causes'])}

## Роли

| Роль | Анкет |
|---|---|
{rows(s['roles'])}

## Где ищут причину

| Канал | Анкет |
|---|---|
{rows(s['where'])}
{quotes}"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("file")
    ap.add_argument("--paid", type=int, default=0, help="сколько рублей платили за анкету; попадает на слайд")
    ap.add_argument("--exclude", type=int, nargs="*", default=[], help="номера анкет с описанием не о неоплате")
    ap.add_argument("--quote", action="append", default=[], help="обезличенная цитата для слайда")
    a = ap.parse_args()
    rows = read_rows(a.file)
    s = summarize(rows, a.exclude, a.paid, a.quote)
    (OUT / "survey_results.json").write_text(json.dumps(s, ensure_ascii=False, indent=1), encoding="utf-8")
    (OUT / "survey_results.md").write_text(to_md(s), encoding="utf-8")
    print(slide_line(s))
    print("\nОписания для проверки и выбора цитат (не публикуются, уберите названия компаний):")
    for i, r in enumerate(rows, 1):
        print(f"{i}. {r['story']}")


if __name__ == "__main__":
    main()

import csv
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
from survey_results import read_rows, slide_line, summarize, wilson

HEAD = ["ID", "Ваша компания выставляет счета другим компаниям с отсрочкой оплаты?", "Ваша роль", "Сколько счетов в месяц", "Какая доля счетов оплачивается",
        "Когда клиент последний раз не оплатил счёт вовремя?", "Почему клиент не оплатил тот счёт", "Опишите этот случай", "Сколько времени ушло",
        "Где обычно ищете причину", "Был ли за полгода кассовый разрыв", "Ник в Telegram"]


def row(n, screen="Да", when="1–3 месяца назад", cause="Нет денег", story=None, minutes="10–30 минут", nick=""):
    return [n, screen, "Собственник", "До 10", "До 10%", when, cause, f"Клиент номер {n} долго не платил нам за работу" if story is None else story, minutes, "Почта", "Да", nick]


def load(tmp_path, lines):
    p = tmp_path / "x.csv"
    with p.open("w", encoding="utf-8-sig", newline="") as f:
        csv.writer(f, delimiter=";").writerows([HEAD, *lines])
    return read_rows(p)


def test_selection_and_hypotheses(tmp_path):
    good = [row(i, cause="Ждал документ или исправление" if i % 2 else "Нет денег") for i in range(1, 21)]
    rows = load(tmp_path, good + [row(21, screen="Нет"), row(22, story="ааа"), row(23, story="Клиент номер 1 долго не платил нам за работу"),
                                  row(24, cause="", when="Такого не было", minutes="", story="")])
    s = summarize(rows, paid=100)
    assert s["n"] == 21 and sum(s["dropped"].values()) == 3
    assert s["h1"]["known"] == 20 and s["h1"]["fixable"] == 10 and s["h1"]["verdict"] == "подтверждается"
    assert s["h2"]["median_min"] == 20
    line = slide_line(s)
    assert "платили 100 ₽" in line and "нерепрезентативна" in line


def test_small_sample_and_no_nicks_in_output(tmp_path):
    s = summarize(load(tmp_path, [row(1, nick="@secret"), row(2, nick="@secret")]))
    assert s["n"] == 1 and s["h1"]["verdict"] == "данных мало"
    assert "secret" not in str(s)


def test_wilson():
    lo, hi = wilson(10, 20)
    assert round(lo, 2) == 0.3 and round(hi, 2) == 0.7

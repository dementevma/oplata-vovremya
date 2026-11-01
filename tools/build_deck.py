"""Собирает презентацию спринта 1.

Запуск: python tools/build_deck.py [выход.pptx]
Графика лежит в docs/deck_img. Итоги опроса подставляются из docs/research/custdev/survey_results.json,
пока файла нет, на слайде 7 остаётся место для ответов. Все цифры есть в docs/product/05_evidence_register.md.
"""
import json
import re
import sys
from pathlib import Path

from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.dml import MSO_LINE_DASH_STYLE
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
from pptx.util import Inches, Pt

ROOT = Path(__file__).resolve().parents[1]
IMG = ROOT / "docs" / "deck_img"
OUT = sys.argv[1] if len(sys.argv) > 1 else str(ROOT / "ПРЕЗЕНТАЦИЯ ОПЛАТА ВОВРЕМЯ.pptx")
RESULTS = ROOT / "docs" / "research" / "custdev" / "survey_results.json"
DEMO_URL = "dementevma.github.io/oplata-vovremya"
CODE_URL = "github.com/dementevma/oplata-vovremya"
DISK_URL = "disk.yandex.ru/d/iJfn5z7CR6Zg-A"

BLUE, DEEP, CYAN, ICE, INK, GREY, WHITE, RED = "0A2FD0", "061A5E", "009FDF", "E8EEFF", "0A1433", "5B6685", "FFFFFF", "E5352B"
HEAD, BODY = "Impact", "Arial"
rgb = RGBColor.from_string

prs = Presentation()
prs.slide_width, prs.slide_height = Inches(13.333), Inches(7.5)
blank = prs.slide_layouts[6]
speech = []


def text(s, x, y, w, h, value, size=18, color=INK, head=False, bold=False, align=None, anchor=None, name=None, spacing=None):
    tb = s.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    if name:
        tb.name = name
    tf = tb.text_frame
    tf.word_wrap = True
    tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0
    if anchor:
        tf.vertical_anchor = anchor
    for i, line in enumerate(value if isinstance(value, list) else [value]):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        if align:
            p.alignment = align
        if spacing:
            p.line_spacing = spacing
        # В Impact нет знака рубля: ставим его жирным Arial, иначе он выходит тоньше цифр.
        for part in re.split("(₽)", line):
            if not part:
                continue
            r = p.add_run()
            r.text = part
            r.font.name, r.font.size, r.font.bold = BODY if part == "₽" and head else HEAD if head else BODY, Pt(size), bold or (part == "₽" and head)
            r.font.color.rgb = rgb(color)
    return tb


def box(s, x, y, w, h, fill=ICE, radius=0.06, line=None, dash=False, shape=MSO_SHAPE.ROUNDED_RECTANGLE):
    b = s.shapes.add_shape(shape, Inches(x), Inches(y), Inches(w), Inches(h))
    if shape == MSO_SHAPE.ROUNDED_RECTANGLE:
        b.adjustments[0] = radius
    b.shadow.inherit = False
    if fill:
        b.fill.solid()
        b.fill.fore_color.rgb = rgb(fill)
    else:
        b.fill.background()
    if line:
        b.line.color.rgb = rgb(line)
        b.line.width = Pt(2)
        if dash:
            b.line.dash_style = MSO_LINE_DASH_STYLE.DASH
    else:
        b.line.fill.background()
    return b


def pic(s, name, x, y, w=None, h=None, alt=""):
    p = s.shapes.add_picture(str(IMG / name), Inches(x), Inches(y), Inches(w) if w else None, Inches(h) if h else None)
    p.name = alt or name
    p._element.nvPicPr.cNvPr.set("descr", alt)
    return p


def slide(dark=False, notes="", foot=True):
    s = prs.slides.add_slide(blank)
    if dark:
        pic(s, "bg_blue.jpg", 0, 0, 13.333, 7.5, "Фон")
    fg = WHITE if dark else BLUE
    text(s, 0.55, 0.32, 3.5, 0.3, "ОПЛАТА ВОВРЕМЯ", size=12, color=fg, bold=True)
    pic(s, "vtb_white.png" if dark else "vtb_color.png", 11.75, 0.26, h=0.38, alt="Логотип ВТБ")
    if foot:
        text(s, 0.55, 7.08, 8, 0.25, "Академия Финтеха 2026 · Финтех без границ", size=10, color=WHITE if dark else GREY)
        text(s, 11.8, 7.08, 1.0, 0.25, str(len(prs.slides)), size=10, color=WHITE if dark else GREY, align=PP_ALIGN.RIGHT)
    if notes:
        s.notes_slide.notes_text_frame.text = notes
        speech.append(notes)
    return s


def title(s, value, size=None, color=BLUE, w=12.2, y=0.68):
    # Заголовок на всю ширину в одну строку: кегль считаем от длины, средняя ширина буквы Impact 0,0076 дюйма на пункт.
    fit = min(84, int(w / (len(value) * 0.0076)))
    return text(s, 0.55, y, w, 1.2, value, size=fit, color=color, head=True, name="Заголовок", spacing=0.92)


def number(s, x, y, w, value, label, size=66, color=BLUE, lcolor=INK, lsize=17):
    text(s, x, y, w, size / 72 * 1.25, value, size=size, color=color, head=True)
    text(s, x, y + size / 72 * 1.3, w, 1.2, label, size=lsize, color=lcolor)


# ---------- 1. Обложка ----------
s = prs.slides.add_slide(blank)
pic(s, "wall_light.png", 0, 5.65, 13.333, alt="Стена просроченных счетов")
pic(s, "vtb_color.png", 0.6, 0.4, h=0.55, alt="Логотип ВТБ")
pic(s, "organizers.png", 10.45, 0.42, w=2.4, alt="Организаторы: ВТБ и Финансовый университет")
text(s, 0.5, 1.05, 9.2, 3.6, ["ОПЛАТА", "ВОВРЕМЯ"], size=122, color=BLUE, head=True, name="Заголовок", spacing=0.88)
text(s, 0.6, 4.45, 6.0, 0.9, "Показывает, почему клиент не платит по счёту и как получить деньги", size=22, bold=True)
pic(s, "misha_full.png", 9.72, 2.5, h=5.0, alt="Михаил Дементьев")
pic(s, "ivan_full.png", 6.6, 1.65, h=5.85, alt="Иван Сороковых")
s.notes_slide.notes_text_frame.text = "Оплата вовремя. Помощник для малого бизнеса в ВТБ Бизнес."

# ---------- 2. Масштаб ----------
s = slide(foot=False, notes="Девять триллионов рублей просроченной дебиторки в России. И это без малого бизнеса: его в этой статистике нет.")
pic(s, "wall_light.png", 0, 4.55, 13.333, alt="Стена просроченных счетов")
text(s, 0.5, 0.65, 12.4, 3.0, "9 ТРЛН ₽", size=210, color=BLUE, head=True, name="Заголовок")
text(s, 0.6, 3.72, 11.5, 0.9, "просрочили российским компаниям к маю 2026 года. Малый бизнес в эту цифру даже не входит.", size=24, bold=True)

# ---------- 3. Боль ----------
s = slide(dark=True, notes="40 процентов компаний называют неплатежи главным ограничением. У малого бизнеса старые долги растут вдвое быстрее, чем у крупного. При ставке 14 процентов каждый день ожидания стоит денег, а до суда в прошлом году дошли больше 300 тысяч дел.")
title(s, "БОЛЬНЕЕ ВСЕГО МАЛОМУ БИЗНЕСУ", color=WHITE)
for i, (v, l) in enumerate([("40%", "компаний называют неплатежи главным ограничением"),
                            ("+3,4 П.П.", "за квартал выросла доля долгов старше 60 дней у малого бизнеса. У крупного +1,7"),
                            ("14%", "ключевая ставка: каждый день ожидания стоит денег"),
                            ("318 609", "дел о взыскании с компаний дошло до арбитража за 2025 год")]):
    number(s, 0.55 + (i % 2) * 6.3, 2.05 + (i // 2) * 2.45, 5.8, v, l, size=80, color=WHITE, lcolor=WHITE, lsize=18)

# ---------- 4. История ----------
s = slide(notes="У бухгалтера в списке долгов строка: Уралстройинвест, 612 тысяч, просрочка 18 дней. Что он сделает? Отправит напоминание. А клиент давно ответил: в УПД старый КПП, переоформите, и мы заплатим. Деньги есть, клиент готов, письмо затерялось.")
title(s, "612 000 ₽ ЗАВИСЛИ ИЗ-ЗА ОДНОЙ СТРОКИ", size=60)
box(s, 0.55, 2.1, 4.9, 3.5, ICE)
text(s, 0.85, 2.32, 4.3, 0.3, "Что видит бухгалтер", size=14, color=GREY, bold=True)
text(s, 0.85, 2.72, 4.3, 0.4, "АО «Уралстройинвест», счёт № 1057", size=16, bold=True)
text(s, 0.85, 3.12, 4.3, 1.0, "612 000 ₽", size=60, color=BLUE, head=True)
text(s, 0.85, 4.15, 4.3, 0.4, "просрочка 18 дней", size=18, color=RED, bold=True)
box(s, 0.85, 4.72, 2.9, 0.55, BLUE, radius=0.5)
text(s, 0.85, 4.72, 2.9, 0.55, "Напомнить ещё раз", size=16, color=WHITE, bold=True, align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
box(s, 5.75, 2.1, 7.05, 3.5, BLUE)
text(s, 6.1, 2.32, 6.4, 0.3, "Что клиент написал 12 октября", size=14, color=WHITE, bold=True)
text(s, 6.1, 2.8, 6.4, 2.7, "«УПД отклонён в Диадоке: в документе указан старый КПП нашей организации. Переоформите УПД, и мы поставим оплату в ближайший платёжный день.»", size=25, color=WHITE)
text(s, 0.55, 5.85, 12.2, 0.8, "ДЕНЬГИ ЕСТЬ. КЛИЕНТ ЖДЁТ ОДНУ БУМАГУ", size=42, color=INK, head=True)
text(s, 8.3, 7.08, 3.5, 0.25, "Пример из демо, компании вымышлены", size=10, color=GREY, align=PP_ALIGN.RIGHT)

# ---------- 5. Где причина ----------
s = slide(dark=True, notes="Причина задержки обычно уже известна, но лежит где-то в почте, в мессенджере, в 1С или в ЭДО. Учётная система показывает только сумму и срок. Мы предполагаем, что на разбор одного счёта уходит от 20 минут, и проверяем это опросом.")
title(s, "ПРИЧИНА РАЗБРОСАНА ПО ШЕСТИ МЕСТАМ", color=WHITE, size=60)
for i, w_ in enumerate(["ПОЧТА", "МЕССЕНДЖЕРЫ", "ЗВОНКИ", "1С", "ЭДО", "БАНК-КЛИЕНТ"]):
    x, y = 0.55 + (i % 3) * 4.15, 2.05 + (i // 3) * 1.25
    b = box(s, x, y, 3.95, 1.05, WHITE, radius=0.2)
    text(s, x, y, 3.95, 1.05, w_, size=32, color=BLUE, head=True, align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
text(s, 0.55, 4.9, 7.2, 1.1, "ОТ 20 МИНУТ НА СЧЁТ", size=50, color=WHITE, head=True)
text(s, 0.55, 5.95, 7, 0.8, "Наша гипотеза, проверяем опросом", size=18, color=WHITE)
text(s, 7.75, 4.98, 5.0, 1.8, "В списке долгов только сумма и срок. А бухгалтеру нужно быстро понять, что мешает клиенту заплатить, и сделать одно верное действие.", size=20, color=WHITE, bold=True)

# ---------- 6. Разные взгляды ----------
s = slide(notes="Британское исследование, 300 интервью. Сами плательщики в 90 процентах случаев говорят об ошибках, спорах и потерянных счетах, и только в 5 об экономике. Поставщики уверены, что дело в деньгах. Значит, значительную часть задержек можно снять, если вовремя понять причину. Российских данных о причинах мы не нашли и проверяем их сами.")
title(s, "ПЛАТЕЛЬЩИК И ПОСТАВЩИК ВИДЯТ РАЗНОЕ", size=58)


def bars(x, head_, rows, color):
    text(s, x, 2.0, 5.9, 0.4, head_, size=18, bold=True)
    for i, (l, v) in enumerate(rows):
        y = 2.5 + i * 0.68
        text(s, x, y, 3.0, 0.55, l, size=15, anchor=MSO_ANCHOR.MIDDLE)
        box(s, x + 3.05, y + 0.07, max(0.12, v / 40 * 2.1), 0.41, color, radius=0.25)
        text(s, x + 3.15 + v / 40 * 2.1, y, 0.8, 0.55, f"{v}%", size=22, color=color, head=True, anchor=MSO_ANCHOR.MIDDLE)


bars(0.55, "Плательщики о своих задержках", [("Административные ошибки", 36), ("Спорные счета", 31), ("Потерянный счёт", 23), ("Экономика", 5)], BLUE)
bars(6.95, "Поставщики о задержках клиентов", [("Клиентам самим платят поздно", 40), ("Экономика", 29), ("Ошибки", 24)], CYAN)
box(s, 0.55, 5.3, 12.25, 1.45, BLUE)
text(s, 0.85, 5.3, 2.9, 1.45, "90%", size=84, color=WHITE, head=True, anchor=MSO_ANCHOR.MIDDLE)
text(s, 3.5, 5.3, 9.0, 1.45, "задержек плательщики объясняют ошибками, спорами и потерянными счетами. Это можно исправить.", size=24, color=WHITE, bold=True, anchor=MSO_ANCHOR.MIDDLE)
text(s, 8.3, 7.08, 3.5, 0.25, "Великобритания, 2024, 300 интервью", size=10, color=GREY, align=PP_ALIGN.RIGHT)

# ---------- 7. Опрос ----------
R = json.loads(RESULTS.read_text(encoding="utf-8")) if RESULTS.exists() else None
pc = lambda x: f"{x * 100:.0f}%"
s = slide(notes="Мы спросили российские компании о последнем просроченном счёте. Сколько причин можно устранить своими силами и сколько времени уходит на выяснение, видно здесь. Выборка из чатов, она нерепрезентативна, поэтому дальше интервью и разбор реальных счетов.")
title(s, "ЧТО ОТВЕЧАЮТ РОССИЙСКИЕ КОМПАНИИ")
cells = [(str(R["n"]) if R else "ИДЁТ СБОР", "анкет после отбора"),
         (pc(R["h1"]["share"]) if R and R["h1"]["share"] is not None else "ОТ 33%", "причин можно устранить самим" if R else "гипотеза: столько причин можно устранить самим"),
         (f"{R['h2']['median_min']} МИН" if R and R["h2"]["median_min"] else "ОТ 20 МИН", "медиана времени на выяснение причины" if R else "гипотеза: столько уходит на выяснение причины")]
for i, (v, l) in enumerate(cells):
    x = 0.55 + i * 4.15
    box(s, x, 2.05, 3.95, 2.6, ICE if R else None, radius=0.07, line=None if R else BLUE, dash=True)
    text(s, x + 0.28, 2.3 if R else 2.45, 3.4, 1.4, v, size=78 if R else 52, color=BLUE, head=True, name=f"Опрос {i + 1}")
    text(s, x + 0.28, 3.65, 3.4, 0.9, l, size=17)
quote = R["quotes"][0] if R and R["quotes"] else "Опрос идёт в Яндекс Формах. Итоги и цитаты добавим сюда, как только соберём ответы."
box(s, 0.55, 4.9, 12.25, 1.45, BLUE if R and R["quotes"] else None, radius=0.1, line=None if R and R["quotes"] else BLUE, dash=True)
text(s, 0.85, 4.9, 11.65, 1.45, f"«{quote}»" if R and R["quotes"] else quote, size=24, color=WHITE if R and R["quotes"] else BLUE, bold=True, anchor=MSO_ANCHOR.MIDDLE, name="Цитата")
paid = f", участникам платили {R['paid_rub']} ₽" if R and R["paid_rub"] else ""
text(s, 0.55, 6.5, 12.25, 0.4, f"Гипотеза: не меньше трети просрочек устранимы, опровергнута при доле меньше 20%. Выборка из чатов{paid}, нерепрезентативна.", size=14, color=GREY)

# ---------- 8. Решение ----------
s = slide(dark=True, notes="В открытых источниках мы не нашли сервиса с такой логикой. Оплата вовремя читает переписку и документы, называет причину по каждому счёту, показывает цитату-основание и готовит следующий шаг. Понять письмо помогает модель Jev, черновик пишет GigaChat, суммы и сроки считает обычный код. Решение всегда за человеком.")
title(s, "ПРИЧИНА И ШАГ ПО КАЖДОМУ СЧЁТУ", color=WHITE, y=0.62)
text(s, 0.55, 1.58, 12.2, 0.35, "Находит причину неоплаты по переписке и даёт действие на каждую. Такого сервиса мы в открытых источниках не нашли", size=14, color=WHITE, bold=True)
for i, (h_, b_) in enumerate([("ЧИТАЕТ", "переписку и документы"), ("НАЗЫВАЕТ", "причину и цитату-основание"), ("ГОТОВИТ", "письмо, QR на оплату и претензию")]):
    y = 2.1 + i * 1.5
    text(s, 0.55, y, 4.3, 0.8, h_, size=44, color=WHITE, head=True)
    text(s, 0.55, y + 0.78, 4.3, 0.5, b_, size=18, color=WHITE)
text(s, 0.55, 6.42, 4.2, 0.6, "Jev понимает письмо, GigaChat пишет черновик, суммы считает код. Работает в контуре банка.", size=12, color=WHITE)
box(s, 5.0, 2.0, 7.95, 4.85, WHITE, radius=0.03)
pic(s, "today_crop.jpg", 5.08, 2.08, 7.79, alt="Экран «Сегодня» в демо")

# ---------- 9. Действия ----------
s = slide(notes="Для каждой причины своё действие. При споре напоминания на паузу, при нехватке денег график и оценка риска, при ошибке в реквизитах верные реквизиты и QR. Письма сервис только готовит, отправляет человек.")
title(s, "У КАЖДОЙ ПРИЧИНЫ СВОЁ ДЕЙСТВИЕ", size=62)
items = [("НЕТ ДОКУМЕНТА", "Исправить и отправить в ЭДО"), ("СПОР", "Сверить с договором, напоминания на паузу"), ("НЕТ ДЕНЕГ", "График платежей и оценка риска"), ("СОГЛАСОВАНИЕ", "Записать дату реестра"),
         ("РЕКВИЗИТЫ", "Верные реквизиты и QR на оплату"), ("МОЛЧИТ", "Напомнить, затем позвонить"), ("УЖЕ ОПЛАТИЛ", "Найти в выписке, закрыть счёт"), ("ЧЕЛОВЕК", "Подтверждает каждое внешнее действие")]
for i, (h_, b_) in enumerate(items):
    x, y = 0.55 + (i % 4) * 3.1, 2.05 + (i // 4) * 2.45
    last = i == 7
    box(s, x, y, 2.95, 2.25, BLUE if last else ICE, radius=0.08)
    text(s, x + 0.2, y + 0.22, 2.6, 0.7, h_, size=28, color=WHITE if last else BLUE, head=True)
    text(s, x + 0.2, y + 0.95, 2.55, 1.2, b_, size=17, color=WHITE if last else INK)

# ---------- 10. Деньги ----------
s = slide(dark=True, notes="Через неделю не хватает на зарплату и лизинг, при этом клиенты должны 5 миллионов. Сервис подбирает счета с подписанным актом и собирает реестр для факторинга. Так клиент приходит в факторинг банка в тот момент, когда он ему нужен.")
title(s, "ЧЕРЕЗ НЕДЕЛЮ НЕ ХВАТИТ НА ЗАРПЛАТУ", color=WHITE, size=60)
box(s, 0.55, 2.15, 5.85, 3.5, WHITE, radius=0.06)
text(s, 0.85, 2.4, 5.3, 1.4, "−212 599 ₽", size=72, color=RED, head=True)
text(s, 0.85, 3.85, 5.3, 1.5, "кассовый разрыв на неделе 4–10 ноября. Клиенты при этом должны 5 млн ₽.", size=20)
a = box(s, 6.48, 3.5, 0.4, 0.8, WHITE, shape=MSO_SHAPE.RIGHT_ARROW)
box(s, 6.95, 2.15, 5.85, 3.5, WHITE, radius=0.06)
text(s, 7.25, 2.4, 5.3, 1.4, "+811 260 ₽", size=72, color=BLUE, head=True)
text(s, 7.25, 3.85, 5.3, 1.5, "факторинг по 3 счетам с подписанными актами. Стоимость около 7 819 ₽.", size=20)
text(s, 0.55, 5.95, 12.2, 0.8, "Оплата на 4 дня раньше при выручке 24 млн ₽: 263 тыс. ₽ оборотных средств и около 60 часов бухгалтера в год. Гипотеза пилота.", size=20, color=WHITE, bold=True)
text(s, 7.8, 7.08, 4.0, 0.25, "Данные демо, условия факторинга условные", size=10, color=WHITE, align=PP_ALIGN.RIGHT)

# ---------- 11. ВТБ ----------
s = slide(notes="Для банка это 520 тысяч компаний, функция для клиента бесплатна. Банк зарабатывает на остатках и факторинге: около 100 миллионов в год в базовом сценарии, окупаемость около 15 месяцев. В пессимистичном сценарии не окупается, поэтому главное проверяет пилот: рубли, возвращённые в срок до плюс семи дней.")
title(s, "ЧТО ПОЛУЧАЕТ ВТБ", size=66)
for i, (v, l) in enumerate([("520 ТЫС.", "клиентов МСБ с продажами другим компаниям"), ("15,6 ТЫС.", "активных компаний на второй год, 3%"), ("~100 МЛН ₽", "дохода в год на остатках и факторинге"), ("15 МЕС.", "окупаемость в базовом сценарии")]):
    number(s, 0.55 + i * 3.1, 2.0, 2.9, v, l, size=42, lsize=15)
text(s, 0.55, 3.95, 12.25, 0.4, "Главная метрика: рубли, возвращённые в срок до +7 дней. Цели: оплата на 4 дня раньше, 60% рекомендаций", size=15, bold=True, color=BLUE)
for i, (h_, b_) in enumerate([("ДО 15 НОЯБРЯ", "10 интервью, разбор 50 просрочек"), ("2–4 НЕДЕЛИ", "10–20 компаний вне банка"), ("1–2 МЕСЯЦА", "Тестовый контур, 100–300 клиентов"), ("ДАЛЕЕ", "Функция в интернет-банке")]):
    x = 0.55 + i * 3.1
    box(s, x, 4.55, 2.95, 1.75, BLUE if i == 2 else ICE, radius=0.08)
    text(s, x + 0.2, 4.7, 2.6, 0.5, h_, size=24, color=WHITE if i == 2 else BLUE, head=True)
    text(s, x + 0.2, 5.3, 2.6, 0.9, b_, size=16, color=WHITE if i == 2 else INK)
text(s, 0.55, 6.47, 12.2, 0.4, "Данные и модели остаются в контуре банка. Значения для банка: гипотезы, их проверяет пилот.", size=14, color=GREY)

# ---------- 12. Команда ----------
s = slide(notes="Мы уже показали работающий продукт. Следующий шаг: тестовый контур и сотня клиентов МСБ, через два месяца называем эффект в днях. Откройте демо прямо сейчас.")
title(s, "ДАЙТЕ ТЕСТОВЫЙ КОНТУР", size=78)
for i, (n_, r_, ph) in enumerate([("ИВАН СОРОКОВЫХ", "Капитан, продукт, разработка. ВШЭ, финансовые рынки", "ivan_full.png"), ("МИХАИЛ ДЕМЕНТЬЕВ", "Разработка, исследование, питч. Инженер в энергетике", "misha_full.png")]):
    x = 0.55 + i * 6.2
    pic(s, ph, x, 2.12, h=2.03, alt=n_)
    text(s, x + 1.75, 2.35, 4.3, 0.6, n_, size=30, color=BLUE, head=True)
    text(s, x + 1.75, 2.97, 4.1, 1.0, r_, size=16)
box(s, 0.55, 4.15, 12.25, 1.2, BLUE)
text(s, 0.85, 4.15, 11.7, 1.2, "Нужны 100–300 клиентов МСБ по согласию, контакт команды факторинга и требования ИБ. За два месяца измерим эффект в днях.", size=22, color=WHITE, bold=True, anchor=MSO_ANCHOR.MIDDLE)
text(s, 0.55, 5.6, 12.2, 0.5, f"ДЕМО  {DEMO_URL}", size=30, color=BLUE, head=True)
text(s, 0.55, 6.15, 12.2, 0.5, f"КОД  {CODE_URL}", size=30, color=BLUE, head=True)
text(s, 0.55, 6.72, 12.2, 0.3, f"Работает без установки: 7 разделов, 51 автотест. Источники всех цифр, финмодель и видео: {DISK_URL}", size=14, color=GREY)

prs.core_properties.author, prs.core_properties.title = "Команда «Оплата вовремя»", "Оплата вовремя"
prs.save(OUT)
print("saved", OUT, len(prs.slides))
(ROOT / "docs" / "pitch_script.md").write_text("# Текст питча\n\nНа 4 минуты, запас оставляем на сбои.\n\n" + "\n\n".join(f"**Слайд {i + 2}.** {t}" for i, t in enumerate(speech)) + "\n", encoding="utf-8")

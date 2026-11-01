// Опрос для кастдева: 11 вопросов, 4 минуты. Вопросы о прошлом случае, без рекламы продукта.
// Первый вопрос отсеивает тех, кто не выставляет счета с отсрочкой; открытый вопрос отсекает ответы наугад.
import { csvCell } from './csv.js';

const inTarget = a => !!a.screen && a.screen !== 'Нет';  // остальные вопросы — только после отсева
const hadCase = a => inTarget(a) && a.when && a.when !== 'Такого не было';

export const SURVEY = [
  { k: 'screen', q: 'Ваша компания выставляет счета другим компаниям с отсрочкой оплаты?', o: ['Да', 'Раньше да', 'Нет'] },
  { k: 'role', q: 'Ваша роль', o: ['Бухгалтер в штате', 'Бухгалтер на аутсорсе', 'Финдиректор или финменеджер', 'Собственник', 'Другое'], show: inTarget },
  { k: 'invoices', q: 'Сколько счетов в месяц выставляет компания', o: ['До 10', '10–50', '50–200', 'Больше 200'], show: inTarget },
  { k: 'late_share', q: 'Какая доля счетов оплачивается с опозданием', o: ['Почти никакая', 'До 10%', '10–30%', 'Больше 30%'], show: inTarget },
  { k: 'when', q: 'Когда клиент последний раз не оплатил счёт вовремя?', o: ['За последний месяц', '1–3 месяца назад', 'Раньше', 'Такого не было'], show: inTarget },
  { k: 'cause', q: 'Почему клиент не оплатил тот счёт', shuffle: true, o: ['Ждал документ или исправление', 'Ошибка в реквизитах, платёж вернулся', 'Платёж на согласовании', 'Спор о сумме или качестве', 'Уже оплатил, но не сверили', 'Нет денег', 'Молчит, причина неизвестна', 'Другое'], show: hadCase },
  { k: 'story', q: 'Опишите этот случай в 1–2 предложениях: что случилось и чем закончилось?', text: true, min: 20, show: hadCase },
  { k: 'minutes', q: 'Сколько времени ушло, чтобы выяснить причину', o: ['До 10 минут', '10–30 минут', '30–60 минут', 'Больше часа', 'Так и не выяснили'], show: hadCase },
  { k: 'where', q: 'Где обычно ищете причину', hint: 'можно несколько', multi: true, o: ['Почта', 'Мессенджеры', 'Звонки', '1С', 'ЭДО', 'Банк-клиент', 'Другое'], show: inTarget },
  { k: 'gap', q: 'Был ли за полгода кассовый разрыв из-за неоплат', o: ['Да', 'Нет', 'Не знаю'], show: inTarget },
  { k: 'call', q: 'Готовы ответить на 3 вопроса по телефону (15 минут)', o: ['Да', 'Нет'], show: inTarget },
];

export const visible = (x, a) => !x.show || x.show(a);

export function missing(answer) {
  return SURVEY.filter(x => visible(x, answer)).filter(x => {
    const v = answer[x.k];
    if (x.multi) return !(v || []).length;
    if (x.text) return String(v || '').trim().length < (x.min || 1);
    return !v;
  }).map(x => x.k);
}

// Причины, которые поставщик может устранить сам (гипотеза H1: их не меньше трети).
const FIXABLE = new Set(['Ждал документ или исправление', 'Ошибка в реквизитах, платёж вернулся', 'Спор о сумме или качестве', 'Уже оплатил, но не сверили', 'Молчит, причина неизвестна']);
const MINUTES_MID = { 'До 10 минут': 5, '10–30 минут': 20, '30–60 минут': 45, 'Больше часа': 75, 'Так и не выяснили': 90 };

// Правило отбора, заданное заранее: не выставляет счета с отсрочкой, бессмысленное описание или повтор — не считаем.
export function qualified(rows) {
  const seen = new Set();
  return rows.filter(r => {
    if (r.screen === 'Нет') return false;
    if (hadCase(r) && !/\p{L}{3,}.*\p{L}{3,}.*\p{L}{3,}/su.test(r.story || '')) return false;
    const key = JSON.stringify([r.nick || '', r.story || '', r.cause || '', r.role || '']);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Итоги для команды: доля устранимых причин (H1) и медиана времени на выяснение (H2) по отобранным анкетам.
export function summary(rows) {
  const ok = qualified(rows);
  const withCause = ok.filter(r => r.cause && r.cause !== 'Другое');
  const mins = ok.map(r => MINUTES_MID[r.minutes]).filter(Boolean).sort((a, b) => a - b);
  return {
    n: ok.length,
    dropped: rows.length - ok.length,
    fixableShare: withCause.length ? withCause.filter(r => FIXABLE.has(r.cause)).length / withCause.length : null,
    medianMinutes: mins.length ? mins[Math.floor(mins.length / 2)] : null,
  };
}

export function surveyCsv(rows) {
  const cols = ['at', ...SURVEY.map(x => x.k), 'nick', 'consent'];
  return '﻿' + [cols.join(';'), ...rows.map(r => cols.map(c => csvCell(Array.isArray(r[c]) ? r[c].join(', ') : r[c])).join(';'))].join('\r\n');
}

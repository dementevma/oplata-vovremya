// Движок: объединяет ответы Jev (или правила), прогноз оплаты и следующий шаг по каждому счёту.
import { analyzeRules, promiseDate } from './rules.js';
import { addDays, diffDays, phi } from './util.js';

export const CAUSE_KEYS = ['documents', 'dispute', 'liquidity', 'approval', 'details', 'silence', 'paid'];

export function balance(inv) { return Math.max(0, Math.round((inv.amount - (inv.paid || 0)) * 100) / 100); }
export function daysLate(inv, today) { return balance(inv) > 0 ? Math.max(0, diffDays(today, inv.due)) : 0; }

// ---------- Прогноз (веса обучены в pipeline/forecast.py) ----------
export function features(model, f) {
  const x = {
    late_share: f.late_share, avg_delay_log: Math.log1p(f.avg_delay), days_overdue_log: Math.log1p(Math.max(0, f.days_overdue)),
    amount_log: Math.log10(Math.max(f.amount, 1000)) - 5, promise: f.promise, fixable: f.fixable, insolvency: f.insolvency,
    registry_risk: f.registry_risk,
  };
  for (const k of [...CAUSE_KEYS, 'none']) x[`cause_${k}`] = f.cause === k ? 1 : 0;
  return model.features.map(n => x[n]);
}
const dot = (w, x) => w.reduce((s, v, i) => s + v * x[i], 0);

export function forecast(model, f) {
  const x = features(model, f);
  const pPay = 1 / (1 + Math.exp(-(model.pay.intercept + dot(model.pay.coef, x))));
  const mu = model.days.intercept + dot(model.days.coef, x), s = model.days.sigma;
  const by = t => pPay * phi((Math.log(Math.max(t, 0.5)) - mu) / s);
  return { pPay, median: Math.exp(mu), by, p7: by(7), p14: by(14), p30: by(30) };
}

// ---------- Разбор одного счёта ----------
export function analyzeInvoice(inv, ctx) {
  const { today, clients, registry, analysis, model, causes } = ctx;
  const client = clients[inv.inn] || { name: inv.client || 'Клиент', history: { late_share: 0.3, avg_delay: 7, invoices: 0 } };
  const bal = balance(inv), late = daysLate(inv, today);
  const cached = analysis?.[inv.id];
  const reg = registry?.[inv.inn] || { flags: [], level: 'unknown' };
  let src, cause, probs, evidence = null, jev = null;

  if (bal === 0) {
    cause = 'closed'; src = 'ledger';
  } else if (cached?.jev) {
    jev = cached.jev.answers;
    cause = jev.cause.choice; probs = jev.cause.probabilities; src = 'jev';
    const msgs = (cached.messages || []).filter(m => m.choice === cause).sort((a, b) => (b.p?.[cause] || 0) - (a.p?.[cause] || 0) || b.index - a.index);
    const pick = msgs[0] || (cached.messages || []).slice(-1)[0];
    if (pick) evidence = { index: pick.index, text: inv.messages[pick.index].text, date: inv.messages[pick.index].date, p: pick.p?.[cause] };
  } else if ((inv.messages || []).length) {
    const r = analyzeRules(inv);
    cause = r.cause; src = 'rules';
    probs = Object.fromEntries(CAUSE_KEYS.map(k => [k, k === cause ? 0.7 : 0.3 / (CAUSE_KEYS.length - 1)]));
    if (r.messageIndex >= 0) evidence = { index: r.messageIndex, text: inv.messages[r.messageIndex].text, date: inv.messages[r.messageIndex].date, highlight: r.evidence };
  } else {
    cause = late > 0 ? 'silence' : 'none'; src = 'none';
  }

  const noul = k => (jev?.[k]?.noul ?? null);
  const lastClient = [...(inv.messages || [])].reverse().find(m => m.from === 'client');
  // Дату обещания берём из правил; дату от LLM — только если Jev подтверждает обещание (>0,5)
  // и дата не раньше письма клиента: модель иногда выдаёт за обещание постороннюю дату из текста.
  const llmDate = /^\d{4}-\d{2}-\d{2}$/.test(cached?.llm?.promised_date || '') ? cached.llm.promised_date : null;
  const promised = promiseDate(lastClient?.text, lastClient?.date) ||
    (llmDate && (jev?.promise?.noul ?? 0) > 0.5 && lastClient && llmDate >= lastClient.date ? llmDate : null);
  const brokenPromise = promised && promised < today && bal > 0;
  const f = {
    late_share: client.history?.late_share ?? 0.3, avg_delay: client.history?.avg_delay ?? 7, days_overdue: late, amount: bal,
    promise: noul('promise') ?? (promised ? 1 : 0), fixable: causes[cause]?.fixable ? 1 : 0,
    insolvency: noul('insolvency') ?? (cause === 'liquidity' ? 0.8 : 0.05),
    registry_risk: ['high', 'critical'].includes(reg.level) ? 1 : 0, cause: cause === 'closed' ? 'none' : cause,
  };
  const fc = bal > 0 ? forecast(model, f) : null;
  const urgency = jev?.urgency ? jev.urgency.score / 4 : Math.min(1, late / 30);
  // Деньги под риском: остаток × вероятность не получить его за 14 дней
  const atRisk = fc ? bal * (1 - fc.p14) : 0;
  const priority = bal > 0 ? atRisk * (0.6 + 0.4 * urgency) * (causes[cause]?.fixable ? 1.25 : 1) : 0;
  return {
    inv, client, reg, bal, late, cause, probs, src, evidence, jev, promised, brokenPromise, fc, urgency, atRisk, priority,
    llm: cached?.llm || null, state: bal === 0 ? 'paid' : late > 0 ? 'late' : 'open',
  };
}

// ---------- Следующий шаг ----------
export function nextSteps(a, ctx) {
  const c = a.cause, inv = a.inv, steps = [];
  const due3 = addDays(ctx.today, 3);
  if (c === 'documents') {
    const asks = String(a.llm?.client_asks ?? '').trim();  // модель пишет «нет», «ничего», «null» вместо пустого ответа
    const realAsk = asks && !/^(null|none|нет|ничего|[-—])\.?$/i.test(asks) && !/просьб\p{L}* .*нет/iu.test(asks);
    steps.push({ t: 'Проверить, какой документ нужен', d: realAsk ? `Клиент просит: ${asks}` : 'По цитате из переписки' });
    steps.push({ t: inv.docs?.edo ? 'Отправить исправленный документ через ЭДО' : 'Отправить документ и предложить ЭДО', d: 'Подписанный в ЭДО документ виден клиенту сразу, бумага идёт неделю' });
    steps.push({ t: 'Попросить дату оплаты после получения', d: 'Письмо ниже' });
    steps.push({ t: `Проверить поступление ${due3.split('-').reverse().slice(0, 2).join('.')}`, d: 'Сервис напомнит' });
  } else if (c === 'dispute') {
    steps.push({ t: 'Сверить претензию с договором и актом', d: 'Найти пункт, на который ссылается клиент' });
    steps.push({ t: 'Напоминания об оплате — на паузе', d: 'Пока спор не снят, давление портит отношения и не ускоряет оплату' });
    steps.push({ t: 'Предложить созвон или акт сверки', d: 'Письмо ниже' });
    steps.push({ t: 'Оплату бесспорной части запросить отдельно', d: 'Не держать всю сумму из-за спорной части' });
  } else if (c === 'liquidity') {
    steps.push({ t: 'Зафиксировать график платежей письменно', d: 'Даты и суммы, подпись ответственного' });
    steps.push({ t: 'Остановить новые отгрузки в долг', d: a.reg.flags.length ? 'По реестрам есть сигналы риска' : 'До первого платежа по графику' });
    if (a.late > 30) steps.push({ t: 'Подготовить претензию', d: 'Обязательный досудебный порядок — 30 дней (АПК РФ, ст. 4)' });
  } else if (c === 'approval') {
    steps.push({ t: 'Записать дату реестра или платёжного дня', d: a.promised ? `Клиент назвал ${a.promised.split('-').reverse().join('.')}` : 'Спросить у казначейства' });
    steps.push({ t: 'Не давить: проконтролировать в день после даты', d: 'Повторное напоминание раньше срока портит отношения' });
  } else if (c === 'details') {
    steps.push({ t: 'Отправить реквизиты письмом за подписью', d: 'Сверить БИК, р/с и наименование с банком' });
    steps.push({ t: 'Приложить платёжную ссылку СБП', d: 'Клиенту не нужно перебивать реквизиты' });
  } else if (c === 'paid') {
    steps.push({ t: 'Найти платёж в выписке', d: 'Раздел «Сверка выписки»' });
    steps.push({ t: 'Закрыть счёт и отправить акт сверки', d: 'Без напоминания об оплате' });
  } else if (c === 'none') {
    if (inv.docs?.act === 'not_sent') steps.push({ t: 'Отправить акт через ЭДО до срока оплаты', d: 'Без акта клиент не сможет оплатить вовремя — это самая частая причина просрочки' });
    else if (inv.docs?.act === 'sent') steps.push({ t: 'Попросить подписать акт до срока', d: 'Неподписанный акт — риск задержки' });
    steps.push({ t: `Напомнить за 2 дня до срока (${addDays(inv.due, -2).split('-').reverse().slice(0, 2).join('.')})`, d: 'Мягкое напоминание с платёжной ссылкой' });
  } else if (c === 'silence') {
    steps.push({ t: a.brokenPromise ? 'Напомнить об обещанной дате' : 'Отправить короткое напоминание', d: 'С платёжной ссылкой и вопросом, всё ли в порядке с документами' });
    steps.push({ t: 'Позвонить, если нет ответа 2 рабочих дня', d: 'Звонок раскрывает настоящую причину' });
  }
  return steps;
}

// ---------- Портфель ----------
export function portfolio(list, ctx) {
  const open = list.filter(a => a.bal > 0);
  const total = open.reduce((s, a) => s + a.bal, 0);
  const late = open.filter(a => a.late > 0);
  const lateSum = late.reduce((s, a) => s + a.bal, 0);
  const dso = ctx.supplier.monthly_revenue ? (total / ctx.supplier.monthly_revenue) * 30 : 0;
  const exp14 = open.reduce((s, a) => s + a.bal * a.fc.p14, 0);
  const byCause = {};
  for (const a of late) (byCause[a.cause] ||= { n: 0, sum: 0 }), byCause[a.cause].n++, byCause[a.cause].sum += a.bal;
  const fixableSum = late.filter(a => ctx.causes[a.cause]?.fixable).reduce((s, a) => s + a.bal, 0);
  return { total, lateSum, lateN: late.length, openN: open.length, dso, exp14, byCause, fixableSum };
}

// Возраст просрочки (aging): сколько денег висит 1–15, 16–30, 31–60 и больше 60 дней.
export const AGING = [[1, 15, '1–15 дней'], [16, 30, '16–30 дней'], [31, 60, '31–60 дней'], [61, Infinity, 'больше 60 дней']];
export function aging(list) {
  return AGING.map(([lo, hi, label]) => {
    const rows = list.filter(a => a.bal > 0 && a.late >= lo && a.late <= hi);
    return { label, n: rows.length, sum: rows.reduce((s, a) => s + a.bal, 0) };
  });
}

// Обещания оплаты (promise-to-pay): даты, которые клиент назвал в переписке, и выполнены ли они.
export function promises(list, today) {
  return list.filter(a => a.promised).map(a => ({
    a, date: a.promised,
    status: a.bal === 0 ? 'kept' : a.brokenPromise ? 'broken' : a.promised === today ? 'today' : 'waiting',
  })).sort((x, y) => ({ broken: 0, today: 1, waiting: 2, kept: 3 }[x.status] - { broken: 0, today: 1, waiting: 2, kept: 3 }[y.status]) || x.date.localeCompare(y.date));
}

// Вопрос обычными словами: «сколько должен Уралстройинвест», «кто должен больше всех», «что просрочено».
const stem = w => w.toLowerCase().replace(/ё/g, 'е').slice(0, 5);
const words = s => (s.toLowerCase().replace(/ё/g, 'е').match(/\p{L}{3,}/gu) || []).filter(w => !['ооо', 'зао', 'пао'].includes(w));
export function answerQuestion(q, list) {
  const open = list.filter(a => a.bal > 0), qs = new Set(words(q).map(stem));
  const byClient = {};
  for (const a of open) (byClient[a.client.name] ||= []).push(a);
  const hit = Object.keys(byClient).filter(name => words(name).some(w => w.length >= 4 && qs.has(stem(w))));
  const lateOnly = [...qs].some(s => s.startsWith('проср'));
  const sum = rows => rows.reduce((s, a) => s + a.bal, 0);
  if (hit.length) {
    return hit.map(name => {
      const rows = byClient[name].filter(a => !lateOnly || a.late > 0);
      return { kind: 'client', name, total: sum(rows), late: sum(rows.filter(a => a.late > 0)), rows };
    });
  }
  if ([...qs].some(s => ['больш', 'топ', 'кто'].some(k => s.startsWith(k)))) {
    return Object.entries(byClient).map(([name, rows]) => ({ kind: 'client', name, total: sum(rows), late: sum(rows.filter(a => a.late > 0)), rows }))
      .sort((x, y) => y.late - x.late || y.total - x.total).slice(0, 3);
  }
  if (lateOnly || [...qs].some(s => ['всего', 'сколь', 'долг', 'должн'].includes(s))) {
    const rows = lateOnly ? open.filter(a => a.late > 0) : open;
    return [{ kind: 'total', name: lateOnly ? 'Все просроченные счета' : 'Все открытые счета', total: sum(rows), late: sum(rows.filter(a => a.late > 0)), rows }];
  }
  return [];
}

export const NEW_SALES = { startWeek: 3, share: 0.8 };

// Прогноз денежного потока по неделям: ожидаемые поступления против плановых платежей.
export function cashflow(list, ctx, weeks = 8) {
  const open = list.filter(a => a.bal > 0);
  let cash = ctx.supplier.cash_on_hand;
  const rows = [];
  for (let w = 0; w < weeks; w++) {
    const t0 = w * 7, t1 = (w + 1) * 7;
    const inflow = open.reduce((s, a) => {
      // Счета в срок: допущение «раньше срока не платят», отсчёт от даты оплаты по договору
      const dueIn = Math.max(0, diffDays(a.inv.due, ctx.today));
      const F = t => (a.state === 'open' ? (t > dueIn ? a.fc.by(t - dueIn) : 0) : t > 0 ? a.fc.by(t) : 0);
      return s + a.bal * Math.max(0, F(t1) - F(t0));
    }, 0);
    // Новые продажи: счета, которые ещё не выставлены. Допущение — выручка по плану, оплата через ~3 недели,
    // 80% в срок. Без этой строки прогноз занижает поступления в конце горизонта.
    const sales = w >= NEW_SALES.startWeek ? (ctx.supplier.monthly_revenue || 0) / 4.33 * NEW_SALES.share : 0;
    const outflow = (ctx.outflows || []).filter(o => o.week === w).reduce((s, o) => s + o.amount, 0);
    const opening = cash;
    cash = cash + inflow + sales - outflow;
    rows.push({ week: w, from: addDays(ctx.today, t0), to: addDays(ctx.today, t1 - 1), inflow: inflow + sales, current: inflow, sales, outflow, opening, closing: cash, items: (ctx.outflows || []).filter(o => o.week === w) });
  }
  return rows;
}

// Факторинг: какие счета можно профинансировать сейчас (без спора, с подписанным актом, без критичных сигналов).
export function factoring(list, ctx, { advance = 0.9, annual = 0.14 + 0.05, fee = 0.005 } = {}) {
  return list.filter(a => a.bal > 0).map(a => {
    const reasons = [];
    if (a.inv.docs?.act !== 'signed') reasons.push('акт не подписан');
    if (a.cause === 'dispute') reasons.push('есть спор');
    if (['high', 'critical'].includes(a.reg.level)) reasons.push('сигналы риска по дебитору');
    if (a.cause === 'liquidity') reasons.push('у дебитора нет денег');
    if (a.cause === 'paid') reasons.push('счёт, вероятно, уже оплачен');
    const daysToPay = Math.max(7, Math.round(a.fc.median + Math.max(0, diffDays(a.inv.due, ctx.today))));
    const amount = a.bal * advance;
    const cost = amount * annual * daysToPay / 365 + a.bal * fee;
    return { a, ok: reasons.length === 0, reasons, amount, cost, daysToPay };
  });
}

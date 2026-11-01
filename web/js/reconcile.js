// Сверка выписки с реестром счетов.
// Платёж сопоставляется по ИНН плательщика, номерам счетов в назначении платежа и сумме.
// Каждое сопоставление объясняется: какие признаки совпали.

import { amount, validDate } from './util.js';

// Формат обмена 1С: Клиент-банк (1CClientBankExchange) — его выгружает любой российский банк.
export function parse1C(text) {
  if (!/^\s*1CClientBankExchange/.test(text)) throw new Error('Это не файл обмена 1С: Клиент-банк (первая строка 1CClientBankExchange).');
  const docs = [];
  let cur = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('СекцияДокумент')) cur = {};
    else if (line === 'КонецДокумента') { if (cur) docs.push(cur); cur = null; }
    else if (cur && line.includes('=')) { const i = line.indexOf('='); cur[line.slice(0, i)] = line.slice(i + 1); }
  }
  return docs.map(d => ({
    date: validDate(d['ДатаПоступило'] || d['Дата']) || '', num: d['Номер'] || '', payer: d['Плательщик1'] || d['Плательщик'] || '',
    payer_inn: d['ПлательщикИНН'] || '', amount: amount(d['Сумма']) ?? 0, purpose: d['НазначениеПлатежа'] || '',
    receiver_inn: d['ПолучательИНН'] || '',
  })).filter(p => p.amount > 0);
}

export function to1C(payments, receiverInn) {
  const lines = ['1CClientBankExchange', 'ВерсияФормата=1.03', 'Кодировка=Windows', 'Отправитель=Демо'];
  for (const p of payments) {
    lines.push('СекцияДокумент=Платежное поручение', `Номер=${p.num}`, `Дата=${p.date.split('-').reverse().join('.')}`,
      `Сумма=${p.amount.toFixed(2)}`, `ПлательщикИНН=${p.payer_inn}`, `Плательщик1=${p.payer}`, `ПолучательИНН=${receiverInn}`,
      `ДатаПоступило=${p.date.split('-').reverse().join('.')}`, `НазначениеПлатежа=${p.purpose}`, 'КонецДокумента');
  }
  lines.push('КонецФайла');
  return lines.join('\r\n');
}

const NUMS = s => [...String(s).matchAll(/(?:сч(?:[её]т[уа]?)?\.?|№|счетам|счетов)\s*№?\s*([\d][\d,\s и]*)/gi)]
  .flatMap(m => m[1].split(/[,\sи]+/)).map(x => x.trim()).filter(x => /^\d{3,}$/.test(x));

export function reconcile(payments, invoices) {
  const open = invoices.map(i => ({ ...i, rest: Math.max(0, i.amount - (i.paid || 0)) }));
  const result = [];
  for (const p of payments) {
    if (p.posted) { result.push({ p, match: [], why: ['уже учтён в реестре'], conf: 1, status: 'posted' }); continue; }
    const mentioned = NUMS(p.purpose);
    const sameInn = open.filter(i => i.inn === p.payer_inn);
    let match = [], why = [], conf = 0;
    const byNum = sameInn.filter(i => mentioned.includes(i.id));
    if (byNum.length) {
      const sum = byNum.reduce((s, i) => s + i.amount, 0);
      match = byNum; why.push(`${byNum.length > 1 ? 'номера счетов' : 'номер счёта'} в назначении: ${byNum.map(i => i.id).join(', ')}`, 'ИНН плательщика совпадает');
      if (Math.abs(sum - p.amount) < 1) { why.push('сумма совпадает'); conf = 0.99; }
      else if (p.amount < sum) { why.push('частичная оплата'); conf = 0.9; }
      else { why.push('сумма больше счёта — переплата'); conf = 0.75; }
    } else if (sameInn.length) {
      const exact = sameInn.filter(i => Math.abs(i.rest - p.amount) < 1 || Math.abs(i.amount - p.amount) < 1);
      if (exact.length === 1) {
        match = exact; conf = mentioned.length ? 0.7 : 0.85;
        why.push('ИНН плательщика совпадает', 'сумма совпадает с единственным счётом', mentioned.length ? 'номер в назначении не совпадает — проверьте' : 'номер счёта не указан');
        if (/договор/i.test(p.purpose)) why.push('в назначении номер договора вместо счёта');
      } else if (exact.length > 1) {
        match = []; conf = 0.4; why.push(`ИНН совпадает, сумма подходит к ${exact.length} счетам — нужен выбор`);
      } else {
        why.push('ИНН совпадает, но ни сумма, ни номер не подходят'); conf = 0.3;
      }
    } else {
      why.push('плательщика нет в реестре счетов');
    }
    // Повторная загрузка выписки: счёт уже закрыт, второй раз этот платёж учитывать нельзя.
    if (match.length && match.every(m => m.rest < 1)) { result.push({ p, match, why: ['счёт уже оплачен'], conf: 1, status: 'posted' }); continue; }
    result.push({ p, match, why, conf, status: match.length && conf >= 0.85 ? 'auto' : match.length ? 'check' : 'unmatched' });
  }
  return result;
}

// Применить сопоставления к реестру: учесть оплаты, начиная с более старых счетов.
export function applyMatches(invoices, results) {
  const map = new Map(invoices.map(i => [i.id + '|' + i.inn, { ...i }]));
  for (const r of results) {
    if (!r.match.length || r.applied === false) continue;
    let left = r.p.amount;
    for (const m of [...r.match].sort((a, b) => a.due.localeCompare(b.due))) {
      const inv = map.get(m.id + '|' + m.inn);
      const take = Math.min(left, inv.amount - (inv.paid || 0));
      inv.paid = Math.round(((inv.paid || 0) + take) * 100) / 100;
      left -= take;
    }
  }
  return [...map.values()];
}

// Импорт реестра счетов из CSV (выгрузка из 1С, Excel или CRM) и экспорт обратно.
import { amount, validDate } from './util.js';

export function parseCsv(text, today) {
  text = text.replace(/^﻿/, '');
  const first = text.split(/\r?\n/)[0];
  const sep = first.includes(';') ? ';' : ',';
  const rows = [];
  let row = [], cell = '', quoted = false, closed = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (quoted && text[i + 1] === '"') { cell += '"'; i++; }
      else if (quoted) { quoted = false; closed = true; }
      else if (cell === '' && !closed) quoted = true;
      else throw new Error('Некорректные кавычки в CSV. Скачайте образец и проверьте формат.');
    } else if (!quoted && (ch === sep || ch === '\n' || ch === '\r')) {
      row.push(cell); cell = ''; closed = false;
      if (ch !== sep) { if (ch === '\r' && text[i + 1] === '\n') i++; if (row.some(x => x.trim())) rows.push(row); row = []; }
    } else {
      if (closed && !/\s/.test(ch)) throw new Error('После закрывающей кавычки ожидается разделитель.');
      if (!closed) cell += ch;
    }
  }
  if (quoted) throw new Error('В CSV не закрыты кавычки.');
  row.push(cell); if (row.some(x => x.trim())) rows.push(row);
  if (rows.length < 2) throw new Error('В файле нужны заголовки и хотя бы один счёт.');
  const aliases = {
    invoice_id: 'id', номер: 'id', счет: 'id', счёт: 'id', client: 'client', клиент: 'client', контрагент: 'client', inn: 'inn', инн: 'inn',
    amount: 'amount', сумма: 'amount', paid: 'paid', оплачено: 'paid', due_date: 'due', срок: 'due', issued: 'issued', дата: 'issued',
    owner: 'owner', ответственный: 'owner', context: 'context', контекст: 'context', переписка: 'context', act: 'act', акт: 'act',
  };
  const headers = rows.shift().map(s => aliases[s.trim().toLowerCase()]);
  if (!['id', 'client', 'amount', 'due'].every(k => headers.includes(k))) throw new Error('Нужны колонки invoice_id, client, amount, due_date. Скачайте образец CSV.');
  if (headers.filter(Boolean).length !== new Set(headers.filter(Boolean)).size) throw new Error('В CSV повторяются колонки.');
  if (rows.length > 2000) throw new Error('Можно загрузить до 2 000 счетов.');
  const seen = new Set();
  return rows.map((cells, i) => {
    if (cells.length !== headers.length) throw new Error(`Строка ${i + 2}: число полей не совпадает с заголовками.`);
    const o = { paid: '0', owner: 'Не назначен', context: '', inn: '', issued: '', act: '' };
    headers.forEach((k, j) => { if (k) o[k] = cells[j].trim(); });
    const inv = {
      id: o.id, client: o.client, inn: /^\d{10}(\d{2})?$/.test(o.inn) ? o.inn : 'csv:' + o.client.toLowerCase(),
      amount: amount(o.amount), paid: o.paid === '' ? 0 : amount(o.paid), due: validDate(o.due), issued: validDate(o.issued) || validDate(o.due),
      owner: o.owner, docs: { act: ['signed', 'sent', 'not_sent', 'rejected'].includes(o.act) ? o.act : 'unknown', edo: false },
      messages: o.context ? [{ date: today, from: 'client', text: o.context.slice(0, 20000) }] : [], label: 'none', imported: true,
    };
    if (!inv.id || !inv.client || inv.amount === null || inv.paid === null || !inv.due || inv.paid > inv.amount)
      throw new Error(`Строка ${i + 2}: проверьте номер, клиента, сумму, оплату и дату. Оплата не может превышать сумму счёта.`);
    const key = inv.inn + '\0' + inv.id;
    if (seen.has(key)) throw new Error(`Строка ${i + 2}: повтор счёта ${inv.id} у того же клиента.`);
    seen.add(key);
    return inv;
  });
}

export function csvCell(v) { let s = String(v ?? ''); if (/^[=+@\-\t\r]/.test(s)) s = "'" + s; return '"' + s.replaceAll('"', '""') + '"'; }

export function exportCsv(list) {
  const h = ['invoice_id', 'client', 'inn', 'amount', 'paid', 'due_date', 'owner', 'cause', 'p_pay_14d', 'next_step'];
  return '﻿' + [h.join(';'), ...list.map(a => [a.inv.id, a.client.name, a.inv.inn, a.inv.amount, a.inv.paid || 0, a.inv.due, a.inv.owner,
    a.cause, a.fc ? a.fc.p14.toFixed(2) : '', a.next || ''].map(csvCell).join(';'))].join('\r\n');
}

export const SAMPLE = 'invoice_id;client;inn;amount;paid;due_date;owner;act;context\r\n' +
  '501;ООО «Пример»;7700000001;120000;0;2026-10-10;Анна;sent;"Не получили подписанный акт, пришлите повторно — без него не проведём оплату."\r\n' +
  '502;ООО «Ромашка»;7700000002;64000;0;2026-10-20;Иван;signed;"Счёт на согласовании у директора, оплатим 05.11.2026."\r\n' +
  '503;ИП Смирнов;;35000;0;2026-11-12;Иван;not_sent;\r\n';

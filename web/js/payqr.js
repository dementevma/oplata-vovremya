// Платёжный QR по ГОСТ Р 56042-2014: его читают приложения российских банков, менять кассы и оборудование не нужно.
// Клиенту не надо перебивать реквизиты, а номер счёта в назначении платежа делает автосверку точной.
export function payload(sup, inv, sum) {
  const clean = s => String(s).replace(/\|/g, ' ');
  const f = {
    Name: sup.name, PersonalAcc: sup.account, BankName: sup.bank_name, BIC: sup.bik, CorrespAcc: sup.corr, PayeeINN: sup.inn, KPP: sup.kpp,
    Sum: Math.round(sum * 100), Purpose: `Оплата по счёту № ${inv.id}${inv.issued ? ' от ' + inv.issued.split('-').reverse().join('.') : ''}`,
  };
  return 'ST00013|' + Object.entries(f).map(([k, v]) => `${k}=${clean(v)}`).join('|'); // ST00013 — кодировка UTF-8
}

export function qrSvg(text, size = 190) {
  const q = globalThis.qrcode;
  if (!q) return '';
  q.stringToBytes = s => [...new TextEncoder().encode(s)];
  const qr = q(0, 'M');
  qr.addData(text, 'Byte');
  qr.make();
  const n = qr.getModuleCount(), q0 = 4, u = n + q0 * 2;
  let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + q0} ${r + q0}h1v1h-1z`;
  return `<svg class="qr" viewBox="0 0 ${u} ${u}" width="${size}" height="${size}" role="img" aria-label="Платёжный QR-код" shape-rendering="crispEdges"><rect width="${u}" height="${u}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}

// Заявка на факторинг: реестр уступки по счетам с подписанным актом.
export function assignmentCsv(rows, supplier) {
  const h = ['Поставщик', 'ИНН поставщика', 'Дебитор', 'ИНН дебитора', 'Счёт', 'Дата', 'Срок оплаты', 'Сумма требования', 'Аванс'];
  const cell = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  return '﻿' + [h.map(cell).join(';'), ...rows.map(x => [supplier.name, supplier.inn, x.a.client.name, x.a.inv.inn, x.a.inv.id, x.a.inv.issued, x.a.inv.due, x.a.bal, Math.round(x.amount)].map(cell).join(';'))].join('\r\n');
}

// Календарь: шаги из «Моих действий» как события .ics.
export function tasksIcs(tasks) {
  const esc = s => String(s).replace(/([,;\\])/g, '\\$1');
  const ev = tasks.filter(t => !t.done).map(t => ['BEGIN:VEVENT', `UID:${t.id}@oplata-vovremya`, `DTSTART;VALUE=DATE:${t.due.replace(/-/g, '')}`,
    `SUMMARY:${esc(t.t)} (${esc(t.client)}, счёт ${esc(t.inv)})`, 'END:VEVENT'].join('\r\n'));
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Oplata Vovremya//RU', ...ev, 'END:VCALENDAR'].join('\r\n');
}

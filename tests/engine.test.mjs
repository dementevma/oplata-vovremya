import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { analyzeInvoice, nextSteps, portfolio, cashflow, factoring, forecast, balance, daysLate } from '../web/js/engine.js';
import { classifyText, analyzeRules, promiseDate } from '../web/js/rules.js';
import { reconcile, applyMatches, parse1C, to1C } from '../web/js/reconcile.js';
import { interest395, claimText, letterTemplate } from '../web/js/documents.js';
import { parseCsv, exportCsv, csvCell, SAMPLE } from '../web/js/csv.js';
import { validDate, amount } from '../web/js/util.js';

const read = p => JSON.parse(fs.readFileSync(new URL('../web/data/' + p, import.meta.url), 'utf8'));
const demo = read('demo.json'), model = read('forecast_model.json'), ev = read('eval.json');
const ctx = { today: demo.meta.demo_date, clients: demo.clients, registry: demo.registry, analysis: demo.analysis, model, causes: demo.causes, supplier: demo.supplier, outflows: demo.outflows };
const list = demo.invoices.map(i => analyzeInvoice(i, ctx));
const get = id => list.find(a => a.inv.id === id);

test('Jev определяет причину по всей истории счёта для всех размеченных демо-счетов', () => {
  const labeled = list.filter(a => a.inv.label !== 'none' && a.src === 'jev');
  assert.ok(labeled.length >= 18);
  for (const a of labeled) assert.equal(a.cause, a.inv.label, `счёт ${a.inv.id}`);
});

test('трудные случаи: отрицание и устаревший сигнал', () => {
  assert.equal(get('1067').cause, 'approval');   // «Деньги есть, дело не в этом»
  assert.equal(get('1069').cause, 'liquidity');  // сначала просили акт, потом «банк заморозил линию»
  assert.equal(get('1069').evidence.index, 2);   // основание — последнее письмо, а не запрос акта
});

test('правила — базовая линия не хуже 75% на размеченной выборке, Jev не хуже правил', () => {
  const rows = ev.rows.filter(r => !r.excluded);
  const rules = rows.filter(r => classifyText(r.text).cause === r.label).length / rows.length;
  const jev = rows.filter(r => r.jev.pred === r.label).length / rows.length;
  assert.ok(rules >= 0.75, `rules=${rules}`);
  assert.ok(jev >= rules, `jev=${jev} rules=${rules}`);
});

test('правила: кириллические границы слов и отрицания', () => {
  assert.equal(classifyText('У вас в счёте БИК, которого нет в справочнике.').cause, 'details');
  assert.equal(classifyText('Акт получили, вопросов по документам нет.').cause, 'silence');
  assert.equal(analyzeRules({ messages: [{ from: 'client', text: 'Пришлите акт' }, { from: 'client', text: 'Оплатили вчера, п/п 12' }] }).cause, 'paid');
});

test('дата обещания — только из предложения с будущей оплатой и не раньше письма', () => {
  assert.equal(promiseDate('Остаток оплатим 15.10.2026.', '2026-10-09'), '2026-10-15');
  assert.equal(promiseDate('Платёж от 18 октября вернулся банком.', '2026-10-21'), null);
  assert.equal(promiseDate('КПП изменился с 1 сентября. Поставим оплату в ближайший платёжный день.', '2026-10-12'), null);
  assert.equal(get('1039').brokenPromise, true);
});

test('прогноз: вероятности монотонны и в [0,1], нет денег < документы', () => {
  for (const a of list.filter(x => x.fc)) {
    assert.ok(a.fc.p7 <= a.fc.p14 && a.fc.p14 <= a.fc.p30 && a.fc.p30 <= a.fc.pPay + 1e-9);
    assert.ok(a.fc.p7 >= 0 && a.fc.pPay <= 1);
  }
  const base = { late_share: 0.3, avg_delay: 7, days_overdue: 10, amount: 2e5, promise: 0, fixable: 1, insolvency: 0.05, registry_risk: 0 };
  assert.ok(forecast(model, { ...base, cause: 'documents' }).p14 > forecast(model, { ...base, cause: 'liquidity', fixable: 0, insolvency: 0.9 }).p14);
});

test('портфель и кассовый разрыв считаются', () => {
  const p = portfolio(list, ctx);
  assert.ok(p.total > p.lateSum && p.lateSum > p.fixableSum && p.fixableSum > 0);
  const cf = cashflow(list, ctx);
  assert.equal(cf.length, 8);
  assert.ok(cf.some(w => w.closing < 0), 'в демо есть разрыв');
  assert.ok(Math.abs(cf[0].opening - demo.supplier.cash_on_hand) < 1);
});

test('факторинг не берёт спор, неподписанный акт и проблемного дебитора', () => {
  const fx = factoring(list, ctx);
  for (const x of fx.filter(y => y.ok)) {
    assert.equal(x.a.inv.docs.act, 'signed');
    assert.notEqual(x.a.cause, 'dispute');
    assert.ok(!['high', 'critical'].includes(x.a.reg.level));
  }
  assert.equal(fx.find(x => x.a.inv.id === '1045').ok, false);
});

test('сверка: несколько счетов в одном платеже, номер договора вместо счёта, учтённые платежи не дублируются', () => {
  const r = reconcile(demo.statement, demo.invoices);
  const by = n => r.find(x => x.p.num === n);
  assert.deepEqual(by('7781').match.map(m => m.id).sort(), ['1044', '1047']);
  assert.equal(by('7781').status, 'auto');
  assert.deepEqual(by('4412').match.map(m => m.id), ['1056']);
  assert.equal(by('2290').status, 'posted');
  assert.equal(by('5120').status, 'unmatched');
  const after = applyMatches(demo.invoices, r.filter(x => x.status === 'auto'));
  for (const id of ['1044', '1047', '1056']) assert.equal(balance(after.find(i => i.id === id)), 0);
  assert.equal(after.find(i => i.id === '1066').paid, 210000); // не задвоено
});

test('файл 1С: Клиент-банк — запись и разбор туда-обратно', () => {
  const p = parse1C(to1C(demo.statement, demo.supplier.inn));
  assert.equal(p.length, demo.statement.length);
  assert.equal(p[0].amount, demo.statement[0].amount);
  assert.equal(p[0].date, demo.statement[0].date);
  assert.throws(() => parse1C('not a bank file'));
});

test('проценты по ст. 395 ГК и претензия', () => {
  const r = interest395(365000, '2026-08-01', '2026-08-11');
  assert.equal(Math.round(r.total), 1400); // 365 000 × 14% × 10 / 365
  const a = get('1049');
  const t = claimText(a, demo.supplier, ctx.today);
  assert.match(t, /ПРЕТЕНЗИЯ/);
  assert.match(t, /395/);
  assert.match(t, /158\s000/);
});

test('шаблон письма не утверждает, что документ уже отправлен', () => {
  for (const a of list.filter(x => x.bal > 0)) assert.doesNotMatch(letterTemplate(a, demo.supplier).body, /акт (уже )?отправлен/i);
});

test('письма GigaChat: проверка фактов ловит выдуманное число', () => {
  assert.deepEqual(demo.analysis['1066'].llm.invalid_numbers, ['17']);
});

test('следующий шаг есть для каждого открытого счёта', () => {
  for (const a of list.filter(x => x.bal > 0)) assert.ok(nextSteps(a, ctx).length > 0, a.inv.id);
});

test('CSV: образец, кириллица, отказ на ошибках, защита от формул', () => {
  const rows = parseCsv(SAMPLE, '2026-10-28');
  assert.equal(rows.length, 3);
  assert.equal(rows[2].inn, 'csv:ип смирнов');
  for (const s of ['invoice_id;client;amount;due_date\n1;A;100;2026-02-30', 'invoice_id;client;amount;paid;due_date\n1;A;100;101;2026-01-01', 'invoice_id;client;amount;due_date\n1;"A;100;2026-01-01'])
    assert.throws(() => parseCsv(s, '2026-10-28'));
  assert.equal(csvCell('=1+1'), '"\'=1+1"');
  assert.match(exportCsv(list.slice(0, 2)), /invoice_id;client/);
});

test('даты и суммы', () => {
  assert.equal(validDate('2026-02-30'), null);
  assert.equal(validDate('11.10.2026'), '2026-10-11');
  assert.equal(amount('30 000,50 ₽'), 30000.5);
  assert.equal(amount('-1'), null);
  assert.equal(daysLate({ amount: 10, paid: 0, due: '2026-10-20' }, '2026-10-28'), 8);
});

test('вопрос обычными словами находит клиента и считает долг', async () => {
  const { answerQuestion } = await import('../web/js/engine.js');
  const [r] = answerQuestion('сколько должен Уралстройинвест?', list);
  assert.equal(r.name, 'АО «Уралстройинвест»');
  assert.equal(r.total, list.filter(a => a.client.name === r.name && a.bal > 0).reduce((s, a) => s + a.bal, 0));
  assert.equal(answerQuestion('какая погода', list).length, 0);
});

test('возраст просрочки делит все просроченные счета без остатка', async () => {
  const { aging } = await import('../web/js/engine.js');
  const late = list.filter(a => a.bal > 0 && a.late > 0);
  assert.equal(aging(list).reduce((s, b) => s + b.n, 0), late.length);
});

test('проверка письма: перепутанные стороны, даты словами, без выдуманных ссылок', async () => {
  const { letterIssues, tidyLetter } = await import('../web/js/documents.js');
  assert.equal(letterIssues('Просим Вас предоставить нам исправленный документ через ЭДО.', 'documents').length, 1);
  assert.equal(letterIssues('Просим подписать акт и направить нам обратно.', 'documents').length, 0);
  assert.equal(tidyLetter('Cчёт от 2026-10-02, оплата: https://example.com/pay/1. Спасибо'), 'Счёт от 2 октября, оплата: [ссылка на оплату через СБП]. Спасибо');
});

test('опрос: отсев, условные вопросы и итоги по H1 и H2', async () => {
  const { summary, missing, qualified } = await import('../web/js/survey.js');
  const base = { screen: 'Да', when: 'За последний месяц', story: 'Клиент ждал исправленный акт, после отправки оплатил' };
  const rows = [
    { ...base, cause: 'Ждал документ или исправление', minutes: '30–60 минут' },
    { ...base, cause: 'Нет денег', minutes: 'До 10 минут', story: 'Денег нет, обещали заплатить позже' },
    { ...base, cause: 'Другое', minutes: 'Так и не выяснили', story: 'Не ответили на письма и звонки вообще' },
    { screen: 'Нет' },                                   // отсев
    { ...base, cause: 'Нет денег', story: 'ок' },        // бессмысленное описание
    { ...base, cause: 'Ждал документ или исправление', minutes: '30–60 минут' },  // повтор
  ];
  assert.equal(qualified(rows).length, 3);
  const s = summary(rows);
  assert.equal(s.dropped, 3);
  assert.equal(s.fixableShare, 0.5);   // «Другое» не входит в знаменатель
  assert.equal(s.medianMinutes, 45);
  assert.deepEqual(missing({ screen: 'Нет' }), []);   // после «Нет» вопросов больше нет
  assert.ok(missing({ screen: 'Да', when: 'Такого не было' }).every(k => !['cause', 'story', 'minutes'].includes(k)));
  assert.ok(missing({ screen: 'Да', when: 'Раньше', story: 'коротко' }).includes('story'));
});

// ---------- Проверка документа, QR, взыскание ----------
import { innValid, kppValid, accountValid, parseDoc, checkDoc } from '../web/js/doccheck.js';
import { courtFee, recoveryPath, legalTerm } from '../web/js/legal.js';
import { payload, assignmentCsv, tasksIcs } from '../web/js/payqr.js';

const sample = k => demo.doc_samples.find(x => x.key === k);
const docCtx = id => { const invoice = demo.invoices.find(i => i.id === id); return { invoice, client: demo.clients[invoice.inn], supplier: demo.supplier }; };

test('контрольные суммы ИНН и счёта', () => {
  assert.ok(innValid('7702070139'));   // ИНН из открытого реестра
  assert.ok(!innValid('7702070130'));
  assert.ok(innValid('500100732259'));
  assert.ok(kppValid('770401001') && !kppValid('7704'));
  assert.ok(accountValid(demo.supplier.account, demo.supplier.bik));
  assert.ok(accountValid(demo.supplier.corr, demo.supplier.bik, true));
  assert.ok(!accountValid(demo.supplier.account.slice(0, -1) + '7', demo.supplier.bik));
  for (const inn of [demo.supplier.inn, ...Object.keys(demo.clients)]) assert.ok(innValid(inn), inn);
});

test('проверка документа находит ту ошибку, что держит оплату', () => {
  const upd = checkDoc(sample('upd').text, docCtx('1057'));
  assert.equal(upd.type, 'УПД');
  assert.ok(upd.issues.some(i => /КПП покупателя 745701001 устарел/.test(i.t)));
  const inv = checkDoc(sample('invoice').text, docCtx('1054'));
  assert.ok(inv.issues.some(i => /контрольный ключ/.test(i.t)));
  const act = checkDoc(sample('act').text, docCtx('1045'));
  assert.ok(act.issues.some(i => /не совпадает со счётом/.test(i.t)));
  assert.ok(act.issues.some(i => /подпись/.test(i.t)));
  const ok = checkDoc(sample('ok').text, docCtx('1073'));
  assert.deepEqual(ok.issues, []);
  assert.equal(checkDoc('просто текст').type, null);
});

test('XML УПД разбирается из атрибутов', () => {
  const xml = '<?xml version="1.0"?><Файл><Документ><СвСчФакт НомерСчФ="77" ДатаСчФ="01.10.2026"><СвПрод><ИдСв><СвЮЛУч ИННЮЛ="7702070139" КПП="784201001"/></ИдСв></СвПрод><СвПокуп><ИдСв><СвЮЛУч ИННЮЛ="7704123450" КПП="770401001"/></ИдСв></СвПокуп></СвСчФакт><ВсегоОпл СтТовУчНалВсего="1200.00"/><Подписант/></Документ></Файл>';
  const f = parseDoc(xml);
  assert.equal(f.type, 'upd');
  assert.equal(f.number, '77');
  assert.equal(f.total, 1200);
  assert.equal(f.seller.inn, '7702070139');
  assert.equal(f.buyer.kpp, '770401001');
  assert.equal(f.signature, true);
});

test('госпошлина и выбор процедуры', () => {
  assert.equal(courtFee(50000), 10000);
  assert.equal(courtFee(100000), 10000);
  assert.equal(courtFee(500000), 30000);
  assert.equal(courtFee(1000000), 55000);
  const small = recoveryPath({ bal: 50000, inv: { inn: '7702070139', due: '2026-10-01' } }, '2026-10-28');
  assert.equal(small.proc, 'Судебный приказ');
  assert.equal(small.fee, 8000);
  assert.equal(recoveryPath({ bal: 900000, inv: { inn: '7702070139', due: '2026-10-01' } }, '2026-10-28').proc, 'Упрощённое производство');
  assert.equal(recoveryPath({ bal: 900000, inv: { inn: '500100732259', due: '2026-10-01' } }, '2026-10-28').proc, 'Иск в общем порядке');
  assert.equal(recoveryPath({ bal: 2e6, inv: { inn: '7702070139', due: '2026-10-01' } }, '2026-10-28').proc, 'Иск в общем порядке');
  assert.match(legalTerm({ sector: 'Госзаказ (223-ФЗ)' }), /7 рабочих дней/);
  assert.equal(legalTerm({ sector: 'Ритейл' }), '');
});

test('платёжный QR: формат ГОСТ, сумма в копейках, номер счёта в назначении', () => {
  const p = payload(demo.supplier, { id: '1042', issued: '2026-09-19' }, 184000.5);
  assert.match(p, /^ST00013\|Name=/);
  assert.match(p, /\|Sum=18400050\|/);
  assert.match(p, /Purpose=Оплата по счёту № 1042 от 19\.09\.2026$/);
  assert.match(p, new RegExp(`PersonalAcc=${demo.supplier.account}`));
  // назначение из QR автосверка понимает
  const r = reconcile([{ num: '1', date: '2026-10-20', payer: 'X', payer_inn: demo.invoices[0].inn, amount: demo.invoices[0].amount, purpose: `Оплата по счёту № ${demo.invoices[0].id} от 19.09.2026` }], demo.invoices);
  assert.equal(r[0].status, 'auto');
});

test('реестр уступки и календарь', () => {
  const rows = factoring(list, ctx).filter(x => x.ok).slice(0, 2);
  const csv = assignmentCsv(rows, demo.supplier);
  assert.match(csv, /ИНН дебитора/);
  assert.equal(csv.trim().split('\r\n').length, 3);
  const ics = tasksIcs([{ id: 1, t: 'Позвонить; срочно', client: 'А', inv: '1', due: '2026-11-02', done: false }, { id: 2, t: 'x', client: 'Б', inv: '2', due: '2026-11-03', done: true }]);
  assert.match(ics, /DTSTART;VALUE=DATE:20261102/);
  assert.match(ics, /Позвонить\\; срочно/);
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 1);
});

test('rules: письмо с «актом» — причина в документах', () => {
  assert.equal(classifyText('Мы перешли на новую учётную систему, ваш счёт не перенёсся. Пришлите его ещё раз вместе с актом, оплатим в течение двух дней.').cause, 'documents');
});

test('сверка: повторная выписка не учитывает платёж дважды', () => {
  const inv = [{ id: '1001', inn: '77', amount: 100, paid: 100, due: '2026-10-01' }];
  const [r] = reconcile([{ num: '5', amount: 100, payer_inn: '77', purpose: 'Оплата по счёту № 1001', date: '2026-10-02' }], inv);
  assert.equal(r.status, 'posted');
});

// Проверка документа до отправки клиенту: то, из-за чего счёт потом не оплачивают.
// Без ИИ: реквизиты проверяются по контрольным суммам, суммы и стороны — со счётом и карточкой клиента.
// Новый тип документа добавляется одной записью в DOC_TYPES, новая проверка — одной функцией в CHECKS.
import { amount } from './util.js';

const sumDigits = (s, w) => w.reduce((acc, k, i) => acc + k * Number(s[i]), 0);

export function innValid(inn) {
  const s = String(inn || '');
  if (/^\d{10}$/.test(s)) return (sumDigits(s, [2, 4, 10, 3, 5, 9, 4, 6, 8]) % 11) % 10 === Number(s[9]);
  if (/^\d{12}$/.test(s)) {
    const a = (sumDigits(s, [7, 2, 4, 10, 3, 5, 9, 4, 6, 8]) % 11) % 10;
    const b = (sumDigits(s, [3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8]) % 11) % 10;
    return a === Number(s[10]) && b === Number(s[11]);
  }
  return false;
}
export const kppValid = k => /^\d{4}[\dA-Z]{2}\d{3}$/.test(String(k || ''));
export const bikValid = b => /^04\d{7}$/.test(String(b || ''));

// Контрольный ключ счёта по правилам Банка России: 3 последние цифры БИК + 20 цифр счёта, веса 7-1-3.
export function accountValid(account, bik, corr = false) {
  const a = String(account || ''), b = String(bik || '');
  if (!/^\d{20}$/.test(a) || !/^\d{9}$/.test(b)) return false;
  const prefix = corr ? '0' + b.slice(4, 6) : b.slice(-3);
  const w = [7, 1, 3];
  return [...(prefix + a)].reduce((acc, c, i) => acc + Number(c) * w[i % 3], 0) % 10 === 0;
}

export const DOC_TYPES = {
  invoice: { name: 'Счёт на оплату', match: /сч[её]т\s+(?:на оплату\s+)?№/i, needs: ['number', 'date', 'total', 'seller', 'buyer', 'account', 'bik'] },
  upd: { name: 'УПД', match: /универсальн|упд\b|СвСчФакт/i, needs: ['number', 'date', 'total', 'seller', 'buyer', 'signature'] },
  act: { name: 'Акт выполненных работ', match: /акт\s+(?:выполненных|оказанных|при[её]мки|сдачи)|акт\s*№/i, needs: ['number', 'date', 'total', 'seller', 'buyer', 'signature'] },
};

const money = s => amount(String(s).replace(/\s*(?:руб|₽).*/i, ''));
const pickParty = (text, labels) => {
  const m = new RegExp(`(?:${labels})[^\\n]*?ИНН[:\\s]*(\\d{10,12})(?:[^\\n]*?КПП[:\\s]*([\\dA-Z]{9}))?`, 'i').exec(text);
  return m ? { inn: m[1], kpp: m[2] || '' } : null;
};

// XML УПД по формату ФНС: реквизиты лежат в атрибутах.
function parseUpdXml(text) {
  const attr = n => new RegExp(`${n}="([^"]*)"`).exec(text)?.[1] || '';
  const blocks = tag => [...text.matchAll(new RegExp(`<${tag}[\\s>][\\s\\S]*?</${tag}>`, 'g'))].map(m => m[0]);
  const party = b => (b ? { inn: /ИННЮЛ="(\d+)"/.exec(b)?.[1] || /ИННФЛ="(\d+)"/.exec(b)?.[1] || '', kpp: /КПП="([^"]*)"/.exec(b)?.[1] || '' } : null);
  return {
    type: 'upd', number: attr('НомерДок') || attr('НомерСчФ'), date: (attr('ДатаДок') || attr('ДатаСчФ')).split('.').reverse().join('-'),
    total: money(attr('СтТовУчНалВсего')), vat: money(attr('СумНалВсего') || '0') || null,
    seller: party(blocks('СвПрод')[0]), buyer: party(blocks('СвПокуп')[0]), account: '', bik: '', corr: '', signature: /<Подписант/.test(text),
  };
}

export function parseDoc(text) {
  const t = String(text || '');
  if (/^\s*<\?xml|<Файл[\s>]/.test(t)) return parseUpdXml(t);
  const type = Object.keys(DOC_TYPES).find(k => DOC_TYPES[k].match.test(t)) || null;
  const d = /№\s*([\w/-]+)\s+от\s+(\d{2})\.(\d{2})\.(\d{4})/.exec(t);
  const tot = /(?:итого[^\d\n]*|всего[^\d\n]*|к оплате[^\d\n]*)(\d[\d\s ]*(?:[.,]\d{1,2})?)/i.exec(t);
  const vat = /НДС[^\d\n]*(\d[\d\s ]*(?:[.,]\d{1,2})?)/i.exec(t);
  return {
    type, number: d?.[1] || '', date: d ? `${d[4]}-${d[3]}-${d[2]}` : '',
    total: tot ? money(tot[1]) : null, vat: vat ? money(vat[1]) : null,
    seller: pickParty(t, 'продавец|поставщик|получатель|исполнитель'), buyer: pickParty(t, 'покупатель|плательщик|заказчик'),
    account: /р\/?с[:.\s№]*(\d{20})/i.exec(t)?.[1] || '', bik: /БИК[:\s]*(\d{9})/i.exec(t)?.[1] || '', corr: /к\/?с[:.\s№]*(\d{20})/i.exec(t)?.[1] || '',
    signature: /подпис[а-яё]*[^\n]*(?:есть|подписан)|\bЭП\b|электронн[а-яё]* подпис/i.test(t),
  };
}

const CHECKS = [
  (f, x) => {
    const miss = [['number', 'номер'], ['date', 'дата'], ['total', 'сумма'], ['seller', 'реквизиты продавца'], ['buyer', 'реквизиты покупателя'], ['account', 'расчётный счёт'], ['bik', 'БИК'], ['signature', 'подпись']]
      .filter(([k]) => x.type?.needs.includes(k) && !f[k]).map(([, n]) => n);
    return miss.map(n => ({ sev: n === 'подпись' ? 'bad' : 'warn', t: `Нет поля: ${n}`, why: 'Бухгалтерия клиента вернёт документ без него', fix: `Добавьте поле «${n}» и отправьте заново` }));
  },
  f => [['seller', 'продавца'], ['buyer', 'покупателя']].flatMap(([k, n]) => (f[k]?.inn && !innValid(f[k].inn)
    ? [{ sev: 'bad', t: `ИНН ${n} ${f[k].inn} не проходит контрольную сумму`, why: 'Такого ИНН не существует: опечатка', fix: 'Сверьте ИНН с ЕГРЮЛ' }] : [])),
  f => [['seller', 'продавца'], ['buyer', 'покупателя']].flatMap(([k, n]) => (f[k]?.kpp && !kppValid(f[k].kpp)
    ? [{ sev: 'bad', t: `КПП ${n} ${f[k].kpp}: неверный формат`, why: 'КПП состоит из 9 знаков', fix: 'Исправьте КПП' }] : [])),
  f => (f.bik && !bikValid(f.bik) ? [{ sev: 'bad', t: `БИК ${f.bik}: неверный формат`, why: 'Банк не примет платёж', fix: 'Возьмите БИК из справки банка' }] : []),
  f => (f.account && f.bik && bikValid(f.bik) && !accountValid(f.account, f.bik)
    ? [{ sev: 'bad', t: `Расчётный счёт ${f.account} не проходит контрольный ключ с БИК ${f.bik}`, why: 'В счёте опечатка: банк вернёт платёж, и клиент узнает об этом через несколько дней', fix: 'Сверьте счёт со справкой банка' }] : []),
  f => (f.corr && f.bik && bikValid(f.bik) && !accountValid(f.corr, f.bik, true)
    ? [{ sev: 'warn', t: `Корсчёт ${f.corr} не проходит контрольный ключ с БИК ${f.bik}`, why: 'Банк плательщика может не пропустить платёж', fix: 'Сверьте корсчёт со справкой банка' }] : []),
  f => (f.total && f.vat && f.vat > f.total * 0.25 ? [{ sev: 'warn', t: 'НДС больше 20% от суммы с налогом', why: 'Похоже на ошибку в расчёте', fix: 'Пересчитайте НДС' }] : []),
  (f, x) => (x.invoice && f.total != null && Math.abs(f.total - x.invoice.amount) >= 1
    ? [{ sev: 'bad', t: `Сумма ${f.total} ₽ не совпадает со счётом ${x.invoice.id} на ${x.invoice.amount} ₽`, why: 'Частая причина спора и задержки оплаты', fix: 'Приведите суммы к одному значению или согласуйте допсоглашение' }] : []),
  (f, x) => (x.invoice && f.buyer?.inn && f.buyer.inn !== x.invoice.inn
    ? [{ sev: 'bad', t: `ИНН покупателя ${f.buyer.inn} не совпадает с клиентом по счёту (${x.invoice.inn})`, why: 'Документ оформлен не на того контрагента', fix: 'Проверьте покупателя' }] : []),
  (f, x) => (x.supplier && f.seller?.inn && f.seller.inn !== x.supplier.inn
    ? [{ sev: 'bad', t: `ИНН продавца ${f.seller.inn} не совпадает с вашей компанией`, why: 'Документ оформлен от другого юрлица', fix: 'Проверьте реквизиты продавца' }] : []),
  (f, x) => (x.client?.kpp && f.buyer?.kpp && f.buyer.kpp !== x.client.kpp
    ? [{ sev: 'bad', t: `КПП покупателя ${f.buyer.kpp} устарел: актуальный ${x.client.kpp}`, why: 'Клиент отклонит УПД в ЭДО', fix: 'Переоформите документ с актуальным КПП' }] : []),
];

// docs: { invoice, client, supplier }
export function checkDoc(text, ctx = {}) {
  const fields = parseDoc(text);
  if (!fields.type) return { fields, type: null, issues: [{ sev: 'warn', t: 'Не удалось определить тип документа', why: 'Поддерживаются счёт, акт и УПД', fix: 'Вставьте текст документа целиком' }], ok: false };
  const type = DOC_TYPES[fields.type];
  const issues = CHECKS.flatMap(c => c(fields, { ...ctx, type }));
  return { fields, type: type.name, issues, ok: !issues.some(i => i.sev === 'bad') };
}

import { $, $$, esc, rub, mln, pct, prob, dateRu, dateShort, dateRange, days, plural, toast, download, diffDays, addDays } from './util.js';
import { analyzeInvoice, nextSteps, portfolio, cashflow, factoring, aging, promises, answerQuestion, CAUSE_KEYS, NEW_SALES } from './engine.js';
import { classifyText, promiseDate } from './rules.js';
import { reconcile, applyMatches, parse1C, to1C } from './reconcile.js';
import { letterTemplate, claimText, interest395, tidyLetter, letterIssues } from './documents.js';
import { parseCsv, exportCsv, SAMPLE } from './csv.js';
import { SURVEY, missing, summary, surveyCsv, visible } from './survey.js';
import { checkDoc, innValid } from './doccheck.js';
import { recoveryPath, legalTerm, LAW } from './legal.js';
import { payload, qrSvg, assignmentCsv, tasksIcs } from './payqr.js';

const REPO = 'https://github.com/dementevma/oplata-vovremya';

const KEY = 'oplata-v2';
const S = { demo: null, model: null, evalData: null, today: '', invoices: [], tasks: [], applied: [], statement: [], live: false, filter: 'late', q: '', open: null, imported: false };

// ---------- Состояние ----------
function save() {
  try { localStorage.setItem(KEY, JSON.stringify({ invoices: S.invoices, tasks: S.tasks, applied: S.applied, statement: S.statement, imported: S.imported, edits: S.edits, noAI: S.noAI, events: S.events, stale: S.stale })); } catch { /* приватный режим */ }
}
function restore() {
  try { const s = JSON.parse(localStorage.getItem(KEY) || 'null'); if (s?.invoices?.length) Object.assign(S, s); } catch { /* ignore */ }
}
function resetDemo() {
  S.invoices = structuredClone(S.demo.invoices); S.statement = structuredClone(S.demo.statement);
  S.tasks = []; S.applied = []; S.imported = false; S.edits = {}; S.events = []; S.stale = []; S.liveAnalysis = {};
}

// Ответ модели из сборки не относится к счёту, в переписку которого добавили новое письмо.
const demoAnalysis = () => Object.fromEntries(Object.entries(S.demo.analysis).filter(([id]) => !S.stale?.includes(id)));
const ctx = () => ({
  today: S.today, clients: S.clients, registry: S.demo.registry, analysis: S.noAI ? {} : S.imported ? S.liveAnalysis : { ...demoAnalysis(), ...S.liveAnalysis },
  model: S.model, causes: S.demo.causes, supplier: S.demo.supplier, outflows: S.demo.outflows,
});
let LIST = [];
function compute() {
  const c = ctx();
  LIST = S.invoices.map(i => analyzeInvoice(i, c)).sort((a, b) => b.priority - a.priority);
  for (const a of LIST) a.next = nextSteps(a, c)[0]?.t || (a.state === 'paid' ? 'Оплачено' : '');
  return LIST;
}
const byId = id => LIST.find(a => a.inv.id === id);
const C = k => S.demo.causes[k] || { ru: k === 'none' ? 'Срок не наступил' : k === 'closed' ? 'Оплачено' : 'Не определена', short: k === 'none' ? 'В срок' : k === 'closed' ? 'Оплачено' : '—' };
const causePill = (k, short = true) => `<span class="pill cause" style="--c:var(--c-${k})">${esc(short ? C(k).short : C(k).ru)}</span>`;
const srcTag = () => '';

// Журнал действий: те же события в пилоте уходят на сервер и считаются по всем клиентам.
function track(name, data = {}) { (S.events ||= []).push({ name, at: Date.now(), ...data }); save(); }

// ---------- Загрузка ----------
async function boot() {
  const [demo, model, ev, he] = await Promise.all(['demo', 'forecast_model', 'eval', 'honest_eval'].map(n => fetch(`web/data/${n}.json`).then(r => r.json())));
  S.demo = demo; S.model = model; S.evalData = ev; S.honest = he; S.today = demo.meta.demo_date; S.liveAnalysis = {}; S.edits = {};
  S.clients = { ...demo.clients };
  resetDemo(); restore();
  for (const i of S.invoices) if (!S.clients[i.inn]) S.clients[i.inn] = { name: i.client || 'Клиент', inn: i.inn, history: { late_share: 0.3, avg_delay: 7, invoices: 0 }, contact: '' };
  try { if (!/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) throw 0; const r = await fetch('api/health', { cache: 'no-store' }); if (r.ok) S.live = (await r.json()).jev; } catch { /* статическое демо */ }
  $('#company').textContent = demo.supplier.name;
  $('#asof').textContent = dateRu(S.today) + ' 2026';
  $('#mode-badge').hidden = !S.live;
  $('#mode-badge').textContent = 'Подключено к серверу';
  $('#import-btn').onclick = importDialog;
  $('#reset-btn').onclick = () => { if (confirm('Вернуть демонстрационные данные? Ваши изменения будут удалены.')) { resetDemo(); S.noAI = false; try { localStorage.removeItem(KEY); } catch { /* ignore */ } render(); toast('Демо-данные восстановлены'); } };
  $('#scrim').onclick = closeDrawer;
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && S.open) closeDrawer(); });
  window.addEventListener('hashchange', render);
  render();
}

// ---------- Маршрутизация ----------
const VIEWS = { today: viewToday, message: viewMessage, docs: viewDocs, invoices: viewInvoices, reconcile: viewReconcile, money: viewMoney, tasks: viewTasks, quality: viewQuality, bank: viewBank, survey: viewSurvey, how: viewHow };
const TITLES = { today: 'Сегодня', message: 'Разбор письма', docs: 'Проверка документа', invoices: 'Счета', reconcile: 'Сверка выписки', money: 'Деньги сейчас', tasks: 'Мои действия', quality: 'Качество ИИ', bank: 'Для банка', survey: 'Опрос', how: 'Как это работает' };
function render() {
  compute();
  const [, view = 'today', rawArg] = location.hash.split('/');
  const arg = rawArg && decodeURIComponent(rawArg);
  const v = VIEWS[view] ? view : 'today';
  $$('#nav a').forEach(a => a.classList.toggle('active', a.dataset.view === v));
  $('#crumbs').textContent = TITLES[v];
  const p = portfolio(LIST, ctx());
  $('#nav-late').textContent = p.lateN || '';
  const rec = reconcile(S.statement, S.invoices).filter(r => r.status !== 'posted' && !S.applied.includes(r.p.num) && r.match.length);
  $('#nav-rec').textContent = rec.length || '';
  $('#nav-tasks').textContent = S.tasks.filter(t => !t.done).length || '';
  $('#demo-strip').innerHTML = S.imported ? 'Ваши данные' + (S.live ? '' : ': они не покидают браузер')
    : 'Демо: компании и суммы вымышлены';
  $('#view').innerHTML = VIEWS[v](arg);
  if (!arg) window.scrollTo(0, 0);
  bind(v);
  if (arg && v === 'invoices') openDrawer(arg);
  else { S.open = null; $('#drawer').hidden = true; $('#scrim').hidden = true; }
}

// Иконки в духе банковских: синий квадрат со скруглением и белый символ.
const GLYPH = {
  check: '<path d="M21 33l7 7 15-16"/>',
  clock: '<circle cx="32" cy="32" r="13"/><path d="M32 25v8l5 3"/>',
  rub: '<path d="M27 45V20h8a7 7 0 010 14H22M22 39h15"/>',
  chart: '<path d="M19 42l9-10 7 6 11-14"/><path d="M39 24h7v7"/>',
  cal: '<rect x="19" y="21" width="26" height="24" rx="5"/><path d="M19 29h26M26 17v7M38 17v7"/>',
  gap: '<path d="M32 19v15"/><circle cx="32" cy="43" r="1.5"/><path d="M20 47h24L32 17z" stroke-width="3.4"/>',
};
const ico = (k, light) => `<svg class="ico" viewBox="0 0 64 64" aria-hidden="true"><defs><linearGradient id="ig-${k}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4a9dff"/><stop offset="1" stop-color="#0d4fd8"/></linearGradient></defs>
  <rect x="4" y="4" width="56" height="56" rx="17" fill="${light ? '#fff' : `url(#ig-${k})`}"/><rect x="9" y="7" width="46" height="20" rx="10" fill="${light ? '#e6eefe' : '#fff'}" opacity="${light ? 1 : .2}"/>
  <g fill="none" stroke="${light ? '#0f5bf0' : '#fff'}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">${GLYPH[k]}</g></svg>`;

// ---------- Сегодня ----------
function viewToday() {
  const c = ctx(), p = portfolio(LIST, c), cf = cashflow(LIST, c), gap = cf.find(w => w.closing < 0);
  const queue = LIST.filter(a => a.bal > 0 && (a.late > 0 || a.inv.docs?.act === 'not_sent')).slice(0, 6);
  const lateCauses = Object.entries(p.byCause).sort((a, b) => b[1].sum - a[1].sum);
  const recN = reconcile(S.statement, S.invoices).filter(r => r.status === 'auto' && !S.applied.includes(r.p.num));
  const pr = promises(LIST, S.today), ag = aging(LIST);
  const tile = (k, value, label, { href, cls = '' } = {}) => `<${href ? `a href="${href}"` : 'div'} class="tile ${cls}">${ico(k, cls.includes('accent'))}<strong>${value}</strong><span>${label}</span></${href ? 'a' : 'div'}>`;
  return `
  <section class="head"><div><h1>Деньги, которые<br>пора получить</h1>
    <p class="lead">${p.lateN} ${plural(p.lateN, 'счёт просрочен', 'счёта просрочено', 'счетов просрочено')}. <b>${mln(p.fixableSum)}</b> можно вернуть своими силами.</p></div>
    <div class="hero-actions">${recN.length ? `<span class="split"><a class="btn primary lg" href="#/reconcile">Сверить</a><span><small>Нашли в выписке</small><b>${recN.length} ${recN.length === 1 ? 'платёж' : 'платежа'}</b></span></span>` : `<a class="btn primary lg" href="#/invoices">Все счета</a>`}</div></section>
  <div class="tiles">
    ${tile('check', mln(p.fixableSum), 'можно вернуть самим: документы, реквизиты, сверка', { href: '#/invoices', cls: 'accent' })}
    ${tile('clock', mln(p.lateSum), `просрочено по ${p.lateN} ${plural(p.lateN, 'счёту', 'счетам', 'счетам')}`, { href: '#/invoices', cls: 'bad' })}
    ${tile('rub', mln(p.total), `ждём от клиентов, ${p.openN} ${plural(p.openN, 'счёт', 'счёта', 'счетов')}`, { href: '#/invoices' })}
    ${tile('chart', mln(p.exp14), 'придёт за 14 дней по прогнозу', { href: '#/money' })}
    ${tile('cal', `${Math.round(p.dso)} дн.`, 'срок оборота дебиторки')}
    ${gap ? tile('gap', rub(gap.closing), `кассовый разрыв ${dateRange(gap.from, gap.to)} — как закрыть`, { href: '#/money', cls: 'bad' }) : tile('check', 'Нет', 'кассового разрыва на 8 недель', { href: '#/money' })}
  </div>

  <h2 class="sec">Что сделать сегодня</h2>
  <div class="grid g-main">
    <div class="card"><ul class="queue">${queue.map((a, i) => `<li data-open="${a.inv.id}"><span class="rank">${i + 1}</span>
        <div><div class="what">${esc(nextSteps(a, c)[0]?.t || 'Связаться с клиентом')}</div>
        <div class="meta">${esc(a.client.name)} · ${a.late ? `<span class="bad">просрочка ${days(a.late)}</span>` : `срок ${dateShort(a.inv.due)}`} ${causePill(a.cause)}${a.brokenPromise ? '<span class="pill nodot" style="background:var(--bad-soft);color:var(--bad)">обещание нарушено</span>' : ''}</div></div>
        <div class="money">${rub(a.bal)}<small>${a.fc ? 'оплата за 14 дн. ' + prob(a.fc.p14) : ''}</small></div></li>`).join('')}</ul></div>
    <div class="card pad"><h3>Почему не платят</h3>
      <div class="stack mt">${lateCauses.map(([k, v]) => `<i style="width:${(v.sum / p.lateSum) * 100}%;background:var(--c-${k})" title="${esc(C(k).ru)}"></i>`).join('')}</div>
      <div class="cause-rows mt">${lateCauses.map(([k, v]) => `<div class="cause-row" style="--c:var(--c-${k})"><span>${esc(C(k).ru)} <span class="mute">· ${v.n}</span></span><b>${rub(v.sum)}</b><div class="bar"><i style="width:${(v.sum / lateCauses[0][1].sum) * 100}%"></i></div></div>`).join('')}</div></div>
  </div>

  <h2 class="sec">Спросите о деньгах</h2>
  <form class="card pad ask" id="ask">
    <div class="row" style="flex-wrap:nowrap"><input id="ask-q" class="search" style="flex:1" placeholder="Сколько должен Уралстройинвест?" aria-label="Вопрос о долгах клиентов" value="${esc(S.ask || '')}"><button class="btn primary">Ответить</button></div>
    <div id="ask-out">${askAnswer(S.ask)}</div></form>

  <h2 class="sec">Сроки и обещания</h2>
  <div class="grid g3">
    <div class="card pad"><h3>Обещания оплаты</h3>
      ${pr.length ? `<ul class="plist">${pr.map(x => `<li data-open="${x.a.inv.id}"><div><div class="t1">${esc(x.a.client.name)}</div><div class="t2">${dateRu(x.date)}</div></div><div class="r"><div class="t1">${rub(x.a.bal || x.a.inv.amount)}</div>${{ broken: '<span class="pill nodot" style="background:var(--bad-soft);color:var(--bad)">нарушено</span>', today: '<span class="pill nodot" style="background:var(--warn-soft);color:var(--warn)">сегодня</span>', waiting: `<span class="t2">через ${days(diffDays(x.date, S.today))}</span>`, kept: '<span class="pill nodot" style="background:var(--ok-soft);color:var(--ok)">выполнено</span>' }[x.status]}</div></li>`).join('')}</ul>` : '<p class="note">Клиенты пока не называли дат.</p>'}</div>
    <div class="card pad"><h3>Возраст просрочки</h3>
      <div class="cause-rows mt">${ag.map((b, i) => `<div class="cause-row" style="--c:${['var(--warn)', '#e07a2e', 'var(--bad)', '#7a1f12'][i]}"><span>${b.label} <span class="mute">· ${b.n}</span></span><b>${rub(b.sum)}</b><div class="bar"><i style="width:${(b.sum / (Math.max(...ag.map(x => x.sum)) || 1)) * 100}%"></i></div></div>`).join('')}</div></div>
    <div class="card pad"><h3>Деньги на 8 недель</h3>${cashChart(cf)}</div>
  </div>`;
}

// Ответ на вопрос обычными словами — по реестру счетов, без модели и без сети.
function askAnswer(q) {
  const ex = ['Сколько должен Уралстройинвест?', 'Кто должен больше всех?', 'Сколько всего просрочено?'];
  if (!q?.trim()) return `<div class="row mt" style="gap:6px">${ex.map(e => `<button type="button" class="btn sm ghost" data-ask="${esc(e)}">${esc(e)}</button>`).join('')}</div>`;
  const res = answerQuestion(q, LIST);
  if (!res.length) return '<p class="note mt">Не нашёл, о ком вопрос. Спросите по названию компании, например «сколько должен Форма», или «кто должен больше всех».</p>';
  return res.map(r => `<div class="answer mt"><p><b>${esc(r.name)}</b>: к оплате <b>${rub(r.total)}</b> по ${r.rows.length} ${plural(r.rows.length, 'счёту', 'счетам', 'счетам')}${r.late ? `, из них просрочено <b class="bad">${rub(r.late)}</b>` : ', просрочки нет'}.</p>
    <ul class="plist">${r.rows.sort((x, y) => y.bal - x.bal).slice(0, 5).map(a => `<li data-open="${a.inv.id}"><div><div class="t1">№ ${esc(a.inv.id)} · ${rub(a.bal)}</div><div class="t2">${a.late ? `просрочка ${days(a.late)}` : `срок ${dateShort(a.inv.due)}`} · ${esc(a.next)}</div></div><div class="r">${causePill(a.cause)}</div></li>`).join('')}</ul></div>`).join('');
}

function cashChart(rows) {
  const W = 520, H = 210, pl = 8, pb = 26, max = Math.max(...rows.map(r => Math.max(r.inflow, r.outflow)), 1);
  const minC = Math.min(0, ...rows.map(r => r.closing)), maxC = Math.max(...rows.map(r => r.closing), 1);
  const bw = (W - pl * 2) / rows.length, y = v => (H - pb) - (v / max) * (H - pb - 14);
  const yc = v => (H - pb) - ((v - minC) / (maxC - minC || 1)) * (H - pb - 14);
  const line = rows.map((r, i) => `${pl + bw * i + bw / 2},${yc(r.closing)}`).join(' ');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Прогноз денежного потока">
    ${rows.map((r, i) => { const x = pl + bw * i; return `
      <rect x="${x + bw * .14}" y="${y(r.inflow)}" width="${bw * .34}" height="${H - pb - y(r.inflow)}" rx="3" fill="var(--accent)"><title>Поступления ${rub(r.inflow)}</title></rect>
      <rect x="${x + bw * .52}" y="${y(r.outflow)}" width="${bw * .34}" height="${H - pb - y(r.outflow)}" rx="3" fill="#c9d0db"><title>Платежи ${rub(r.outflow)}${r.items.map(o => ' · ' + o.what).join('')}</title></rect>
      <text x="${x + bw / 2}" y="${H - 8}" text-anchor="middle">${dateShort(r.from)}</text>`; }).join('')}
    ${minC < 0 ? `<line x1="0" x2="${W}" y1="${yc(0)}" y2="${yc(0)}" stroke="var(--bad)" stroke-dasharray="4 4" stroke-width="1"/>` : ''}
    <polyline points="${line}" fill="none" stroke="var(--ink)" stroke-width="2"/>
    ${rows.map((r, i) => `<circle cx="${pl + bw * i + bw / 2}" cy="${yc(r.closing)}" r="3.5" fill="${r.closing < 0 ? 'var(--bad)' : 'var(--ink)'}"><title>Остаток ${rub(r.closing)}</title></circle>`).join('')}
  </svg><div class="legend"><span><i style="background:var(--accent)"></i>Поступления</span><span><i style="background:#c9d0db"></i>Платежи</span><span><i style="background:var(--ink);height:2px"></i>Остаток на счёте</span></div>`;
}

// ---------- Счета ----------
function viewInvoices() {
  const f = S.filter, q = S.q.trim().toLowerCase();
  const rows = LIST.filter(a => (f === 'all' || (f === 'late' ? a.late > 0 : f === 'open' ? a.state === 'open' : a.state === 'paid')))
    .filter(a => !q || (a.client.name + ' ' + a.inv.id + ' ' + C(a.cause).ru).toLowerCase().includes(q));
  const cnt = k => LIST.filter(a => (k === 'late' ? a.late > 0 : k === 'open' ? a.state === 'open' : k === 'paid' ? a.state === 'paid' : true)).length;
  return `<div class="page-head"><div><h1>Счета</h1><p>Причина, прогноз и следующий шаг по каждому счёту.</p></div>
    <div class="row"><button class="btn" id="export">Выгрузить CSV</button></div></div>
  <div class="card"><div class="toolbar"><div class="seg" role="group">${[['late', 'Просрочены'], ['open', 'В срок'], ['paid', 'Оплачены'], ['all', 'Все']].map(([k, l]) => `<button data-f="${k}" class="${f === k ? 'on' : ''}">${l} ${cnt(k)}</button>`).join('')}</div>
    <input class="search" id="q" placeholder="Клиент, номер счёта или причина" value="${esc(S.q)}"></div>
  <div class="table-wrap"><table><thead><tr><th>Клиент / счёт</th><th class="r">Остаток</th><th>Срок</th><th>Причина</th><th class="hide-sm">Оплата за 14 дн.</th><th class="hide-sm">Следующий шаг</th></tr></thead>
  <tbody>${rows.map(a => `<tr class="click" data-open="${a.inv.id}"><td><div class="t1">${esc(a.client.name)}</div><div class="t2">№ ${esc(a.inv.id)} · ${esc(a.inv.owner || '')}</div></td>
    <td class="r"><div class="t1">${rub(a.bal)}</div>${a.inv.paid ? `<div class="t2">из ${rub(a.inv.amount)}</div>` : ''}</td>
    <td><div>${dateShort(a.inv.due)}</div><div class="t2 ${a.late ? 'bad' : ''}">${a.late ? '+' + days(a.late) : a.state === 'paid' ? 'закрыт' : 'через ' + days(Math.max(0, diffDays(a.inv.due, S.today)))}</div></td>
    <td>${causePill(a.cause)} ${srcTag(a.src)}</td>
    <td class="hide-sm">${a.fc ? `<div class="row" style="gap:8px;flex-wrap:nowrap"><div class="bar" style="width:70px"><i style="width:${a.fc.p14 * 100}%;background:${a.fc.p14 < .3 ? 'var(--bad)' : a.fc.p14 < .6 ? 'var(--warn)' : 'var(--ok)'}"></i></div><span class="num">${prob(a.fc.p14)}</span></div>` : '—'}</td>
    <td class="hide-sm" style="max-width:260px">${esc(a.next)}</td></tr>`).join('')}</tbody></table>
  ${rows.length ? '' : '<div class="empty">Нет счетов по этому фильтру</div>'}</div></div>`;
}

// ---------- Карточка счёта ----------
function openDrawer(id) {
  const a = byId(id); if (!a) return;
  if (S.open !== id) track('card_open', { inv: id, late: a.late > 0 });
  S.open = id;
  const c = ctx(), steps = nextSteps(a, c), d = $('#drawer');
  const probs = a.probs ? Object.entries(a.probs).filter(([k]) => CAUSE_KEYS.includes(k)).sort((x, y) => y[1] - x[1]) : [];
  const issues = a.llm?.body && !S.noAI && !S.edits?.[id] ? letterIssues(a.llm.body, a.cause) : [];
  const letter = S.edits?.[id] || (a.llm?.body && !S.noAI && !issues.length ? { subject: tidyLetter(a.llm.subject), body: tidyLetter(a.llm.body), src: 'llm' } : { ...letterTemplate(a, S.demo.supplier), src: 'template' });
  const bad = a.llm?.invalid_numbers?.length && !S.edits?.[id] ? a.llm.invalid_numbers : [];
  const showClaim = a.bal > 0 && (a.late >= 30 || (a.cause === 'liquidity' && a.late > 14));
  const j = a.jev, rec = a.bal > 0 && a.late > 0 ? recoveryPath(a, S.today) : null, term = legalTerm(a.client);
  const sampleDoc = S.demo.doc_samples?.find(x => x.invoice === a.inv.id);
  d.innerHTML = `
  <div class="drawer-head"><div style="flex:1"><div class="eyebrow">Счёт № ${esc(a.inv.id)} · ${esc(a.inv.owner || '')}</div><h2>${esc(a.client.name)}</h2>
    <div class="note">${esc(a.client.sector || '')}${a.client.contact ? ' · ' + esc(a.client.contact) : ''}</div></div><button class="icon-btn" id="close-d" aria-label="Закрыть">×</button></div>
  <div class="drawer-body">
    <div class="facts"><div><span>Остаток</span><b>${rub(a.bal)}</b></div><div><span>Срок оплаты</span><b>${dateRu(a.inv.due)}</b></div><div><span>${a.late ? 'Просрочка' : 'Статус'}</span><b class="${a.late ? 'bad' : ''}">${a.late ? days(a.late) : a.state === 'paid' ? 'оплачен' : 'в срок'}</b></div>
      <div><span>Акт / УПД</span><b>${{ signed: 'подписан', sent: 'отправлен', not_sent: 'не отправлен', rejected: 'отклонён' }[a.inv.docs?.act] || '—'}</b></div><div><span>ЭДО</span><b>${a.inv.docs?.edo ? 'да' : 'нет'}</b></div>
      <div><span>История клиента</span><b>${a.client.history ? pct(a.client.history.late_share) + ' с просрочкой' : '—'}</b></div></div>

    ${a.bal > 0 ? `<div class="card pad"><div class="row between"><h3>Почему не платят</h3>${srcTag(a.src)}</div>
      ${a.cause !== 'none' ? `<p style="margin:6px 0 12px"><b style="font-size:18px">${esc(C(a.cause).ru)}</b><br><span class="note">${esc(C(a.cause).why || '')}</span></p>` : '<p class="note">Срок оплаты не наступил, переписки по оплате нет.</p>'}
      ${probs.length ? `<div class="probs">${probs.slice(0, 4).map(([k, v], i) => `<div class="prob ${i ? '' : 'top'}" style="--c:var(--c-${k})"><span>${esc(C(k).short)}</span><div class="bar"><i style="width:${v * 100}%"></i></div><span class="num">${prob(v)}</span></div>`).join('')}</div>
      <p class="note" style="margin:8px 0 0">Насколько уверенно причина следует из переписки</p>` : ''}
      ${a.evidence ? `<div class="quote mt"><small>Основание · письмо клиента ${dateRu(a.evidence.date)}</small>${esc(a.evidence.text)}</div>` : ''}
      ${j ? `<div class="row mt" style="gap:6px">${[['fixable', 'Можно устранить самим'], ['promise', 'Есть обещание оплаты'], ['docs_ok', 'Документы приняты'], ['insolvency', 'Признаки неплатёжеспособности']].map(([k, l]) => `<span class="pill nodot" style="background:${j[k].noul > .5 ? (k === 'insolvency' ? 'var(--bad-soft)' : 'var(--ok-soft)') : 'var(--line2)'};color:${j[k].noul > .5 ? (k === 'insolvency' ? 'var(--bad)' : 'var(--ok)') : 'var(--mute)'}">${l}: ${prob(j[k].noul)}</span>`).join('')}</div>` : ''}
      ${a.brokenPromise ? `<div class="alert bad mt">Клиент обещал оплатить ${dateRu(a.promised)}, платёж не поступил.</div>` : a.promised ? `<div class="alert info mt">Клиент назвал дату: ${dateRu(a.promised)}.</div>` : ''}
      ${a.reg.flags?.length ? `<div class="alert warn mt"><b>Сигналы по открытым реестрам</b><ul class="flags">${a.reg.flags.map(f => `<li>${esc(f)}</li>`).join('')}</ul><span class="note">В демо — заданные значения. В пилоте — ФНС, Федресурс, картотека арбитражных дел.</span></div>` : ''}
    </div>

    <div class="card pad"><h3>Что сделать</h3><p class="sub">${esc(C(a.cause).action || 'Подготовиться к сроку оплаты')}</p>
      <ol class="steps">${steps.map(s => `<li><div>${esc(s.t)}<small>${esc(s.d)}</small></div></li>`).join('')}</ol>
      <div class="row mt"><button class="btn primary" id="add-task">В мои действия</button>${showClaim ? '<button class="btn" id="claim">Подготовить претензию</button>' : ''}<button class="btn" id="pay-btn">Учесть поступление</button>${sampleDoc ? `<a class="btn" href="#/docs/${esc(sampleDoc.key)}">Проверить документ</a>` : ''}</div>
      ${term ? `<div class="alert info mt">${esc(term)}</div>` : ''}</div>

    ${a.fc ? `<div class="card pad"><h3>Прогноз оплаты</h3><p class="sub">По истории клиента и причине задержки</p>
      <div class="grid g3"><div><span class="note">За 7 дней</span><div class="big">${prob(a.fc.p7)}</div></div><div><span class="note">За 14 дней</span><div class="big">${prob(a.fc.p14)}</div></div><div><span class="note">За 30 дней</span><div class="big">${prob(a.fc.p30)}</div></div></div>
      <p class="note">Если клиент заплатит, медианный срок — около ${days(Math.max(1, Math.round(a.fc.median)))} от сегодня. Деньги под риском: <b>${rub(a.atRisk)}</b>.</p></div>` : ''}

    <div class="card pad"><div class="row between"><h3>Письмо клиенту</h3>${letter.src === 'edit' ? '<span class="tag">изменено вами</span>' : `<span class="tag">${letter.src === 'llm' ? 'черновик' : 'шаблон'}</span>`}</div>
      <p class="sub">Черновик. Сервис ничего не отправляет сам — проверьте и отправьте из своей почты.</p>
      ${issues.length ? `<div class="alert warn">Показан шаблон письма — его можно поправить.</div>` : ''}
      ${bad.length && !issues.length ? `<div class="alert warn">Проверьте: в письме есть ${bad.length === 1 ? "число" : "числа"} <b>${bad.map(esc).join(", ")}</b>, ${bad.length === 1 ? "которого" : "которых"} нет в счёте и переписке. Поправьте перед отправкой.</div>` : letter.src === 'llm' ? '<div class="alert ok">Проверка фактов: все суммы, даты и номера в письме есть в счёте или переписке.</div>' : ''}
      <input type="text" id="l-subj" value="${esc(letter.subject)}" class="mt" aria-label="Тема письма">
      <textarea id="l-body" class="mt" rows="8" aria-label="Текст письма">${esc(letter.body)}</textarea>
      <div class="row mt"><button class="btn primary" id="copy">Скопировать</button><button class="btn" id="save-l">Сохранить правки</button>${letter.src !== 'template' ? '<button class="btn ghost" id="tpl">Показать шаблон</button>' : ''}</div></div>` : `<div class="alert ok">Счёт оплачен полностью.</div>`}

    ${a.bal > 0 && !['paid', 'dispute', 'liquidity'].includes(a.cause) ? `<div class="card pad payqr"><div>${qrSvg(payload(S.demo.supplier, a.inv, a.bal))}</div><div><h3>Оплата по QR</h3>
      <p class="sub">Приложите к письму: клиент сканирует код в приложении банка, реквизиты и сумма ${rub(a.bal)} заполнятся сами. Номер счёта попадёт в назначение платежа, поэтому сверка пройдёт автоматически.</p>
      <p class="note">Формат ГОСТ Р 56042-2014, менять оборудование не нужно. В демо реквизиты вымышленные, оплатить нельзя.</p></div></div>` : ''}

    ${rec ? `<div class="card pad"><h3>Если не заплатят</h3><p class="sub">Справочник на ${dateRu(LAW.asOf)}, проверьте перед применением.</p>
      <div class="facts"><div><span>Проценты по ст. 395 ГК</span><b>${rub(rec.interest)}</b></div><div><span>Процедура</span><b>${esc(rec.proc)}</b></div><div><span>Госпошлина</span><b>${rub(rec.fee)}</b></div></div>
      <p class="note mt">Сначала претензия: в суд можно через ${LAW.claimDays} дней, не раньше ${dateRu(rec.canSue)} (ч. 5 ст. 4 АПК). Пошлина — ${pct(rec.feeShare)} долга. ${esc(rec.advice)}</p></div>` : ''}

    <div class="card pad"><h3>Контрагент</h3><p class="sub">${/^\d+$/.test(a.inv.inn) ? 'ИНН ' + esc(a.inv.inn) : 'ИНН не указан'} ${!/^\d+$/.test(a.inv.inn) ? '' : innValid(a.inv.inn) ? '· контрольная сумма верна' : '· <b class="bad">контрольная сумма не сходится</b>'}</p>
      ${S.live ? `<form class="row" id="egrul-f" style="flex-wrap:nowrap"><input type="text" id="egrul-inn" inputmode="numeric" maxlength="12" placeholder="ИНН для проверки в ЕГРЮЛ" aria-label="ИНН для проверки" value="${S.imported && /^\d+$/.test(a.inv.inn) ? esc(a.inv.inn) : ''}"><button class="btn">Проверить</button></form><div id="egrul-out" class="mt"></div>` : '<p class="note">На локальном сервере статус и актуальный КПП приходят из ЕГРЮЛ. В демо компании вымышлены.</p>'}
      <div class="row mt" style="gap:12px;font-size:13.5px"><a href="https://egrul.nalog.ru/" target="_blank" rel="noopener">ЕГРЮЛ ↗</a><a href="https://bo.nalog.ru/" target="_blank" rel="noopener">Отчётность ↗</a><a href="https://fedresurs.ru/" target="_blank" rel="noopener">Федресурс ↗</a><a href="https://kad.arbitr.ru/" target="_blank" rel="noopener">Арбитраж ↗</a></div></div>

    <div class="card pad"><div class="row between"><h3>Переписка</h3><button class="btn sm" id="add-msg">+ Добавить письмо клиента</button></div>
      <div class="thread mt">${(a.inv.messages || []).map((m, i) => `<div class="msg ${m.from === 'us' ? 'us' : ''} ${a.evidence?.index === i ? 'hl' : ''}"><small>${m.from === 'us' ? 'Мы' : esc(a.client.name)} · ${dateRu(m.date)}</small>${esc(m.text)}</div>`).join('') || '<p class="note">Переписки нет.</p>'}</div>
      <div id="msg-form" hidden class="mt"><textarea id="msg-text" rows="4" placeholder="Вставьте текст письма или сообщения клиента"></textarea><div class="row mt"><button class="btn primary" id="msg-save">Добавить и разобрать</button></div></div></div>
  </div>`;
  d.hidden = false; $('#scrim').hidden = false;
  $('#close-d').onclick = closeDrawer;
  const on = (s, fn) => { const el = $(s, d); if (el) el.onclick = fn; };
  on('#add-task', () => { const s = steps[0]; if (!s) return; if (S.tasks.some(t => t.inv === a.inv.id && t.t === s.t && !t.done)) return toast('Этот шаг уже в «Моих действиях»'); S.tasks.push({ id: Date.now(), inv: a.inv.id, t: s.t, client: a.client.name, amount: a.bal, due: addDays(S.today, 2), done: false }); track('step_taken', { inv: id, cause: a.cause }); save(); render(); toast('Добавлено в «Мои действия»'); });
  on('#copy', () => { track('letter_copied', { inv: id, src: letter.src }); navigator.clipboard?.writeText($('#l-subj').value + '\n\n' + $('#l-body').value); toast('Письмо скопировано'); });
  on('#save-l', () => { S.edits[id] = { subject: $('#l-subj').value, body: $('#l-body').value, src: 'edit' }; save(); openDrawer(id); toast('Правки сохранены'); });
  on('#tpl', () => { S.edits[id] = { ...letterTemplate(a, S.demo.supplier), src: 'edit' }; save(); openDrawer(id); });
  on('#claim', () => { track('claim_opened', { inv: id }); claimDialog(a); });
  const ef = $('#egrul-f', d); if (ef) ef.onsubmit = async e => {
    e.preventDefault();
    const out = $('#egrul-out', d), inn = $('#egrul-inn', d).value.trim(); out.textContent = 'Запрашиваем…';
    try {
      const r = await fetch(`api/counterparty/${encodeURIComponent(inn)}`); const x = await r.json();
      if (!r.ok || !x.found) { out.innerHTML = '<div class="alert warn">В ЕГРЮЛ не найдено. Проверьте ИНН: 10 или 12 цифр.</div>'; return; }
      out.innerHTML = `<div class="alert ${x.liquidated ? 'bad' : 'ok'}"><b>${esc(x.name)}</b><br>КПП ${esc(x.kpp || '—')} · ОГРН ${esc(x.ogrn || '—')} · с ${esc(x.registered || '—')}${x.liquidated ? `<br>Прекратила деятельность ${esc(x.liquidated)}` : ''}</div>`;
    } catch { out.innerHTML = '<div class="alert warn">Сервис ФНС не ответил.</div>'; }
  };
  on('#pay-btn', () => paymentDialog(a));
  on('#add-msg', () => { $('#msg-form', d).hidden = false; $('#msg-text', d).focus(); });
  on('#msg-save', () => addMessage(a, $('#msg-text', d).value));
}
function closeDrawer() {
  S.open = null; $('#drawer').hidden = true; $('#scrim').hidden = true;
  const back = S.back; S.back = null;
  if (back) location.hash = back; else if (location.hash.split('/')[2]) history.replaceState(null, '', '#/' + location.hash.split('/')[1]);
}

async function addMessage(a, text) {
  text = text.trim(); if (!text) return;
  const inv = S.invoices.find(i => i.id === a.inv.id && i.inn === a.inv.inn);
  inv.messages = [...(inv.messages || []), { date: S.today, from: 'client', text: text.slice(0, 5000) }];
  (S.stale ||= []).push(inv.id);
  delete S.edits[inv.id];
  if (S.live) {
    try {
      toast('Разбираем письмо…');
      const r = await fetch('api/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ invoice: inv, client: S.clients[inv.inn], today: S.today }) });
      if (r.ok) S.liveAnalysis[inv.id] = await r.json();
    } catch { /* сервер недоступен: разбор правилами */ }
  }
  save(); render(); openDrawer(inv.id);
  toast('Причина: ' + C(S.liveAnalysis[inv.id] ? byId(inv.id)?.cause : classifyText(text).cause).ru);
}

// ---------- Диалоги ----------
function dialog(html, onReady) {
  const dlg = $('#dlg'); $('#dlg-body').innerHTML = html; dlg.showModal();
  $$('[data-close]', dlg).forEach(b => b.onclick = () => dlg.close());
  onReady?.(dlg);
}
function claimDialog(a) {
  const text = claimText(a, S.demo.supplier, S.today), pr = interest395(a.bal, addDays(a.inv.due, 1), S.today);
  dialog(`<div class="dlg-head"><h3>Претензия по счёту № ${esc(a.inv.id)}</h3><button class="icon-btn" data-close>×</button></div>
    <div class="dlg-body"><div class="alert info">Долг ${rub(a.bal)} + проценты по ст. 395 ГК РФ ${rub(pr.total)}. Проверьте условия договора о неустойке.</div><pre class="doc">${esc(text)}</pre></div>
    <div class="dlg-foot"><button class="btn" data-close>Закрыть</button><button class="btn primary" id="dl-claim">Скачать .txt</button></div>`,
    () => { $('#dl-claim').onclick = () => download(`pretenziya_${a.inv.id}.txt`, text); });
}
function paymentDialog(a) {
  dialog(`<form id="pf"><div class="dlg-head"><h3>Поступление по счёту № ${esc(a.inv.id)}</h3><button type="button" class="icon-btn" data-close>×</button></div>
    <div class="dlg-body"><p class="note">Остаток ${rub(a.bal)}. Ручная отметка. Чтобы сверить автоматически, загрузите выписку в разделе «Сверка выписки».</p>
    <input type="number" id="pa" min="1" max="${a.bal}" step="0.01" required placeholder="Сумма, ₽" aria-label="Сумма поступления"></div>
    <div class="dlg-foot"><button type="button" class="btn" data-close>Отмена</button><button class="btn primary">Сохранить</button></div></form>`,
    dlg => { $('#pf').onsubmit = e => { e.preventDefault(); const v = Number($('#pa').value); if (!(v > 0 && v <= a.bal)) return toast('Сумма должна быть не больше остатка'); const inv = S.invoices.find(i => i.id === a.inv.id && i.inn === a.inv.inn); inv.paid = Math.round(((inv.paid || 0) + v) * 100) / 100; save(); dlg.close(); render(); openDrawer(inv.id); toast('Поступление учтено'); }; });
}
function importDialog() {
  dialog(`<div class="dlg-head"><h3>Загрузить свои данные</h3><button class="icon-btn" data-close>×</button></div>
    <div class="dlg-body"><p>Реестр счетов в CSV (выгрузка из 1С, Excel, CRM). Обязательные колонки: <code>invoice_id, client, amount, due_date</code>; дополнительно <code>inn, paid, owner, act, context</code> — в <code>context</code> можно вставить текст переписки. Данные остаются в вашем браузере.</p>
    <div class="row"><label class="btn">Выбрать CSV<input type="file" id="csvf" accept=".csv,text/csv" hidden></label><button class="btn ghost" id="sample">Скачать образец</button></div>
    <textarea id="csvt" rows="6" placeholder="Или вставьте таблицу текстом"></textarea><div id="ierr" class="alert bad" hidden></div></div>
    <div class="dlg-foot"><button class="btn" data-close>Отмена</button><button class="btn primary" id="do-import">Загрузить</button></div>`, dlg => {
    $('#sample').onclick = () => download('oplata_obrazec.csv', '﻿' + SAMPLE, 'text/csv;charset=utf-8');
    $('#csvf').onchange = async e => { const f = e.target.files[0]; if (!f) return; if (f.size > 2e6) return showErr('Файл больше 2 МБ'); const buf = await f.arrayBuffer(); let t = new TextDecoder('utf-8').decode(buf); if (t.includes('�')) t = new TextDecoder('windows-1251').decode(buf); $('#csvt').value = t; };
    const showErr = m => { $('#ierr').hidden = false; $('#ierr').textContent = m; };
    $('#do-import').onclick = () => {
      try {
        const rows = parseCsv($('#csvt').value, S.today);
        for (const i of rows) if (!S.clients[i.inn]) S.clients[i.inn] = { name: i.client, inn: i.inn, history: { late_share: 0.3, avg_delay: 7, invoices: 0 }, contact: '' };
        S.invoices = rows; S.statement = []; S.tasks = []; S.applied = []; S.imported = true; S.edits = {}; S.liveAnalysis = {};
        save(); dlg.close(); location.hash = '#/invoices'; render(); toast(`Загружено счетов: ${rows.length}`);
      } catch (e) { showErr(e.message); }
    };
  });
}

// ---------- Разбор письма ----------
// Самый короткий путь к пользе: без реестра и подключений, для микробизнеса и самозанятых.
const MSG_SAMPLES = [
  'Добрый день! Мы перешли на новую учётную систему, ваш счёт не перенёсся. Пришлите его ещё раз вместе с актом, оплатим в течение двух дней.',
  'Деньги есть, дело не в этом: платежи свыше 100 тысяч согласует собственник, а он вернётся только в среду.',
  'Банк заморозил нам кредитную линию, сейчас платим только налоги и зарплату. Вернёмся к вам в декабре.',
];
function viewMessage() {
  return `<div class="page-head"><div><h1>Разбор письма</h1><p>Вставьте ответ клиента: сервис назовёт причину и следующий шаг. Подключать ничего не нужно.</p></div></div>
  <div class="grid g-main"><form class="card pad" id="mf">
    <textarea id="mf-text" rows="6" placeholder="Текст письма или сообщения клиента" aria-label="Текст письма"></textarea>
    <div class="row mt" style="gap:6px">${MSG_SAMPLES.map((_, i) => `<button type="button" class="btn sm ghost" data-ms="${i}">Пример ${i + 1}</button>`).join('')}</div>
    <div class="grid g3 mt"><input type="text" id="mf-client" placeholder="Клиент (необязательно)" aria-label="Клиент"><input type="number" id="mf-amount" min="1" placeholder="Сумма, ₽" aria-label="Сумма"><input type="date" id="mf-due" value="${S.today}" aria-label="Срок оплаты"></div>
    <div class="row mt"><button class="btn primary lg">Разобрать</button></div></form>
    <div id="mf-out"><div class="card pad emptycard">${ico('check')}<div><h3>Здесь появится причина</h3><p class="note">Вставьте письмо клиента — покажем причину задержки и что ответить.</p></div></div></div></div>`;
}
function bindMessage() {
  $$('[data-ms]').forEach(b => b.onclick = () => { $('#mf-text').value = MSG_SAMPLES[b.dataset.ms]; });
  $('#mf').onsubmit = async e => {
    e.preventDefault();
    const text = $('#mf-text').value.trim(); if (!text) return;
    let { cause, evidence } = classifyText(text), src = 'rules', p = null;
    if (S.live && !S.noAI) {
      $('#mf-out').innerHTML = '<div class="card pad"><p class="note">Разбираем письмо…</p></div>';
      try { const r = await fetch('api/message', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) }); if (r.ok) { const x = await r.json(); cause = x.cause; p = x.p; src = 'jev'; evidence = text; } } catch { /* разбор правилами */ }
    }
    track('message_parsed', { cause, src });
    const amountV = Number($('#mf-amount').value) || 0, due = $('#mf-due').value || S.today, name = $('#mf-client').value.trim() || 'Клиент';
    const inv = { id: 'П' + (S.invoices.filter(i => String(i.id).startsWith('П')).length + 1), inn: 'msg:' + name.toLowerCase(), client: name, amount: amountV, paid: 0, issued: due, due, owner: '', docs: {}, messages: [{ date: S.today, from: 'client', text }], label: 'none' };
    const a = { inv, client: { name, contact: '' }, bal: amountV, cause, late: Math.max(0, diffDays(S.today, due)), reg: { flags: [] }, llm: null, promised: promiseDate(text, S.today), brokenPromise: false };
    const steps = nextSteps(a, ctx());
    $('#mf-out').innerHTML = `<div class="card pad"><div class="row between"><h3>Почему не платят</h3>${srcTag(src)}</div>
      <p style="margin:6px 0 4px"><b style="font-size:18px">${esc(C(cause).ru)}</b></p><p class="note">${esc(C(cause).why || '')}</p>
      ${p ? `<div class="probs mt">${Object.entries(p).sort((x, y) => y[1] - x[1]).slice(0, 3).map(([k, v], i) => `<div class="prob ${i ? '' : 'top'}" style="--c:var(--c-${k === 'none' ? 'silence' : k})"><span>${esc(k === 'none' ? 'Причина не названа' : C(k).short)}</span><div class="bar"><i style="width:${v * 100}%"></i></div><span class="num">${prob(v)}</span></div>`).join('')}</div>` : ''}
      ${evidence ? `<div class="quote mt"><small>Основание</small>${esc(evidence)}</div>` : '<p class="note mt">Причина в письме не названа: уточните её у клиента.</p>'}
      ${a.promised ? `<div class="alert info mt">Клиент назвал дату: ${dateRu(a.promised)}.</div>` : ''}
      <ol class="steps mt">${steps.map(x => `<li><div>${esc(x.t)}<small>${esc(x.d)}</small></div></li>`).join('')}</ol>
      ${amountV ? '<div class="row mt"><button class="btn primary" id="mf-add">Добавить в счета</button></div>' : '<p class="note mt">Укажите сумму, чтобы добавить счёт в реестр и получить письмо с QR.</p>'}</div>`;
    const add = $('#mf-add');
    if (add) add.onclick = () => { S.clients[inv.inn] = { name, inn: inv.inn, contact: '', history: { late_share: 0.3, avg_delay: 7, invoices: 0 } }; S.invoices.push(inv); save(); location.hash = `#/invoices/${inv.id}`; };
  };
}

// ---------- Проверка документа ----------
function viewDocs(arg) {
  const smp = S.demo.doc_samples || [], cur = smp.find(x => x.key === arg);
  S.docInitial = cur || null;
  return `<div class="page-head"><div><h1>Проверка документа</h1><p>Находим ошибку до отправки клиенту, а не после отказа в оплате. Реквизиты проверяются по контрольным суммам, суммы и стороны — со счётом.</p></div>
    <div class="row"><label class="btn">Загрузить файл (.txt, УПД .xml)<input type="file" id="df" accept=".txt,.xml" hidden></label></div></div>
  <div class="grid g-main"><div class="card pad">
    <div class="row" style="gap:6px">${smp.map(x => `<button class="btn sm ${cur?.key === x.key ? 'primary' : 'ghost'}" data-ds="${esc(x.key)}">${esc(x.title)}</button>`).join('')}</div>
    <textarea id="dt" class="mt" rows="11" placeholder="Вставьте текст счёта, акта или УПД" aria-label="Текст документа">${esc(cur?.text || '')}</textarea>
    <div class="row mt"><button class="btn primary lg" id="dgo">Проверить</button></div></div>
    <div id="dout"><div class="card pad emptycard">${ico('check')}<div><h3>Результат появится здесь</h3><p class="note">Счёт, акт, УПД. Новый тип документа добавляется одной записью в справочнике.</p></div></div></div></div>`;
}
function bindDocs() {
  const go = () => {
    const text = $('#dt').value; if (!text.trim()) return;
    const num = /№\s*([\w/-]+)/.exec(text)?.[1] || /НомерДок="([^"]+)"/.exec(text)?.[1];
    const invoice = S.invoices.find(i => i.id === num), client = invoice ? S.clients[invoice.inn] : null;
    const r = checkDoc(text, { invoice, client, supplier: S.demo.supplier });
    track('doc_checked', { ok: r.ok });
    const f = r.fields, party = x => (x ? `ИНН ${esc(x.inn)}${x.kpp ? ', КПП ' + esc(x.kpp) : ''}` : '—');
    const tone = !r.issues.length ? 'ok' : r.ok ? 'warn' : 'bad';
    $('#dout').innerHTML = `<div class="card pad"><div class="row between"><h3>${esc(r.type || 'Документ')}${f.number ? ' № ' + esc(f.number) : ''}</h3><span class="pill nodot" style="background:var(--${tone}-soft);color:var(--${tone})">${r.issues.length ? `замечаний: ${r.issues.length}` : 'можно отправлять'}</span></div>
      ${r.issues.map(i => `<div class="alert ${i.sev === 'bad' ? 'bad' : 'warn'} mt"><b>${esc(i.t)}</b><br>${esc(i.why)}. <b>Что сделать:</b> ${esc(i.fix)}.</div>`).join('') || '<div class="alert ok mt">Реквизиты, суммы и стороны сходятся. Документ не задержит оплату.</div>'}
      <div class="facts mt"><div><span>Продавец</span><b style="font-size:13px">${party(f.seller)}</b></div><div><span>Покупатель</span><b style="font-size:13px">${party(f.buyer)}</b></div><div><span>Сумма</span><b>${f.total != null ? rub(f.total) : '—'}</b></div></div>
      ${invoice ? `<p class="note mt">Сверено со <a href="#/invoices/${esc(invoice.id)}">счётом № ${esc(invoice.id)}</a>.</p>` : '<p class="note mt">Счёт с таким номером не найден в реестре: сумма и стороны не сверялись.</p>'}</div>`;
  };
  $$('[data-ds]').forEach(b => b.onclick = () => { location.hash = `#/docs/${b.dataset.ds}`; });
  $('#dgo').onclick = go;
  $('#df').onchange = async e => { const f = e.target.files[0]; if (!f || f.size > 2e6) return; const buf = await f.arrayBuffer(); let t = new TextDecoder('utf-8').decode(buf); if (t.includes('\uFFFD') || /windows-1251/i.test(t.slice(0, 100))) t = new TextDecoder('windows-1251').decode(buf); $('#dt').value = t; go(); };
  if (S.docInitial) go();
}

// ---------- Сверка ----------
function viewReconcile() {
  const res = reconcile(S.statement, S.invoices);
  const st = { auto: ['Найден счёт', 'ok'], check: ['Проверьте', 'warn'], unmatched: ['Не найден', 'mute'], posted: ['Уже учтён', 'mute'] };
  return `<div class="page-head"><div><h1>Сверка</h1>
    <p>Находим счета, которые клиент уже оплатил, а у вас они висят как долг.</p></div>
    <div class="row"><label class="btn primary">Загрузить выписку 1С<input type="file" id="f1c" accept=".txt" hidden></label><button class="btn ghost" id="dl1c">Пример файла 1С</button></div></div>
  <div class="card"><div class="table-wrap"><table><thead><tr><th>Платёж</th><th class="r">Сумма</th><th>Назначение</th><th>Результат</th><th></th></tr></thead><tbody>
  ${res.map(r => { const applied = S.applied.includes(r.p.num); return `<tr><td><div class="t1">${esc(r.p.payer)}</div><div class="t2">п/п ${esc(r.p.num)} · ${dateShort(r.p.date)} · ИНН ${esc(r.p.payer_inn)}</div></td>
    <td class="r t1">${rub(r.p.amount)}</td><td style="min-width:220px;max-width:320px;font-size:13.5px;color:var(--ink2)">${esc(r.p.purpose)}</td>
    <td><span class="pill ${st[r.status][1]}" style="background:var(--${st[r.status][1] === 'mute' ? 'line2' : st[r.status][1] + '-soft'})">${applied ? 'Учтено' : st[r.status][0]}</span>${r.match.length ? ` → ${r.match.map(m => `<a href="#/invoices/${m.id}">№ ${esc(m.id)}</a>`).join(', ')}` : ''}<div class="t2">${esc(r.why.join(' · '))}${r.status !== 'posted' && r.match.length ? ` · уверенность ${pct(r.conf)}` : ''}</div></td>
    <td class="r">${r.match.length && r.status !== 'posted' && !applied ? `<button class="btn sm ${r.status === 'auto' ? 'primary' : ''}" data-apply="${esc(r.p.num)}">Учесть</button>` : ''}</td></tr>`; }).join('') || '<tr><td colspan="5" class="empty">Выписка не загружена</td></tr>'}
  </tbody></table></div></div>
  <p class="note mt">Выписку в формате 1С выгружает любой банк. Внутри банка — напрямую, без файлов.</p>`;
}

// ---------- Деньги сейчас ----------
function factoringDialog() {
  const c = ctx(), cf = cashflow(LIST, c), minW = cf.reduce((m, w) => w.closing < m.closing ? w : m, cf[0]), need = Math.max(0, -minW.closing);
  const ok = factoring(LIST, c).filter(x => x.ok).sort((a, b) => a.cost / a.amount - b.cost / b.amount);
  let acc = 0; const rows = []; for (const x of ok) { if (acc >= need) break; rows.push(x); acc += x.amount; }
  dialog(`<div class="dlg-head"><h3>Заявка на факторинг</h3><button class="icon-btn" data-close>×</button></div>
    <div class="dlg-body"><p>Реестр уступки: ${rows.length} ${plural(rows.length, 'счёт', 'счёта', 'счетов')}, аванс <b>${rub(acc)}</b>, разрыв закрыт. Все акты подписаны, спора нет.</p>
    <div class="table-wrap"><table><thead><tr><th>Дебитор</th><th>Счёт</th><th class="r">Требование</th><th class="r">Аванс</th></tr></thead><tbody>${rows.map(x => `<tr><td>${esc(x.a.client.name)}</td><td>№ ${esc(x.a.inv.id)}</td><td class="r">${rub(x.a.bal)}</td><td class="r t1">${rub(x.amount)}</td></tr>`).join('')}</tbody></table></div>
    <label class="row" style="flex-wrap:nowrap;align-items:flex-start;gap:10px"><input type="checkbox" id="fx-consent" style="width:auto;margin-top:4px"><span>Согласен передать данные этих счетов факторинговой компании. Без согласия клиента данные не передаются.</span></label>
    <p class="note">В демо заявка не отправляется: реестр можно скачать. В пилоте он уходит в факторинговую компанию банка по подписанным УПД.</p></div>
    <div class="dlg-foot"><button class="btn" data-close>Отмена</button><button class="btn primary" id="fx-dl" disabled>Скачать реестр</button></div>`, dlg => {
    $('#fx-consent').onchange = e => { $('#fx-dl').disabled = !e.target.checked; };
    $('#fx-dl').onclick = () => { track('factoring_request', { amount: acc }); download('reestr_ustupki.csv', assignmentCsv(rows, S.demo.supplier), 'text/csv;charset=utf-8'); dlg.close(); toast('Реестр уступки сформирован'); };
  });
}

function viewMoney() {
  const c = ctx(), cf = cashflow(LIST, c), gap = cf.find(w => w.closing < 0), minW = cf.reduce((m, w) => w.closing < m.closing ? w : m, cf[0]);
  const fx = factoring(LIST, c).sort((a, b) => b.ok - a.ok || a.cost / a.amount - b.cost / b.amount);
  const okList = fx.filter(x => x.ok), need = gap ? -minW.closing : 0;
  let acc = 0; const pick = [];
  for (const x of okList) { if (acc >= need) break; pick.push(x.a.inv.id); acc += x.amount; }
  const pickCost = okList.filter(x => pick.includes(x.a.inv.id)).reduce((s, x) => s + x.cost, 0);
  return `<div class="page-head"><div><h1>Деньги сейчас</h1>
    <p>Остаток на 8 недель вперёд и как закрыть разрыв.</p></div></div>
  <div class="grid g-main"><div class="card pad"><h3>Остаток по неделям</h3><p class="sub" title="Поступления — ожидаемое значение по прогнозу оплаты каждого счёта; с ${NEW_SALES.startWeek + 1}-й недели добавлены новые счета по плану выручки, ${pct(NEW_SALES.share)} из них оплачиваются в срок">Сегодня на счёте ${rub(S.demo.supplier.cash_on_hand)}</p>${cashChart(cf)}
    <div class="table-wrap mt"><table><thead><tr><th>Неделя</th><th class="r">Поступления</th><th class="r">Платежи</th><th class="r">Остаток</th></tr></thead><tbody>${cf.map(w => `<tr><td>${dateShort(w.from)}–${dateShort(w.to)}<div class="t2">${esc(w.items.map(o => o.what).join(', '))}</div></td><td class="r">${rub(w.inflow)}${w.sales ? `<div class="t2">в т.ч. новые счета ${rub(w.sales)}</div>` : ''}</td><td class="r">${rub(w.outflow)}</td><td class="r t1 ${w.closing < 0 ? 'bad' : ''}">${rub(w.closing)}</td></tr>`).join('')}</tbody></table></div></div>
  <div class="grid" style="align-content:start">
    ${gap ? `<div class="card pad gapcard"><div class="eyebrow">Разрыв ${dateRange(gap.from, gap.to)}</div><div class="big">${rub(minW.closing)}</div><p class="note">Не хватит на ${esc(minW.items.map(o => o.what).join(', ').toLowerCase() || 'платежи')}. А клиенты должны вам ${mln(portfolio(LIST, c).lateSum)}.</p>
      <div class="solve"><span>Факторинг ${pick.length} ${pick.length === 1 ? 'счёта' : 'счетов'}</span><b>+${rub(acc)}</b><small>сегодня · стоимость ${rub(pickCost)}</small></div>
      <button class="btn primary lg mt" id="fx-req" style="width:100%">Отправить заявку</button><p class="note" style="text-align:center">В демо заявка не отправляется</p></div>`
      : '<div class="card pad"><h3>Разрыва не видно</h3><p class="note">На 8 недель остаток положительный при текущем прогнозе.</p></div>'}
    <div class="card pad"><h3>Что не возьмёт фактор</h3><p class="sub">Нужен подписанный акт, без спора и признаков неплатёжеспособности</p>
      <ul class="flags">${fx.filter(x => !x.ok).slice(0, 6).map(x => `<li>№ ${esc(x.a.inv.id)} ${esc(x.a.client.name)} — ${esc(x.reasons.join(', '))}</li>`).join('')}</ul></div>
  </div></div>
  <h2 class="sec">Счета для факторинга</h2><div class="card"><div class="pad" style="padding:20px 24px 0"><p class="sub">Аванс 90%, ставка 19% годовых, комиссия 0,5% — условно, реальные условия у фактора</p></div>
  <div class="table-wrap"><table><thead><tr><th>Счёт</th><th class="r">Остаток</th><th class="r">Можно получить</th><th class="r">Ожидаем оплату через</th><th class="r">Стоимость</th></tr></thead><tbody>
  ${okList.map(x => `<tr class="click" data-open="${x.a.inv.id}"><td><div class="t1">${esc(x.a.client.name)}</div><div class="t2">№ ${esc(x.a.inv.id)} ${pick.includes(x.a.inv.id) ? '· <b class="ok">в заявке</b>' : ''}</div></td><td class="r">${rub(x.a.bal)}</td><td class="r t1">${rub(x.amount)}</td><td class="r">${days(x.daysToPay)}</td><td class="r">${rub(x.cost)} <span class="t2">(${pct(x.cost / x.amount, 1)})</span></td></tr>`).join('')}
  </tbody></table></div></div>`;
}

// ---------- Мои действия ----------
function viewTasks() {
  const open = S.tasks.filter(t => !t.done), done = S.tasks.filter(t => t.done);
  const row = t => `<tr><td><div class="t1">${esc(t.t)}</div><div class="t2"><a href="#/invoices/${esc(t.inv)}">${esc(t.client)} · № ${esc(t.inv)}</a></div></td><td class="r">${rub(t.amount)}</td><td>${dateShort(t.due)}</td><td class="r"><button class="btn sm" data-task="${t.id}">${t.done ? 'Вернуть' : 'Готово'}</button></td></tr>`;
  return `<div class="page-head"><div><h1>Мои действия</h1><p>Шаги, которые вы взяли в работу.</p></div>${open.length ? '<div class="row"><button class="btn" id="ics">В календарь (.ics)</button></div>' : ''}</div>
  ${S.tasks.length ? '' : `<div class="card pad emptycard">${ico('check')}<div><h3>Пока пусто</h3><p class="note">Откройте счёт и нажмите «В мои действия» — шаг появится здесь со сроком.</p></div><a class="btn primary" href="#/today">К списку дел</a></div>`}
  <div class="card" ${S.tasks.length ? '' : 'hidden'}><div class="table-wrap"><table><thead><tr><th>Действие</th><th class="r">Сумма</th><th>Срок</th><th></th></tr></thead><tbody>${open.map(row).join('') || '<tr><td colspan="4" class="empty">Пока пусто. Откройте счёт и нажмите «В мои действия».</td></tr>'}${done.length ? `<tr><th colspan="4">Выполнено</th></tr>${done.map(row).join('')}` : ''}</tbody></table></div></div>${usage()}`;
}

// Продуктовые метрики прямо в продукте: те, что считаем в пилоте (docs/product/02_metrics.md).
function usage() {
  const ev = S.events || [], n = k => ev.filter(e => e.name === k).length;
  const late = LIST.filter(a => a.late > 0).length, opened = new Set(ev.filter(e => e.name === 'card_open').map(e => e.inv)).size;
  const taken = new Set(ev.filter(e => e.name === 'step_taken').map(e => e.inv)).size;
  const first = ev[0]?.at, act = ev.find(e => ['step_taken', 'letter_copied', 'payment_matched'].includes(e.name))?.at;
  const closed = ev.filter(e => e.name === 'payment_matched').reduce((s, e) => s + e.amount, 0);
  const step = (l, v, base) => `<div class="cause-row" style="--c:var(--accent)"><span>${l}</span><b>${v}</b><div class="bar"><i style="width:${base ? Math.min(100, (v / base) * 100) : 0}%"></i></div></div>`;
  return `<h2 class="sec">Метрики продукта</h2><div class="grid g2">
    <div class="card pad"><h3>Воронка: от сигнала к действию</h3><p class="sub">Ваша сессия. В пилоте те же события считаются по всем клиентам</p>
      <div class="cause-rows mt">${step('Просроченных счетов', late, late)}${step('Открыли карточку', opened, late)}${step('Взяли шаг в работу', taken, late)}${step('Скопировали письмо', n('letter_copied'), late)}</div></div>
    <div class="tiles" style="grid-template-columns:1fr 1fr;margin:0">
      <div class="tile plain"><strong>${opened ? pct(taken / opened) : '—'}</strong><span>рекомендаций принято (цель пилота 60%)</span></div>
      <div class="tile plain"><strong>${first && act ? Math.max(1, Math.round((act - first) / 1000)) + ' с' : '—'}</strong><span>от входа до первого действия (time-to-value)</span></div>
      <div class="tile plain"><strong>${rub(closed)}</strong><span>закрыто сверкой выписки</span></div>
      <div class="tile plain"><strong>${n('doc_checked')}</strong><span>документов проверено до отправки</span></div>
    </div></div>`;
}

// ---------- Качество ИИ ----------
function viewQuality() {
  const rows = S.evalData.rows.filter(r => !r.excluded), excl = S.evalData.rows.filter(r => r.excluded);
  const pred = rows.map(r => ({ r, jev: r.jev.pred, rules: classifyText(r.text).cause }));
  const acc = k => pred.filter(p => p[k] === p.r.label).length;
  const accBy = (k, src) => pred.filter(p => p.r.source === src && p[k] === p.r.label).length;
  const nBy = src => rows.filter(r => r.source === src).length;
  const per = k => CAUSE_KEYS.map(c => { const tp = pred.filter(p => p[k] === c && p.r.label === c).length, fp = pred.filter(p => p[k] === c && p.r.label !== c).length, fn = pred.filter(p => p[k] !== c && p.r.label === c).length; return { c, p: tp / (tp + fp || 1), rc: tp / (tp + fn || 1), n: tp + fn }; });
  const cm = k => CAUSE_KEYS.map(t => CAUSE_KEYS.map(p => pred.filter(x => x.r.label === t && x[k] === p).length));
  const inv = S.demo.invoices.filter(i => i.label !== 'none' && S.demo.analysis[i.id]?.jev);
  const invHit = inv.filter(i => S.demo.analysis[i.id].jev.answers.cause.choice === i.label).length;
  const invRules = inv.filter(i => classifyText([...i.messages].reverse().find(m => m.from === 'client')?.text || '').cause === i.label).length;
  const lat = Object.values(S.demo.analysis).map(a => a.jev?.latency_ms).filter(Boolean);
  const letters = Object.values(S.demo.analysis).filter(a => a.llm);
  const flagged = letters.filter(a => a.llm.invalid_numbers?.length);
  const swapped = letters.filter(a => letterIssues(a.llm.body, a.jev?.answers?.cause?.choice).length);
  const m = S.model.metrics, H = S.honest.causes, HF = S.honest.forecast, dec = x => String(x).replace('.', ',');
  const cmTable = k => `<table class="cm"><tr><th></th>${CAUSE_KEYS.map(c => `<th title="${esc(C(c).ru)}">${esc(C(c).short.slice(0, 6))}</th>`).join('')}</tr>${cm(k).map((r, i) => `<tr><th style="text-align:right">${esc(C(CAUSE_KEYS[i]).short)}</th>${r.map((v, j) => `<td style="background:${v ? (i === j ? `rgba(19,138,91,${0.15 + v / 20})` : `rgba(194,65,45,${0.15 + v / 8})`) : 'var(--line2)'};font-weight:${v ? 800 : 400}">${v || ''}</td>`).join('')}</tr>`).join('')}</table><p class="note">Строки — правильная причина, столбцы — ответ.</p>`;
  return `<div class="page-head"><div><h1>Качество ИИ</h1>
    <p>Jev определяет причину, GigaChat пишет черновик. Суммы, сроки и сверку считает обычный код.</p></div>
    <label class="switch" title="Разбирать переписку правилами, письма — по шаблонам"><input type="checkbox" id="noai" ${S.noAI ? 'checked' : ''}><i></i>Работать без ИИ</label></div>
  <div class="grid g4">
    <div class="card pad"><span class="note">Jev, письма команды (вручную)</span><div class="big ok">${accBy('jev', 'hand')} / ${nBy('hand')}</div><span class="note">сгенерированные GigaChat: ${accBy('jev', 'gigachat')} / ${nBy('gigachat')} · 95% интервал: ${pct(H.jev.all.lo)}–100%</span></div>
    <div class="card pad"><span class="note">Правила (без ИИ), то же</span><div class="big warn">${pct(acc('rules') / rows.length)}</div><span class="note">${acc('rules')} из ${rows.length} — базовая линия</span></div>
    <div class="card pad"><span class="note">Jev, причина по всей истории счёта</span><div class="big ok">${invHit} / ${inv.length}</div><span class="note">правила по последнему письму: ${invRules} / ${inv.length}</span></div>
    <div class="card pad"><span class="note">Время ответа Jev</span><div class="big">${(lat.sort((a, b) => a - b)[Math.floor(lat.length / 2)] / 1000 || 0).toFixed(1).replace('.', ',')} с</div><span class="note">медиана, ${lat.length} запросов</span></div>
  </div>
  <div class="alert warn mt"><b>Это не оценка точности.</b> Письма написала команда или сгенерировал GigaChat, независимой отложенной выборки пока нет. Совпадение 100% значит, что модель понимает наши формулировки, а не что она не ошибается на реальной переписке. Реальную точность измерим на обезличенной переписке (цель — macro-F1 не ниже 0,75). Состав набора: ${rows.filter(r => r.source === 'hand').length} написаны вручную с намеренно трудными формулировками, ${rows.filter(r => r.source === 'gigachat').length} сгенерированы GigaChat. ${plural(excl.length, 'Исключено', 'Исключено', 'Исключено')} ${excl.length} ${plural(excl.length, 'сгенерированное письмо', 'сгенерированных письма', 'сгенерированных писем')} при ручной проверке до подсчёта метрик (написаны от лица поставщика или противоречивы).</div>
  <h2 class="mt" style="font-size:20px;margin-bottom:12px">Что доказывают эти цифры</h2>
  <div class="grid g3">
    <div class="card pad"><h3>Интервал вместо «100%»</h3><p class="sub">Точный 95% доверительный интервал (Клоппер — Пирсон)</p>
      <div class="big">${pct(H.jev.all.lo)}–100%</div><p class="note">${H.jev.all.k} из ${H.jev.all.n} писем без ошибок значит лишь, что на похожих письмах точность Jev, скорее всего, не ниже ${pct(H.jev.all.lo)}. Ошибок ${H.jev_errors}, поэтому калибровку вероятностей Jev измерить нельзя: в ${pct(H.jev_confident_share)} ответов она уверена на 99% и выше.</p></div>
    <div class="card pad"><h3>Обучаемый бейзлайн</h3><p class="sub">TF-IDF по символам + логистическая регрессия на этих же письмах</p>
      <div class="big warn">${pct(H.baseline_cv.acc)}</div><p class="note">кросс-валидация на всех ${H.baseline_cv.n} письмах (macro-F1 ${dec(H.baseline_cv.macro_f1)}). Обучили на письмах GigaChat, проверили на ручных: ${pct(H.baseline_cross['gigachat->hand'].acc)}. Ручные письма заметно труднее сгенерированных, а Jev работает без обучения на наших данных и ошибок на них не сделала.</p></div>
    <div class="card pad"><h3>Сколько данных нужно</h3><p class="sub">Чтобы измерить точность с погрешностью ±5 п. п.</p>
      <div class="big">~${H.need_letters}</div><p class="note">реальных обезличенных писем с разметкой двумя людьми, отложенных до подсчёта метрик. Это план пилота: без такого набора любая цифра точности — оценка на нашей синтетике.</p></div>
  </div>
  <div class="grid g2 mt">
    <div class="card pad"><h3>Jev: матрица ошибок</h3><p class="sub">Модель ${esc(S.evalData.model)} · ответ «причина не названа» считается классом «молчит»</p>${cmTable('jev')}</div>
    <div class="card pad"><h3>Правила: матрица ошибок</h3><p class="sub">Регулярные выражения в браузере — работают без сети</p>${cmTable('rules')}</div>
  </div>
  <div class="card mt"><div class="table-wrap"><table><thead><tr><th>Причина</th><th class="r">Писем</th><th class="r">Jev точность</th><th class="r">Jev полнота</th><th class="r">Правила точность</th><th class="r">Правила полнота</th></tr></thead><tbody>
  ${per('jev').map((x, i) => { const y = per('rules')[i]; return `<tr><td>${causePill(x.c, false)}</td><td class="r">${x.n}</td><td class="r">${pct(x.p)}</td><td class="r">${pct(x.rc)}</td><td class="r">${pct(y.p)}</td><td class="r">${pct(y.rc)}</td></tr>`; }).join('')}</tbody></table></div></div>
  <div class="grid g2 mt">
    <div class="card pad"><h3>Проверка писем GigaChat</h3><p class="sub">Каждое число в черновике сверяется с данными счёта и перепиской</p>
      <div class="big">${letters.length - new Set([...flagged, ...swapped]).size} / ${letters.length}</div><p class="note">писем прошли проверку фактов и сторон.${swapped.length ? ` В ${swapped.length} модель перепутала стороны и попросила клиента прислать документ, который оформляет поставщик (${swapped.map(a => '№ ' + a.id).join(', ')}): такие черновики заменяются шаблоном.` : ''} ${flagged.length ? `В ${flagged.length} модель добавила число, которого нет во входных данных (${flagged.map(a => `№ ${a.id}: «${a.llm.invalid_numbers.join(', ')}»`).join('; ')}) — интерфейс показывает предупреждение.` : ''} Письма не отправляются без человека.</p></div>
    <div class="card pad"><h3>Прогноз оплаты</h3><p class="sub">Логистическая + логнормальная модель срока, ${m.train_rows} / ${m.test_rows} счетов из нашего генератора</p>
      <div class="grid g3"><div><span class="note">AUC модели</span><div class="big">${dec(HF.auc_model)}</div></div><div><span class="note">Потолок генератора</span><div class="big">${dec(HF.auc_ceiling)}</div></div><div><span class="note">В «другом мире»</span><div class="big warn">${dec(HF.auc_other_world)}</div></div></div>
      <p class="note">Потолок — AUC истинной вероятности, которую задаёт генератор: выше него не поднимется ни одна модель. Наша модель упирается в потолок, то есть просто восстановила наши же допущения. Если допущения неверны (другие доли неоплаты по причинам и сила признаков), та же модель даёт ${dec(HF.auc_other_world)} при потолке ${dec(HF.auc_other_world_ceiling)}. <b>Это проверка конвейера, а не качество прогноза.</b> Модель переобучается на выписке и реестре клиента в пилоте.</p></div>
  </div>
  <div class="card pad mt"><h3>Примеры трудных случаев</h3><p class="sub">Где правила ошибаются, а Jev — нет</p>
    <div class="table-wrap"><table><thead><tr><th>Письмо</th><th>Верно</th><th>Jev</th><th>Правила</th></tr></thead><tbody>${pred.filter(p => p.rules !== p.r.label).slice(0, 8).map(p => `<tr><td style="max-width:420px;font-size:13px">${esc(p.r.text)}</td><td>${causePill(p.r.label)}</td><td>${causePill(p.jev)}</td><td>${causePill(p.rules)}</td></tr>`).join('')}</tbody></table></div></div>`;
}

// ---------- Для банка ----------
// Подсказка клиентскому менеджеру: что предложить и почему.
function offer(x) {
  if (x.debtor_alerts >= 2) return 'Обсудить риск дебиторов до продления лимита';
  if ((x.mix.documents || 0) + (x.mix.details || 0) > 0.4) return 'Подключить ЭДО: просрочку держат документы и реквизиты';
  if (x.dso > 40) return 'Факторинг: длинный срок оборота, документы в порядке';
  return 'Факторинг на разрыв и контроль оплат';
}

function viewBank() {
  const P = S.demo.bank_portfolio;
  const sum = k => P.reduce((s, x) => s + x[k], 0);
  const leads = P.filter(x => !x.uses_factoring && x.factorable > 1.5e6).sort((a, b) => b.factorable - a.factorable);
  const alerts = P.filter(x => x.debtor_alerts >= 2).sort((a, b) => b.overdue - a.overdue);
  const mix = Object.fromEntries(CAUSE_KEYS.map(k => [k, P.reduce((s, x) => s + x.mix[k] * x.overdue, 0)]));
  const mixTot = Object.values(mix).reduce((a, b) => a + b, 0);
  return `<div class="page-head"><div><h1>Для банка</h1>
    <p>Обезличенная дебиторка клиентов МСБ, кандидаты на факторинг и ранние сигналы риска. Данные синтетические.</p></div></div>
  <div class="tiles">
    <div class="tile accent">${ico('rub', true)}<strong>${mln(leads.reduce((s, x) => s + x.factorable, 0))}</strong><span>можно профинансировать у ${leads.length} клиентов без факторинга</span></div>
    <div class="tile">${ico('chart')}<strong>${mln(sum('ar'))}</strong><span>дебиторка ${P.length} клиентов МСБ</span></div>
    <div class="tile bad">${ico('clock')}<strong>${mln(sum('overdue'))}</strong><span>просрочено, ${pct(sum('overdue') / sum('ar'))} дебиторки</span></div>
  </div>
  <div class="grid g2 mt">
    <div class="card"><div class="pad" style="padding:24px 24px 0"><h3>Кандидаты на факторинг</h3><p class="sub">Документы подписаны, спора нет, дебиторы без риска</p></div>
      <div class="table-wrap"><table><thead><tr><th>Клиент</th><th class="r">Выручка/мес</th><th class="r">DSO</th><th class="r">Можно финансировать</th></tr></thead><tbody>${leads.slice(0, 8).map(x => `<tr><td><div class="t1">${esc(x.id)}</div><div class="t2">${esc(x.sector)}</div><div class="t2 offer">${esc(offer(x))}</div></td><td class="r">${mln(x.revenue_month)}</td><td class="r">${x.dso} дн.</td><td class="r t1">${mln(x.factorable)}</td></tr>`).join('')}</tbody></table></div></div>
    <div class="grid" style="align-content:start">
      <div class="card pad"><h3>Причины просрочки в портфеле</h3><p class="sub">Взвешено по сумме просрочки</p><div class="cause-rows">${CAUSE_KEYS.sort((a, b) => mix[b] - mix[a]).map(k => `<div class="cause-row" style="--c:var(--c-${k})"><span>${esc(C(k).ru)}</span><b>${pct(mix[k] / mixTot)}</b><div class="bar"><i style="width:${mix[k] / mixTot * 100 * 2.5}%"></i></div></div>`).join('')}</div></div>
      <div class="card pad"><h3>Ранние сигналы</h3><p class="sub">У клиента 2+ дебитора с признаками неплатёжеспособности — риск для его кредита</p>
        <ul class="flags">${alerts.slice(0, 5).map(x => `<li><b>${esc(x.id)}</b> ${esc(x.sector)}: просрочка ${mln(x.overdue)}, проблемных дебиторов ${x.debtor_alerts}</li>`).join('')}</ul></div>
    </div></div>
  <div class="chip mt" style="margin-top:20px">Банк зарабатывает на факторинге, остатках на счёте и снижении кредитного риска</div>`;
}

// ---------- Опрос ----------
const SKEY = 'oplata-survey';
const FORM_URL = 'https://forms.yandex.ru/u/6ae625e71f1eb51dc7d05444';
const surveyRows = () => { try { return JSON.parse(localStorage.getItem(SKEY) || '[]'); } catch { return []; } };
// Варианты причины перемешиваются, чтобы первой не стояла наша же гипотеза; «Другое» всегда последним.
const shuffled = o => { const a = o.filter(x => x !== 'Другое'); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return o.includes('Другое') ? [...a, 'Другое'] : a; };
function viewSurvey() {
  const rows = surveyRows(), sm = summary(rows);
  if (S.surveyDone) return `<section class="head"><div><h1>Спасибо!</h1><p class="lead">${S.surveyDone === 'screened' ? 'Этот опрос для компаний, которые выставляют счета с отсрочкой оплаты. Спасибо, что откликнулись.' : 'Ответ сохранён.'}</p></div>
    <div class="hero-actions"><button class="btn primary lg" id="sv-again">Заполнить ещё раз</button></div></section>${surveyTeam(rows, sm)}`;
  return `<section class="head"><div><h1>Как компании получают<br>оплату от клиентов</h1><p class="lead">4 минуты. Ответы используем только в обобщённом виде.</p></div>
    <div class="hero-actions"><a class="btn lg" href="${FORM_URL}" target="_blank" rel="noopener">Открыть форму для рассылки ↗</a></div></section>
  <div class="progress" style="max-width:820px"><i id="sv-prog" style="width:0"></i></div>
  <form class="survey mt" id="sv" novalidate>
    ${SURVEY.map(x => `<fieldset class="q" data-q="${x.k}" ${x.show ? 'hidden' : ''}><legend><span class="qn"></span>${esc(x.q)}${x.hint ? `<small>${esc(x.hint)}</small>` : ''}</legend>
      ${x.text ? `<textarea name="${x.k}" rows="3" maxlength="600" placeholder="Например: клиент ждал исправленный УПД две недели, после отправки через ЭДО оплатил на следующий день"></textarea>`
      : `<div class="opts">${(x.shuffle ? shuffled(x.o) : x.o).map(o => `<label><input type="${x.multi ? 'checkbox' : 'radio'}" name="${x.k}" value="${esc(o)}"><span>${esc(o)}</span></label>`).join('')}</div>`}</fieldset>`).join('')}
    <fieldset class="q" id="sv-contact" hidden><legend>Ник в Telegram<small>если готовы к звонку; необязательно</small></legend>
      <input type="text" name="nick" maxlength="40" placeholder="@nickname" aria-label="Ник в Telegram">
      <label class="consent"><input type="checkbox" name="consent"> Согласен на обработку ника для связи по этому исследованию. Удалим после конкурса.</label></fieldset>
    <div class="row"><button class="btn primary lg">Отправить</button><span class="note" id="sv-err"></span></div>
  </form>${surveyTeam(rows, sm)}`;
}
function surveyTeam(rows, sm) {
  if (!rows.length) return '';
  return `<h2 class="sec">Итоги для команды</h2><div class="tiles">
    <div class="tile accent">${ico('chart', true)}<strong>${sm.n}</strong><span>${plural(sm.n, 'анкета', 'анкеты', 'анкет')} прошли отбор${sm.dropped ? `, отсеяно ${sm.dropped}` : ''}</span></div>
    <div class="tile">${ico('check')}<strong>${sm.fixableShare == null ? '—' : pct(sm.fixableShare)}</strong><span>устранимых причин (гипотеза: не меньше трети)</span></div>
    <div class="tile">${ico('clock')}<strong>${sm.medianMinutes == null ? '—' : '~' + sm.medianMinutes + ' мин'}</strong><span>медиана времени на выяснение причины</span></div>
  </div><div class="row mt"><button class="btn" id="sv-csv">Скачать ответы CSV</button><span class="note">На слайде: n анкет, выборка из чатов, нерепрезентативна.</span></div>`;
}
function bindSurvey() {
  const f = $('#sv');
  const again = $('#sv-again'); if (again) again.onclick = () => { S.surveyDone = false; render(); };
  const csv = $('#sv-csv'); if (csv) csv.onclick = () => download('opros_oplata.csv', surveyCsv(surveyRows()), 'text/csv;charset=utf-8');
  if (!f) return;
  const read = () => {
    const a = {};
    for (const x of SURVEY) a[x.k] = x.multi ? $$(`[name="${x.k}"]:checked`, f).map(i => i.value) : x.text ? f[x.k].value.trim() : ($(`[name="${x.k}"]:checked`, f)?.value || '');
    return a;
  };
  const sync = () => {
    const a = read(), shown = SURVEY.filter(x => visible(x, a));
    let n = 0;
    for (const x of SURVEY) { const el = $(`[data-q="${x.k}"]`, f); el.hidden = !visible(x, a); if (!el.hidden) $('.qn', el).textContent = `${++n}. `; el.style.boxShadow = ''; }
    $('#sv-prog').style.width = `${((shown.length - missing(a).length) / shown.length) * 100}%`;
    $('#sv-contact').hidden = a.screen === 'Нет' || !a.screen;
    return a;
  };
  sync();
  f.onchange = sync; f.oninput = sync;
  f.onsubmit = async e => {
    e.preventDefault();
    const a = sync();
    if (a.screen === 'Нет') {  // отсев: анкету не сохраняем
      S.surveyDone = 'screened'; render(); return;
    }
    const miss = missing(a), nick = f.nick.value.trim().slice(0, 40);
    if (nick && !f.consent.checked) miss.push('consent');
    if (miss.length) {
      for (const k of miss) { const el = k === 'consent' ? $('#sv-contact') : $(`[data-q="${k}"]`, f); el.style.boxShadow = '0 0 0 2px var(--bad)'; }
      (miss[0] === 'consent' ? $('#sv-contact') : $(`[data-q="${miss[0]}"]`, f)).scrollIntoView({ behavior: 'smooth', block: 'center' });
      $('#sv-err').textContent = miss.includes('story') ? 'Опишите случай хотя бы парой предложений' : miss[0] === 'consent' ? 'Отметьте согласие или сотрите ник' : `Осталось ответить: ${miss.length}`;
      return;
    }
    const row = { at: new Date().toISOString(), ...a, nick, consent: !!nick };
    try { localStorage.setItem(SKEY, JSON.stringify([...surveyRows(), row])); } catch { /* приватный режим */ }
    if (S.live) fetch('api/survey', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(row) }).catch(() => {});
    S.surveyDone = true; render();
  };
}

// ---------- Как это работает ----------
function viewHow() {
  return `<div class="page-head"><div><h1>Как это работает</h1><p>ИИ — только чтобы понять письмо и написать черновик. Всё точное считает код.</p></div></div>
  <div class="arch"><div>${ico('cal')}<b>Данные</b>Реестр счетов (1С, CSV), выписка (1С: Клиент-банк), статус документов в ЭДО, переписка</div>
    <div>${ico('check')}<b>Причина</b>Decision-модель Jev отвечает вероятностями на атомарные вопросы о переписке. Без сети — правила</div>
    <div>${ico('chart')}<b>Прогноз</b>Вероятность и срок оплаты: логистическая и логнормальная модели, веса считаются в браузере</div>
    <div>${ico('clock')}<b>Действие</b>Следующий шаг по таблице решений, письмо GigaChat с проверкой фактов, претензия по шаблону</div>
    <div>${ico('rub')}<b>Деньги</b>Сверка выписки, прогноз кассового разрыва, подбор счетов для факторинга</div></div>
  <div class="grid g2 mt">
    <div class="card pad"><h3>Защита данных</h3><ul class="flags">
      <li>Демо работает в браузере: загруженные файлы никуда не отправляются.</li>
      <li>В банке сервис разворачивается в контуре (on-prem): Jev и генеративная модель — локально (GigaChat on-prem, T-Pro или Qwen через совместимый API).</li>
      <li>Иностранные облачные модели не используются: требование 152-ФЗ о локализации и передаче данных за рубеж.</li>
      <li>Банк — оператор данных, команда — обработчик по поручению. Переписка с контактными лицами — персональные данные, обрабатываются по согласию клиента.</li>
      <li>Человек подтверждает каждое внешнее действие: письмо, претензию, заявку на факторинг (рекомендации Банка России по этике ИИ, 2025).</li></ul></div>
    <div class="card pad"><h3>Что дальше</h3><ul class="flags">
      <li>Пилот: 10–20 клиентов МСБ, обезличенная переписка, измерение точности причин и срока оплаты.</li>
      <li>Интеграции: почта (IMAP), ЭДО (Диадок, СБИС), выписка из интернет-банка, 1С.</li>
      <li>Отправка реестра уступки в факторинговую компанию банка.</li>
      <li>Отчётность и банкротства контрагента (ГИР БО, Федресурс) вдобавок к ЕГРЮЛ.</li>
      <li>Оплата по факту подписания УПД на смарт-контракте цифрового рубля.</li></ul>
      <p class="note">Код, ресерч и методология: <a href="${REPO}" target="_blank" rel="noopener">${REPO.replace('https://', '')}</a></p></div></div>`;
}

// ---------- События ----------
function bind(v) {
  $$('[data-open]').forEach(el => el.onclick = () => { S.back = location.hash; location.hash = `#/invoices/${el.dataset.open}`; });
  if (v === 'invoices') {
    $$('[data-f]').forEach(b => b.onclick = () => { S.filter = b.dataset.f; render(); });
    const q = $('#q'); q.oninput = () => { S.q = q.value; const pos = q.selectionStart; render(); const n = $('#q'); n.focus(); n.setSelectionRange(pos, pos); };
    $('#export').onclick = () => download('oplata_reestr.csv', exportCsv(LIST), 'text/csv;charset=utf-8');
  }
  if (v === 'reconcile') {
    $$('[data-apply]').forEach(b => b.onclick = () => {
      const res = reconcile(S.statement, S.invoices).filter(r => r.p.num === b.dataset.apply);
      S.invoices = applyMatches(S.invoices, res); S.applied.push(b.dataset.apply); track('payment_matched', { amount: res[0].p.amount }); save(); render();
      toast(`Учтено: ${res[0].match.map(m => '№ ' + m.id).join(', ')}`);
    });
    $('#dl1c').onclick = () => download('vypiska_1c_demo.txt', to1C(S.demo.statement, S.demo.supplier.inn));
    $('#f1c').onchange = async e => {
      const f = e.target.files[0]; if (!f) return;
      const buf = await f.arrayBuffer(); let t = new TextDecoder('utf-8').decode(buf); if (t.includes('�')) t = new TextDecoder('windows-1251').decode(buf);
      try { const old = S.statement; S.statement = parse1C(t).map(p => ({ ...p, posted: old.some(o => o.posted && o.num === p.num && o.amount === p.amount) })); save(); render(); toast(`Платежей в выписке: ${S.statement.length}`); } catch (err) { toast(err.message); }
    };
  }
  if (v === 'today') {
    const ask = q => { S.ask = q; $('#ask-q').value = q; $('#ask-out').innerHTML = askAnswer(q); bind('ask'); };
    $('#ask').onsubmit = e => { e.preventDefault(); ask($('#ask-q').value); };
  }
  if (v === 'today' || v === 'ask') $$('[data-ask]').forEach(b => b.onclick = () => { S.ask = b.dataset.ask; $('#ask-q').value = S.ask; $('#ask-out').innerHTML = askAnswer(S.ask); bind('ask'); });
  if (v === 'tasks' && $('#ics')) $('#ics').onclick = () => download('oplata_deystviya.ics', tasksIcs(S.tasks), 'text/calendar;charset=utf-8');
  if (v === 'message') bindMessage();
  if (v === 'docs') bindDocs();
  if (v === 'tasks') $$('[data-task]').forEach(b => b.onclick = () => { const t = S.tasks.find(x => String(x.id) === b.dataset.task); t.done = !t.done; save(); render(); });
  if (v === 'survey') bindSurvey();
  if (v === 'quality') $('#noai').onchange = e => { S.noAI = e.target.checked; save(); toast(S.noAI ? 'Причины разбирают правила, письма по шаблонам' : 'Модели включены'); };
  if (v === 'money') { const b = $('#fx-req'); if (b) b.onclick = factoringDialog; }
}

boot().catch(e => { $('#view').innerHTML = `<div class="alert bad">Не удалось загрузить данные демо: ${esc(e.message)}. Откройте через локальный сервер (npm start).</div>`; });

// Сроки и взыскание: детерминированные правила, без генеративной модели.
// Пороги меняются законом, поэтому это справочник с датой действия, а не код.
// Источники: АПК РФ ст. 4, 227, 229.2; НК РФ ст. 333.21; постановление 1352. Проверить у юриста банка перед пилотом.
import { addDays } from './util.js';
import { interest395 } from './documents.js';

export const LAW = {
  asOf: '2026-10-31',
  orderMax: 750000,          // судебный приказ, ст. 229.2 АПК
  simplifiedOrg: 1200000,    // упрощённое производство к юрлицам, ст. 227 АПК
  simplifiedIp: 600000,      // упрощённое производство к ИП
  claimDays: 30,             // обязательный претензионный порядок, ч. 5 ст. 4 АПК
  orderFeeShare: 0.5, orderFeeMin: 8000,
};

// Госпошлина по имущественному иску в арбитраж, ст. 333.21 НК РФ (редакция с 09.09.2024).
export function courtFee(sum) {
  if (sum <= 100000) return 10000;
  if (sum <= 1000000) return 10000 + (sum - 100000) * 0.05;
  if (sum <= 10000000) return 55000 + (sum - 1000000) * 0.03;
  if (sum <= 50000000) return 325000 + (sum - 10000000) * 0.01;
  return Math.min(725000 + (sum - 50000000) * 0.005, 10000000);
}

export function recoveryPath(a, today) {
  const sum = a.bal, isIp = String(a.inv.inn).length === 12;
  const interest = interest395(sum, addDays(a.inv.due, 1), today).total;
  const simple = isIp ? LAW.simplifiedIp : LAW.simplifiedOrg;
  const proc = sum <= LAW.orderMax ? 'Судебный приказ' : sum <= simple ? 'Упрощённое производство' : 'Иск в общем порядке';
  const full = courtFee(sum);
  const fee = proc === 'Судебный приказ' ? Math.max(full * LAW.orderFeeShare, LAW.orderFeeMin) : full;
  const canSue = addDays(today, LAW.claimDays);
  const feeShare = sum ? fee / sum : 0;
  return {
    sum, interest, proc, fee, feeShare, canSue,
    advice: feeShare > 0.1
      ? 'Суд обойдётся дорого относительно долга: сначала письмо, график и претензия.'
      : 'Если досудебные шаги не сработают, суд экономически оправдан.',
  };
}

// Законный срок оплаты там, где он задан не договором, а законом.
export function legalTerm(client) {
  if (/223/.test(client?.sector || '')) return 'Заказчик по 223-ФЗ: договор с МСП оплачивается не позднее 7 рабочих дней после подписания документа о приёмке (постановление № 1352).';
  return '';
}

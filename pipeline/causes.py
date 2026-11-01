"""Таксономия причин неоплаты и вопросы к decision-модели Jev.

Модель не «решает» за сотрудника. Она отвечает на атомарные вопросы о переписке,
а программные правила превращают ответы в рекомендацию. Вопросы на английском:
так decision-модели отвечают точнее; подписи для интерфейса — на русском.
"""

CAUSES = {
    "documents": {
        "ru": "Не хватает документа или в нём ошибка",
        "short": "Документы",
        "en": "Client is waiting for a missing or corrected closing document from the supplier (act, UPD, invoice-factura, acceptance form)",
        "fixable": True,
        "action": "Исправить и отправить документ через ЭДО",
        "why": "Деньги у клиента есть, оплату держит бумага. Это самая быстрая к устранению причина.",
    },
    "dispute": {
        "ru": "Спор по сумме, объёму или качеству",
        "short": "Спор",
        "en": "Client disputes the amount, scope or quality of work and withholds payment until resolved",
        "fixable": True,
        "action": "Сверить с договором и согласовать позицию",
        "why": "Пока разногласие не снято, напоминания не помогут: нужен разговор по существу.",
    },
    "liquidity": {
        "ru": "У клиента нет денег",
        "short": "Нет денег",
        "en": "Client has no money or liquidity problems and cannot pay now",
        "fixable": False,
        "action": "Договориться о графике и оценить риск",
        "why": "Документами не исправить. Важно зафиксировать график и не наращивать долг.",
    },
    "approval": {
        "ru": "Платёж на согласовании у клиента",
        "short": "Согласование",
        "en": "Payment is stuck in the client's internal approval or treasury schedule; documents are accepted",
        "fixable": False,
        "action": "Зафиксировать дату реестра и проконтролировать",
        "why": "Деньги и документы в порядке, нужна дата и контроль, без давления.",
    },
    "details": {
        "ru": "Ошибка в реквизитах или платёж вернулся",
        "short": "Реквизиты",
        "en": "Payment failed or is blocked because of wrong bank details of the supplier",
        "fixable": True,
        "action": "Отправить верные реквизиты и платёжную ссылку",
        "why": "Клиент хочет заплатить, но не может. Исправляется за минуты.",
    },
    "silence": {
        "ru": "Клиент молчит или забыл",
        "short": "Нет ответа",
        "en": "Client does not respond, forgot, or broke a promised payment date without explanation",
        "fixable": True,
        "action": "Напомнить с платёжной ссылкой, затем позвонить",
        "why": "Причина неизвестна. Нужен контакт, который снимет вопрос или выявит настоящую причину.",
    },
    "paid": {
        "ru": "Оплачено, но не сверено",
        "short": "Уже оплачено",
        "en": "Client says the invoice is already paid (payment sent) but the supplier has not matched it",
        "fixable": True,
        "action": "Найти платёж в выписке и закрыть счёт",
        "why": "Долга может не быть. Напоминание в такой ситуации портит отношения.",
    },
}

# Вопросы ко всей истории по счёту.
INVOICE_QUESTIONS = {
    "cause": {
        "type": "choice",
        "instructions": "Based on the latest relevant messages, what is the main reason the INVOICE has not been fully paid yet? Later messages override earlier ones.",
        "criteria": {k: v["en"] for k, v in CAUSES.items()},
    },
    "fixable": {"type": "noul", "instructions": "Can the supplier remove the obstacle to payment by its own action (send or correct a document, fix bank details, confirm a payment)?"},
    "promise": {"type": "noul", "instructions": "Has the client explicitly committed to pay on a specific date or after a specific condition is met?"},
    "insolvency": {"type": "noul", "instructions": "Is there evidence that the client is unable to pay because of financial distress?"},
    "docs_ok": {"type": "noul", "instructions": "Does the client confirm that the supplier's documents are accepted and in order?"},
    "conflict": {"type": "noul", "instructions": "Is the client dissatisfied with the supplier's work or in disagreement about what is owed?"},
    "urgency": {"type": "score", "instructions": "How urgently should the supplier act now to get paid?",
                "criteria": ["Not urgent", "Low", "Medium", "High", "Critical"]},
}

# Вопрос к одному сообщению: для выбора цитаты-основания.
MESSAGE_QUESTIONS = {
    "cause": {
        "type": "choice",
        "instructions": "What reason for non-payment of the invoice does this MESSAGE state? If the message gives no reason, choose the closest option.",
        "criteria": {**{k: v["en"] for k, v in CAUSES.items()}, "none": "The message states no reason for non-payment"},
    },
}


def invoice_state(inv: dict, client: dict, today: str) -> str:
    """Текст для модели: только факты счёта и переписка, без меток."""
    lines = [
        f"TODAY: {today}",
        f"INVOICE № {inv['id']} to client {client['name']} ({client.get('sector', '')}), amount {inv['amount']} RUB, "
        f"already paid {inv.get('paid', 0)} RUB, due date {inv['due']}.",
        f"Closing act status: {inv.get('docs', {}).get('act', 'unknown')}; EDO used: {inv.get('docs', {}).get('edo', False)}.",
        "CORRESPONDENCE (oldest first):",
    ]
    for m in inv.get("messages", []):
        who = "CLIENT" if m["from"] == "client" else "SUPPLIER"
        lines.append(f"[{m['date']}] {who}: {m['text']}")
    if not inv.get("messages"):
        lines.append("(no messages)")
    return "\n".join(lines)

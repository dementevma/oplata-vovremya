# Технологии и научная база: прогноз и снижение просрочки B2B-счетов, AI-коллекшн (состояние на октябрь 2026)

Контекст: продукт «Оплата вовремя» (трек ВТБ, Академия Финтеха 2026). Модули: (a) классификация причины неоплаты, (b) вероятность оплаты и ожидаемая задержка по счёту, (c) next best action, (d) черновики писем через LLM, (e) сверка входящих платежей со счетами.
Метод сбора: OpenAlex API (без mailto) по 20 запросам, затем веб-поиск и чтение первоисточников (arXiv, документация вендоров, страницы тарифов). Цитаты (c=…) взяты из OpenAlex на 28.10.2026.

---

## 1. Прогноз просрочки оплаты счетов (invoice late-payment prediction): ключевые работы, признаки, метрики, датасеты

### Takeaway
Задача хорошо изучена с 2008 г. (IBM Research, KDD). Стандартный подход: классификация по корзинам задержки (вовремя / 1–30 / 31–60 / 60+ дней) на агрегатах платёжной истории плательщика, лучше всего работают деревья (RF, XGBoost). Сообщаемая accuracy 77–85% на реальных B2B-данных против базовой ~55%. Сильнейший сигнал даёт поведение плательщика по последним счетам, а не атрибуты самого счёта. Публичных качественных B2B-датасетов почти нет, поэтому MVP придётся валидировать на синтетике или данных пилотных клиентов.

### Cited Findings
**Фундаментальные работы**
- Zeng, Melville, Lang, Boier-Martin, Murphy (IBM), «Using predictive analysis to improve invoice-to-cash collection», KDD 2008, c=30. Supervised-модели предсказывают для новых счетов, будет ли оплата вовремя, и оценивают величину задержки на данных нескольких фирм. В симуляции model-driven стратегия сокращает время взыскания «до 4 раз» относительно baseline без модели — [DOI 10.1145/1401890.1402014](https://doi.org/10.1145/1401890.1402014)
- В пересказе Appel et al. 2020 Zeng et al. формулируют задачу как классификацию на 4 класса (on time, 1–30, 31–60, 60+ дней) с агрегированными историческими признаками — [arXiv 2008.07363](https://ar5iv.arxiv.org/html/2008.07363)
- Hu, P. «Predicting and improving invoice-to-cash collection through machine learning», 2015 (MIT, магистерская диссертация), c=11. Аннотацию в OpenAlex получить не удалось — [OpenAlex W1830587803](https://openalex.org/W1830587803)
- Kim, J., Kang, P. «Late payment prediction models for fair allocation of customer contact lists to call center agents», Decision Support Systems, 2016, c=39. Прогноз просрочки используется для справедливого распределения списков обзвона между операторами; аннотация в OpenAlex отсутствует — [DOI 10.1016/j.dss.2016.03.002](https://doi.org/10.1016/j.dss.2016.03.002)
- Tater, Dechu, Mani, Maurya (IBM), «Prediction of Invoice Payment Status in Account Payable Business Process», ICSOC/LNCS 2018, c=16. Сторона AP, работа с уже задержанными счетами (по пересказу Appel et al.) — [DOI 10.1007/978-3-030-03596-9_11](https://doi.org/10.1007/978-3-030-03596-9_11); [arXiv 2008.07363](https://ar5iv.arxiv.org/html/2008.07363)
- Smirnov et al. 2016 (по пересказу Appel et al.): Random Survival Forests на исторических данных о платёжном поведении дебитора ранжируют время оплаты просроченных счетов лучше, чем модель Кокса — [arXiv 2008.07363](https://ar5iv.arxiv.org/html/2008.07363)

**Appel et al. (IBM Research Brazil), 2019–2020**
- «Optimize Cash Collection: Use Machine learning to Predicting Invoice Payment» (arXiv 2019, c=4). Прототип для мультинационального банка, до 77% accuracy, улучшение приоритизации клиентов коллекторами. Отдельно отмечена проблема: решения коллекторов не фиксируются в AR-системе — [DOI 10.48550/arxiv.1912.10828](https://doi.org/10.48550/arxiv.1912.10828)
- «Predicting Account Receivables with Machine Learning», KDD 2020 Workshop on ML in Finance. Данные: 91 562 счёта, 2 229 клиентов, 7 стран, ноябрь 2018 – ноябрь 2019. Метка «late» = оплата позже срока более чем на 5 дней (61% late в train, 54,5% в test). Модели: NB, LogReg, kNN, RF, XGBoost, DNN (fastai). Лучшие RF и XGBoost, окно истории 4 месяца. Accuracy до 81% (до 85% в последние месяцы) против baseline 54,51%. Регрессия дней просрочки не приводится — [arXiv 2008.07363](https://ar5iv.arxiv.org/html/2008.07363)
- Важнейшие признаки у Appel et al. 2020: кодировка «оплачены ли последние 3 счёта» (недавнее поведение предсказывает лучше полной истории); число и сумма оплаченных и просроченных счетов; открытые и просроченные открытые счета (число, сумма); средняя задержка и её std; изменение частоты платежей. Симулированная экономия до ~$1,75 млн в месяц — [arXiv 2008.07363](https://ar5iv.arxiv.org/html/2008.07363)

**Поведенческие и современные (2020–2026)**
- Bahrami, Bozkaya, Balcisoy, «Using Behavioral Analytics to Predict Customer Invoice Payment», Big Data, 2020, c=41. 1,6 млн клиентов, история счетов и платежей плюс действия компании (e-mail, SMS, звонок) и реакции клиента. Предложен behavioral score как признак; логистическая регрессия до 97% accuracy. Сегмент B2C/утилити-подобный, не чистый B2B. В статье упоминается, что почти половина счетов SME и B2B в США и Великобритании оплачивается с опозданием — [DOI 10.1089/big.2018.0116](https://doi.org/10.1089/big.2018.0116)
- Schoonbee, Moore, van Vuuren, «A machine-learning approach towards solving the invoice payment prediction problem», South African Journal of Industrial Engineering, 2022, c=7. Многоклассовый прогноз (1–30 / 31–60 / ≥61 день просрочки) и roadmap выбора алгоритма на реальных данных — [DOI 10.7166/33-4-2726](https://doi.org/10.7166/33-4-2726)
- Moore, van Vuuren, «A framework for modelling customer invoice payment predictions», Machine Learning with Applications, 2024, c=4. Обобщённый фреймворк подготовки данных и генерации поведенческих признаков, впервые с ансамблированием методов survival analysis и ML — [DOI 10.1016/j.mlwa.2024.100578](https://doi.org/10.1016/j.mlwa.2024.100578)
- Hovanesyan, «Late payment prediction of invoices through graph features», TU Delft, 2019. Граф контрагентов SME строится через entity resolution; графовые признаки соседей улучшают SOTA, особенно когда нет истории пары продавец–покупатель (cold start) — [OpenAlex W2998435271](https://openalex.org/W2998435271)
- Работы 2025–2026 (низкие цитирования, уровень препринтов и малых журналов): Ibrosheva & Marchev, «Machine-Learning Modeling of Invoice Payment Timeliness for Optimizing B2B AR Management» (SSRN 2026) — [DOI 10.2139/ssrn.7590659](https://doi.org/10.2139/ssrn.7590659); «An Integrated ML Framework For Invoice Payment Delay Prediction Using Temporal Decay Features And Survival…» (IJESAT 2026) — [DOI 10.64771/ijesat.2026.v26.i4.2704](https://doi.org/10.64771/ijesat.2026.v26.i4.2704); «Behavioural Credit Risk Scoring from Invoice payments: Latent Payment Behaviour and Multi-State Delinquency Prediction» (KTH, 2026) — [OpenAlex W7165976950](https://openalex.org/W7165976950); «Forecasting Customer Invoice Settlement with behavioural analytics» (Research Square 2025) — [DOI 10.21203/rs.3.rs-5858261/v1](https://doi.org/10.21203/rs.3.rs-5858261/v1)

**Промышленные реализации**
- Microsoft Dynamics 365 Finance имеет функцию «Payment insights» (прогноз оплаты счетов клиентов) — [Microsoft Learn](https://learn.microsoft.com/en-us/dynamics365/finance/finance-insights/payment-insights-overview)
- Oracle Fusion Analytics: «Supplier On-time Payments Prediction» (AP-сторона) — [Oracle docs](https://docs.oracle.com/en/cloud/saas/analytics/26r1/faiae/supplier-time-payments-prediction.html)

**Датасеты**
- IBM Watson Analytics sample `WA_Fn-UseC_-Accounts-Receivable.csv`: «понять факторы успешного взыскания, предсказать, кто заплатит быстрее». Колонки и лицензию подтвердить не удалось — [поиск, IBM WA sample guide упомянут в выдаче](https://mrylprz.github.io/predicting-payment-outcomes)
- Пример Kaggle-проекта: 2 466 счетов, 100 клиентов, целевая переменная = age bucket. Это не тот же датасет, что у IBM — [mrylprz.github.io](https://mrylprz.github.io/predicting-payment-outcomes)
- Реальные корпоративные датасеты в статьях (IBM 91 562 счёта; Bahrami 1,6 млн клиентов) не опубликованы — [arXiv 2008.07363](https://ar5iv.arxiv.org/html/2008.07363); [DOI 10.1089/big.2018.0116](https://doi.org/10.1089/big.2018.0116)

**Результаты OpenAlex по запросам «invoice payment prediction», «late payment prediction machine learning», «invoice-to-cash collection predictive»** (топ релевантных, остальное нерелевантный шум): см. работы выше. Дополнительно нашлись «AI-Based Invoice Payment Date Prediction for B2B» (LNNS 2023) — [DOI 10.1007/978-981-99-1479-1_41](https://doi.org/10.1007/978-981-99-1479-1_41); «Prediction of Delays in Invoice Payments Using ML» (ICTBIG 2023) — [DOI 10.1109/ictbig59752.2023.10455972](https://doi.org/10.1109/ictbig59752.2023.10455972); «Payment Date Prediction» (SSRN 2024) — [DOI 10.2139/ssrn.4482700](https://doi.org/10.2139/ssrn.4482700)

### Inferences
- Для MVP достаточно градиентного бустинга (LightGBM/CatBoost) на поведенческих агрегатах по плательщику: доля оплаченных вовремя из последних N счетов, средняя и std задержки, открытая просрочка, тренд частоты платежей. Плюс атрибуты счёта: сумма относительно средней по клиенту, срок отсрочки, день недели и месяц срока оплаты, конец квартала. Это повторяет признаки, давшие 81% у IBM.
- Задержку в днях лучше моделировать как time-to-event (survival: Cox, RSF или discrete-time hazard через бустинг). Так правильно учитываются ещё не оплаченные счета (цензурирование), и сразу получается и P(оплата к дате T), и ожидаемая задержка. На это направление указывают Smirnov 2016 и Moore & van Vuuren 2024.
- Cold start (новый контрагент) закрывается внешними и графовыми признаками: отрасль по ОКВЭД, возраст компании, данные ФНС, арбитраж, графовые соседи (Hovanesyan 2019). В РФ для этого подходят открытые реестры (ЕГРЮЛ, картотека арбитражных дел); это вывод автора, для РФ не валидирован.
- Accuracy в статьях несопоставима: разные доли класса «late», разные пороги, B2B и B2C. На защите стоит показывать AUC, Brier и ECE, а не accuracy.

### Gaps
- Полные тексты Hu 2015 и Kim & Kang 2016 недоступны, их метрики и признаки не извлечены.
- Рецензируемых работ 2023–2026 по sequence-моделям (трансформеры по истории платежей) для B2B-счетов с сильными бенчмарками не найдено, есть только препринты низкого уровня.
- Российских публикаций о прогнозе оплаты B2B-счетов на данных РФ не найдено.

---

## 2. Оптимизация взыскания: RL, uplift, next-best-action, тайминг контактов; доказательная база по напоминаниям

### Takeaway
Классика оптимизации взыскания — constrained MDP / RL от IBM: внедрение в налоговой службе штата Нью-Йорк (Abe et al., KDD 2010). В 2024–2025 появились deep RL рекомендательные системы для коллекшна, но в основном для B2C-долгов. Поведенческие RCT (HMRC/BIT, Великобритания) стабильно показывают, что формулировка напоминания меняет долю оплат на 2–5 п.п. при базе ~57%, то есть «правильное письмо» даёт измеримый эффект почти бесплатно.

### Cited Findings
- Abe, Melville, Pendus, Reddy, Jensen et al., «Optimizing debt collections using constrained reinforcement learning», KDD 2010, c=79. Constrained MDP для выбора действий взыскания с учётом ресурсных ограничений, реальное внедрение в NYS Department of Taxation and Finance — [DOI 10.1145/1835804.1835817](https://doi.org/10.1145/1835804.1835817)
- Yang, Lu, Li, Lu, «Personalizing debt collections: Combining reinforcement learning and field experiment», ICIS 2020 — [OpenAlex W3138398573](https://openalex.org/W3138398573)
- Sivamayilvelan et al., «Flexible recommendation for optimizing the debt collection process based on customer risk using deep reinforcement learning», Expert Systems with Applications, 2024, c=28 — [DOI 10.1016/j.eswa.2024.124951](https://doi.org/10.1016/j.eswa.2024.124951)
- «Building explainable AI for reinforcement learning based debt collection recommender system…», Engineering Applications of AI, 2025, c=12. Тренд на объяснимость RL-рекомендаций в коллекшне — [DOI 10.1016/j.engappai.2025.111622](https://doi.org/10.1016/j.engappai.2025.111622)
- «When Less Is More? Deep RL-Based Optimization of Debt Collection», SSRN 2023 — [DOI 10.2139/ssrn.4488673](https://doi.org/10.2139/ssrn.4488673)
- **HMRC / Behavioural Insights Team, эксперимент I (2012)**: 13 вариантов текста, всего около 300 000 напоминаний должникам по подоходному налогу (две волны). При базовой доле оплат 57,1% простое сообщение о мониторинге («мы отслеживаем») повысило оплату на 5 п.п. (+12,5% отн.); вариант «ежедневные проверки» дал +2,6 п.п.; мониторинг + социальная норма +4,4 п.п. Моральные апелляции значимого эффекта не дали — [Floyd, Hallsworth, List, Metcalfe, Rotaru, Vlaev, «What motivates people to pay their taxes?» (PDF)](https://s3.amazonaws.com/fieldexperiments-papers2/papers/00750.pdf)
- **HMRC, эксперимент II**: упоминание неконкретных «дальнейших действий» +4,5 п.п. (p<0,01); упоминание процентов, затрат времени и «спокойствия» без значимого эффекта; «Contact Now» +2,2 п.п.; future-framed вариант с часами работы +2,9 п.п. Удлинение письма снижало эффект (с 4,5 до 1,7 п.п. при добавлении фразы о процентах). Совокупная ускоренная выручка двух полевых экспериментов £9,9 млн — [там же](https://s3.amazonaws.com/fieldexperiments-papers2/papers/00750.pdf)
- Hallsworth, List, Metcalfe, Vlaev, «The behavioralist as tax collector», Journal of Public Economics, 2017, c=763. Более 200 000 человек; социальные нормы в напоминаниях повышают оплату; loss framing не эффективнее gain framing. По Floyd et al., упоминание процентов в Hallsworth 2017 давало около +4 п.п. — [DOI 10.1016/j.jpubeco.2017.02.003](https://doi.org/10.1016/j.jpubeco.2017.02.003); [Floyd et al.](https://s3.amazonaws.com/fieldexperiments-papers2/papers/00750.pdf)
- Cadena & Schoar, «Remembering to Pay? Reminders vs. Financial Incentives for Loan Payments», NBER WP 17020, 2011, c=117. Сравнение напоминаний и денежных стимулов для своевременных платежей по кредитам — [DOI 10.3386/w17020](https://doi.org/10.3386/w17020)
- Pekonen, «Are text message reminders effective in debt collection? RCT in Finland», Aalto, 2014. Рандомизировано 11 949 SMS плюс контрольная группа того же размера, коллекторское агентство — [OpenAlex W2574326144](https://openalex.org/W2574326144)
- Saulītis, «Nudging debtors with non-performing loans: Evidence from three field experiments», JBEF 2022 — [DOI 10.1016/j.jbef.2022.100776](https://doi.org/10.1016/j.jbef.2022.100776)
- Работа о малом бизнесе: «Tax Compliance and Information Provision – A Field Experiment with Small Firms», 2015 — [DOI 10.2139/ssrn.2608118](https://doi.org/10.2139/ssrn.2608118)
- Обзор: «From the lab to the field: a review of tax experiments», J. Economic Surveys 2017, c=207 — [DOI 10.1111/joes.12201](https://doi.org/10.1111/joes.12201)
- Uplift-моделирование (обзор методов: two-model, class transformation, uplift-деревья): Gutierrez & Gérardy, «Causal Inference and Uplift Modelling: A Review of the Literature», PMLR 67, 2017 — [PMLR](http://proceedings.mlr.press/v67/gutierrez17a.html)

### Inferences
- Для MVP RL избыточен: нет логов действий и наград, мало данных. Реалистичный путь: (1) правила плюс прогноз риска, (2) контекстный бандит или uplift-модель после накопления рандомизированных логов действий, (3) RL только при масштабе. Важно с первого дня логировать действие, канал, время и исход, иначе возникнет та же проблема «решения не фиксируются в системе», что у Appel et al. 2019.
- Шаблоны писем стоит строить на элементах с доказанным эффектом (конкретика, последствия бездействия, простое действие «оплатить сейчас», краткость) и тестировать в A/B. HMRC показывает: эффект 2–5 п.п., длинные письма теряют эффект, мораль не работает. Перенос с B2C-налогов на B2B-счета — гипотеза, её нужно подтвердить A/B-тестом.
- Uplift важнее «риска»: звонить стоит тем, у кого звонок меняет исход (persuadables), а не тем, кто и так заплатит или не заплатит никогда.

### Gaps
- Количественный эффект внедрения у Abe et al. (рост собранной выручки NYS) в доступных аннотациях не указан. Встречающуюся оценку (~$83 млн, Interfaces 2012) проверить не удалось.
- Конкретный эффект Cadena & Schoar (эквивалентность напоминания снижению ставки) не извлечён, аннотация в OpenAlex пустая.
- Рандомизированных исследований о напоминаниях именно в B2B-счетах (компания → компания) не найдено, вся RCT-база про налоги и потребительские долги.
- По uplift-моделированию непосредственно в дебиторке и даннинге рецензируемых работ через OpenAlex не найдено.

---

## 3. LLM в коллекшне и AR (2024–2026): классификация споров, интенты писем, агентный AR, контроль галлюцинаций, калибровка вероятностей

### Takeaway

### Cited Findings
- Xiong et al., «Can LLMs Express Their Uncertainty? An Empirical Evaluation of Confidence Elicitation in LLMs», ICLR 2024. Вербализованная уверенность LLM переуверена; калибровка улучшается с размером модели; помогают consistency нескольких ответов и агрегация, но ни один метод не доминирует, а на задачах с профессиональными знаниями все методы слабы — [arXiv 2306.13063](https://arxiv.org/abs/2306.13063v2); [ICLR 2024](https://iclr.cc/virtual/2024/poster/18135)
- ConfTuner (2025): промпт-методы дают «limited effects» для калибровки. Предложено дообучение с tokenized Brier score (proper scoring rule) — [arXiv 2508.18847](https://arxiv.org/abs/2508.18847)
- Классика пост-калибровки классификаторов: Platt scaling и isotonic regression, сравнение в Niculescu-Mizil & Caruana, «Predicting good probabilities with supervised learning», ICML 2005 — [DOI 10.1145/1102351.1102430](https://doi.org/10.1145/1102351.1102430); ECE и temperature scaling: Guo et al., «On Calibration of Modern Neural Networks», ICML 2017 — [arXiv 1706.04599](https://arxiv.org/abs/1706.04599)
- В OpenAlex по запросу «LLM dunning email accounts receivable» нашлись только общие enterprise-agent бенчмарки (Argo-Bench 2026) — [DOI 10.48550/arxiv.2610.02122](https://doi.org/10.48550/arxiv.2610.02122). Это подтверждает отсутствие академической литературы по LLM именно в AR и коллекшне.

### Inferences
- Классификацию причины неоплаты стоит строить как набор атомарных бинарных вопросов («Клиент оспаривает качество или комплектность? да/нет», «Указан ли обещанный срок оплаты?», «Нет закрывающих документов (УПД, акт)?»). Это ровно формат калиброванной decision-модели (JEV). Финальная причина собирается правилами и иерархией из калиброванных вероятностей, и ECE измеряется по каждому атомарному вопросу.
- Генеративная LLM (GigaChat, YandexGPT, T-Pro, Qwen) не должна сама выдавать вероятности для решений: по Xiong et al. вербализованная уверенность переуверена. Вероятности берутся из калиброванной модели (JEV или классификатор плюс isotonic или temperature scaling), а LLM отвечает только за извлечение фактов с цитатой из источника и за драфт текста.
- Контроль галлюцинаций в письмах: письмо собирается из шаблона и проверенных полей (номер счёта, сумма, дата, срок — из учётной системы, не из генерации), LLM только перефразирует. Пост-проверка регулярками сверяет, что все суммы и даты в тексте совпадают с источником. Отправку подтверждает человек.

### Gaps
- Независимых измерений точности LLM на классификации B2B-споров и интентов писем (особенно на русском) не найдено, публичного датасета тоже. Придётся размечать свой (рекомендуемый минимум — Inferences в разделе 6).

---

## 4. Cash application: сопоставление платежей со счетами (в РФ — по «назначению платежа»)

### Takeaway
Индустриальный стандарт — 85–97% автоматического сопоставления (вендорские кейсы), но метрику нужно определять строго: header-level и invoice-level hit rate отличаются. Наука: NLP-ранжирование кандидатов хорошо работает для 1:1, слабее для 1:N. Графовые эмбеддинги (2025) улучшают 1:N.

### Cited Findings
- Munoz, Jalili, Tafakori, «Enhancing bookkeeper decision support through graph representation learning for bank reconciliation», Journal of Finance and Data Science, 2025. Существующие NLP-рекомендатели хороши для 1:1, но слабы для 1:N (частых у крупных компаний). Графовая система с реляционными данными и текстом превосходит индустриальные бенчмарки на 1:1 и надёжнее на 1:N. Предложен пост-процессинг «Top Boundary Ranking» для групповых совпадений — [DOI 10.1016/j.jfds.2025.100170](https://doi.org/10.1016/j.jfds.2025.100170)

### Inferences
- Для РФ задача заметно проще, чем для западного lockbox: в платёжном поручении есть ИНН/КПП плательщика, БИК и счёт, а «назначение платежа» обычно содержит номер и дату счёта или договора и сумму НДС. Каскад для MVP: (1) точное правило ИНН + номер счёта (regex по «сч.|счет|счёт|№|от dd.mm.yyyy») + сумма; (2) fuzzy-сопоставление (нормализация, расстояние Левенштейна или Jaro-Winkler по номерам, допуск по сумме для частичных оплат и комиссий); (3) задача о сумме подмножества для 1:N (один платёж закрывает несколько счетов, сумма = Σ открытых счетов клиента); (4) LLM или JEV только на остатке («к какому из этих 3 счетов относится платёж? выбор»), с подтверждением человеком.
- Метрики: invoice-level hit rate (доля платежей, автоматически и верно разнесённых до счёта), precision автоматического разнесения (ошибка дороже отказа), доля 1:N, решённых автоматически, время ручной обработки остатка.

### Gaps
- Российских публикаций или открытых бенчмарков по разбору «назначения платежа» не найдено. Значения точности для РФ нужно будет мерить самим (на выписках пилотных клиентов или синтетике).
- Числовые результаты Munoz et al. 2025 (точность 1:1 и 1:N) из аннотации не извлечены.

---

## 5. Российские LLM и on-prem: GigaChat, YandexGPT / Alice AI, T-Pro 2.x, Qwen3, Saiga, Vikhr — лицензии, железо, качество (MERA), стоимость

### Takeaway
Есть два пути. **Облако РФ** (GigaChat API: Lite 0,065 ₽, Pro 0,5 ₽, Max 0,65 ₽ за 1K токенов с НДС; Yandex AI Studio: YandexGPT Lite, Pro 5.1, Alice AI LLM, а также хостинг Qwen3 и gpt-oss). **On-prem с открытыми весами**: GigaChat 3 Lightning (10B MoE, 1,8B активных, MIT), T-Pro 2.0 (32B на базе Qwen3, Apache 2.0, MERA 0,66), YandexGPT 5 Lite 8B, Qwen3 (Apache 2.0). Для задач MVP (извлечение и драфт писем) достаточно моделей 8–32B на одной GPU-ноде.

### Cited Findings
**GigaChat (Сбер)**
- Тарифы API для юрлиц за 1 000 токенов с НДС, синхронно / асинхронно: GigaChat Lite 0,065 / 0,0325 ₽; Pro 0,5 / 0,25 ₽; Max 0,65 / 0,325 ₽. Эмбеддинги 0,014 / 0,007 ₽. Минимальный счёт 600 ₽ в месяц. Страница обновлена 7.10.2026; с 1.09.2026 новые клиенты СалютДевайсов оплачивают через cloud.ru — [developers.sber.ru](https://developers.sber.ru/docs/ru/gigachat/tariffs/legal-tariffs). Расхождение: в .md-версии той же страницы цены вдвое ниже (вероятно, это асинхронные) — [legal-tariffs.md](https://developers.sber.ru/docs/ru/gigachat/tariffs/legal-tariffs.md)
- Открытые веса GigaChat 3 под MIT с правом коммерческого использования: Ultra Preview (702B всего, 36B активных, MoE) и Lightning (10B всего, 1,8B активных). Ultra рассчитан на кластерные on-prem сценарии, Lightning — на локальный и high-load — [GitHub salute-developers/gigachat3](https://gh.r-mj.com/salute-developers/gigachat3); [HF model card GigaChat3-702B-A36B-preview (license: MIT)](https://huggingface.co/ai-sage/GigaChat3-702B-A36B-preview/blob/main/README.md); [Habr SberDevices](https://habr.com/ru/companies/sberdevices/articles/968904/)
- Упоминаются версии GigaChat 3.1 Ultra / Lightning и «GigaChat 3.5 Ultra». Официально не проверено, источники — Telegram и агрегаторы — [immers.cloud](https://en.immers.cloud/ai/sber-ai/gigachat3.1-10b-a1.8b/)

**YandexGPT / Alice AI (Яндекс)**
- Yandex AI Studio, синхронно, USD за 1K токенов без НДС (вход / выход): YandexGPT Lite 0,00164 / 0,00164; YandexGPT Pro 5.1 0,00656 / 0,00656; YandexGPT Pro 5 0,00984 / 0,00984; Alice AI LLM 0,0041 / 0,00984; Qwen3 235B 0,0041; gpt-oss-120b 0,00246; gpt-oss-20b 0,00082. Асинхронно примерно в 2 раза дешевле. Batch: Qwen3-8B 0,00082; Qwen3-32B 0,00336 (минимум 200K токенов). Дата на странице не указана — [Yandex AI Studio pricing](https://aistudio.yandex.ru/docs/en/ai-studio/pricing)
- По рублёвой странице: YandexGPT Pro 1,20 ₽ синхронно / 0,60 ₽ асинхронно; Lite 0,20 / 0,10 ₽ за 1K токенов (версия страницы без даты); YandexGPT 5.1 Pro около 0,80 ₽ (−33% к 5 Pro) — [Yandex Cloud pricing](https://yandex.cloud/ru/docs/foundation-models/pricing); [kod.ru](https://kod.ru/yandexgpt-5-1-business)
- Открытые веса: YandexGPT 5 Lite Pretrain, 8B, контекст 32K, обучение на ~15T токенов + 320B качественных, на Hugging Face (25.02.2025). YandexGPT 5 Pro закрыта (только облако и Алиса) — [kod.ru](https://kod.ru/yandexgpt-open-source-new-models)

**T-Pro 2.0 (Т-Банк / T-Tech)**
- Построена на Qwen3-32B с переработанным токенизатором: 34 тыс. редких не-кириллических токенов заменены кириллическими. Промежуточное дообучение на 40B токенов; гибридный reasoning (с рассуждением и без в одном чекпойнте); EAGLE speculative decoding. Лицензия Apache-2.0 на модель, EAGLE-веса и T-Math; корпус T-Wix под ODC-By. Веса t-tech/T-pro-it-2.0 — [arXiv 2512.10430](https://arxiv.org/html/2512.10430v1)
- MERA 0,66 против 0,582 у базового Qwen3 (по сводкам). Ru Arena Hard: 91,1 (reasoning) и 90,36 (non-reasoning) по статье, 0,876 по immers.cloud; приоритет у статьи — [emergentmind](https://www.emergentmind.com/papers/2512.10430); [immers.cloud](https://en.immers.cloud/ai/model/t-pro-2.0); [3DNews](https://3dnews.ru/1126183/tbank-predstavil-iimodel-tpro-20-s-gibridnimi-rassugdeniyami-kotoraya-vdvoe-ekonomnee-deepseek-r1distil/amp)

**MERA (бенчмарк для русского языка)**
- MERA (AI Alliance): исходно 21 задача, 10 навыков. MERA Text 2.0 добавил 12 приватных тестов (Human-Centric, Culture-Specific, Agentic, Reasoning); MERA Reason запущен 24.07.2026; есть SWE-MERA для кода — [mera.a-ai.ru](https://mera.a-ai.ru/en/text); [arXiv 2401.04531](https://arxiv.org/html/2401.04531v3)

**Qwen3, Saiga, Vikhr**
- Qwen3 хостится в Yandex AI Studio (8B, 32B, 235B) — [Yandex AI Studio pricing](https://aistudio.yandex.ru/docs/en/ai-studio/pricing); технический отчёт Qwen3 — [arXiv 2505.09388](https://arxiv.org/abs/2505.09388)
- Saiga (И. Гусев) — семейство русскоязычных дообученных open-моделей — [HF IlyaGusev](https://huggingface.co/IlyaGusev); Vikhr — двуязычная open-модель для русского — [arXiv 2405.13929](https://arxiv.org/abs/2405.13929). Актуальность версий в этой сессии не проверялась.

### Inferences
- Грубая оценка стоимости (вывод автора): одно письмо ≈ 1,5–3K токенов (контекст + ответ) → на GigaChat Pro ≈ 0,75–1,5 ₽, на Lite ≈ 0,1–0,2 ₽. Для SME с 200 письмами в месяц это десятки или сотни рублей, то есть стоимость LLM не ограничивает unit-экономику. Ограничения — требования банка к данным (152-ФЗ, банковская тайна) и on-prem.
- Рекомендуемый стек «on-prem-ready»: T-Pro 2.0 (32B, Apache 2.0) или Qwen3-32B для драфтов и извлечения на одной GPU 80 ГБ в FP8 или INT8 (оценка автора, не замер). GigaChat 3 Lightning (1,8B активных) или YandexGPT 5 Lite 8B для дешёвой классификации и маршрутизации. В облаке для демо — GigaChat API (Pro / Max), что естественно для банковского жюри. Абстракция провайдера (OpenAI-совместимый интерфейс через vLLM) позволяет переключаться без переписывания.
- На защите стоит показать сравнение 2–3 моделей на своём размеченном наборе писем (F1 по извлечению фактов, доля галлюцинированных сумм и дат, оценка писем асессорами), а не ссылаться только на MERA: MERA не измеряет деловую переписку о дебиторке.

### Gaps
- Актуальная таблица MERA 2026 (баллы GigaChat 2 Max, YandexGPT 5.1 Pro, Alice AI, Qwen3, T-Pro 2.x) не извлечена: лидерборд рендерится динамически. Нужно снять скриншот вручную с mera.a-ai.ru.
- Официальные требования к железу для on-prem GigaChat (коммерческая корпоративная версия, не open weights) и YandexGPT on-prem в открытых источниках не найдены.
- Лицензия YandexGPT 5 Lite (в источнике не названа) и существование T-Pro 2.1 или более поздних версий не проверены.

---

## 6. Рекомендованная архитектура ML-пайплайна MVP и метрики оценки (синтез)

### Takeaway
Гибридный пайплайн: «правила → калиброванная decision-модель (JEV) на атомарных вопросах → предиктивная модель (бустинг + survival) → политика NBA (правила, затем uplift/бандит) → LLM только для извлечения с цитатами и драфтов писем, письмо подтверждает человек». Это отвечает требованию жюри «AI только там, где помогает» и измеряется метриками с доказанной методологией.

### Cited Findings
- Бустинг и RF на поведенческих агрегатах — лучший класс моделей для прогноза оплаты: 81–85% accuracy против baseline 54,5% — [arXiv 2008.07363](https://ar5iv.arxiv.org/html/2008.07363)
- Survival-подход (RSF) превосходит Cox для времени оплаты; ансамбль survival + ML предложен как фреймворк — [arXiv 2008.07363](https://ar5iv.arxiv.org/html/2008.07363); [DOI 10.1016/j.mlwa.2024.100578](https://doi.org/10.1016/j.mlwa.2024.100578)
- Вербализованная уверенность LLM переуверена, поэтому вероятности нужны от калиброванных моделей — [arXiv 2306.13063](https://arxiv.org/abs/2306.13063v2); калибровка Platt / isotonic / temperature — [DOI 10.1145/1102351.1102430](https://doi.org/10.1145/1102351.1102430); [arXiv 1706.04599](https://arxiv.org/abs/1706.04599)
- Формулировка напоминания даёт +2–5 п.п. к доле оплат (RCT HMRC), а длинные письма теряют эффект — [Floyd et al.](https://s3.amazonaws.com/fieldexperiments-papers2/papers/00750.pdf)
- Constrained MDP / RL — путь для оптимизации действий в масштабе — [DOI 10.1145/1835804.1835817](https://doi.org/10.1145/1835804.1835817)

### Inferences
**Архитектура (по модулям)**
1. **Ингест**: счета, акты и УПД из 1С или ЭДО; банковская выписка (1С-формат / API ВТБ); переписка (e-mail, мессенджер). Нормализация, ИНН как ключ контрагента.
2. **(e) Сверка платежей**: каскад «точное правило (ИНН + № счёта + сумма) → fuzzy (номер и дата из назначения, допуск по сумме) → subset-sum для 1:N → JEV choice-вопрос по топ-3 кандидатам → человек». Автоматически разносится только при уверенности ≥ порога, подобранного на валидации под precision ≥ 99%.
3. **(a) Причина неоплаты**: правила по фактам из учёта (нет подписанного УПД → «документы»; срок не наступил → «не просрочено»; частичная оплата → «частичная») плюс JEV на атомарных вопросах к письмам («оспаривает качество?», «просит отсрочку?», «указан срок оплаты? [дата]», «нет денег / кассовый разрыв?», «счёт не получен / не тот реквизит?», «согласование у руководства?»). LLM (GigaChat / T-Pro / Qwen) извлекает дату обещания и цитату-обоснование (span из письма); без цитаты ответ отбрасывается.
4. **(b) Прогноз**: CatBoost или LightGBM для P(оплата в срок) и P(оплата ≤ срок + 30 дн.), калибровка isotonic. Дискретно-временная hazard-модель или RSF для ожидаемой задержки и распределения даты оплаты. Признаки: история плательщика (последние 3–5 счетов, средняя и std задержки, открытая просрочка, тренд), атрибуты счёта (сумма относительно медианы клиента, отсрочка, конец месяца или квартала), признаки причины из шага 3 (например, «спор открыт»), внешние (ОКВЭД, возраст ИНН, арбитраж) — для cold start.
5. **(c) NBA**: на старте детерминированная матрица «причина × риск × дни до или после срока × сумма → действие (ничего / мягкое напоминание / звонок / досудебная претензия / отправить документы / предложить рассрочку)». Каждое действие логируется; 10–20% решений рандомизируются (exploration) для будущей uplift-модели или контекстного бандита.
6. **(d) Письма**: шаблон с элементами, доказанными в RCT (конкретная сумма, срок, простое действие, последствия), LLM только адаптирует тон и контекст. Пост-валидатор сверяет все суммы, номера и даты с учётом; отправка — по кнопке пользователя (human-in-the-loop).

**Метрики качества (что показывать жюри)**
- Классификация причин: precision, recall и F1 по каждой причине плюс macro-F1; confusion matrix; отдельно recall для «спора» (самая дорогая ошибка). Тест-сет ≥ 300–500 размеченных писем, двойная разметка, Cohen's κ между разметчиками как потолок качества (рекомендация автора).
- Калибровка: ECE (10–15 бинов) и Brier score для каждого атомарного JEV-вопроса и для P(оплата в срок); reliability diagram; сравнение до и после isotonic.
- Прогноз оплаты: ROC-AUC и PR-AUC для «просрочка > 5 дней» (как у IBM); MAE и медианная AE дней до оплаты на оплаченных счетах; C-index и интегральный Brier для survival; бэктест с temporal split (train в прошлом, test в будущем); baseline «как платил в прошлый раз» обязателен.
- Сверка: invoice-level hit rate, precision автоматического разнесения, доля ручных разборов, доля 1:N, закрытых автоматически.
- Письма: доля писем без фактических ошибок (автопроверка + асессоры), оценка тона по шкале 1–5, доля отправленных без правок.
- Бизнес-эффект (A/B): рандомизация на уровне контрагента-плательщика (не счёта, чтобы избежать контаминации), страты по риску и сумме. Первичная метрика — доля счетов, оплаченных к сроку + 7 дней, или средний DSO / средняя задержка по когорте выставленных счетов; вторичные — сумма просрочки > 30 дней и нагрузка на пользователя. Мощность: по аналогии с HMRC (детектируемый эффект ~1,5 п.п. при группах ~7,5 тыс.) для SME-пилота с сотнями контрагентов реалистично детектировать только крупные эффекты (≥ 8–10 п.п.). Это стоит честно заявить и использовать последовательный (sequential) или байесовский анализ. Расчёт мощности — вывод автора, не из источника.

### Gaps
- Нет реальных данных российских SME для оценки ожидаемых значений AUC, MAE и hit rate. Целевые пороги MVP нужно установить после пилота.
- Внутренние метрики калибровки JEV (TypeSafe, System One API) в публичных источниках не найдены. Их нужно измерить самостоятельно на своём тест-сете.

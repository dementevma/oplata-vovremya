"""Честная оценка: что на самом деле доказывают наши цифры качества, а что нет.

Запуск: python -m pipeline.honest_eval   (сеть и ключи не нужны: ответы Jev уже лежат в web/data/eval.json)
Результат: web/data/honest_eval.json, его показывает экран «Качество ИИ».

1. Причина по письму (Jev). 42/42 — это не «100% точности»: на 42 письмах точный 95% доверительный интервал
   начинается с ~92%. Ниже — что можно сказать честно и сколько реальных писем нужно для вывода.
2. Обучаемый бейзлайн (TF-IDF по символам + логистическая регрессия). Учим на письмах одного источника,
   проверяем на другом: так видно, насколько метрика зависит от того, что тест похож на обучение.
3. Прогноз оплаты. Модель обучена на истории из нашего же генератора. Сравниваем её AUC с потолком —
   AUC истинной вероятности из генератора — и проверяем ту же модель в «другом мире» с иными допущениями.
"""
import json
import math

import numpy as np
from scipy.stats import binomtest
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, f1_score, roc_auc_score
from sklearn.metrics.pairwise import cosine_similarity
from sklearn.model_selection import StratifiedKFold, cross_val_predict
from sklearn.pipeline import make_pipeline

from pipeline import forecast as F
from pipeline.clients import ROOT


def ci(k: int, n: int) -> dict:
    lo, hi = binomtest(k, n).proportion_ci(confidence_level=0.95, method="exact")
    return {"k": k, "n": n, "acc": round(k / n, 3), "lo": round(lo, 3), "hi": round(hi, 3)}


def sample_size(p=0.85, margin=0.05) -> int:
    """Сколько размеченных писем нужно, чтобы точность ~p измерить с погрешностью ±margin (95%)."""
    return math.ceil(1.96 ** 2 * p * (1 - p) / margin ** 2)


def baseline():
    return make_pipeline(TfidfVectorizer(analyzer="char_wb", ngram_range=(2, 5), sublinear_tf=True, min_df=1),
                         LogisticRegression(max_iter=3000, C=10, class_weight="balanced"))


def causes_eval():
    rows = [r for r in json.loads((ROOT / "web/data/eval.json").read_text(encoding="utf-8"))["rows"] if not r.get("excluded")]
    by = {s: [r for r in rows if r["source"] == s] for s in ("hand", "gigachat")}
    jev = {s: ci(sum(r["jev"]["pred"] == r["label"] for r in rs), len(rs)) for s, rs in by.items()}
    jev["all"] = ci(sum(r["jev"]["pred"] == r["label"] for r in rows), len(rows))
    conf = [max(r["jev"]["p"].values()) for r in rows]

    texts, labels = [r["text"] for r in rows], [r["label"] for r in rows]
    cv = StratifiedKFold(n_splits=3, shuffle=True, random_state=0)
    pred_cv = cross_val_predict(baseline(), texts, labels, cv=cv)
    cross = {}
    for train_src, test_src in (("gigachat", "hand"), ("hand", "gigachat")):
        tr, te = by[train_src], by[test_src]
        pred = baseline().fit([r["text"] for r in tr], [r["label"] for r in tr]).predict([r["text"] for r in te])
        gold = [r["label"] for r in te]
        cross[f"{train_src}->{test_src}"] = {**ci(int(accuracy_score(gold, pred, normalize=False)), len(te)),
                                             "macro_f1": round(f1_score(gold, pred, average="macro"), 3)}

    vec = TfidfVectorizer(analyzer="char_wb", ngram_range=(2, 5)).fit(texts)
    sim = cosine_similarity(vec.transform([r["text"] for r in by["hand"]]), vec.transform([r["text"] for r in by["gigachat"]]))
    return {
        "jev": jev,
        "jev_confident_share": round(float(np.mean(np.array(conf) >= 0.99)), 3),
        "jev_errors": jev["all"]["n"] - jev["all"]["k"],
        "baseline_cv": {**ci(int(accuracy_score(labels, pred_cv, normalize=False)), len(rows)),
                        "macro_f1": round(f1_score(labels, pred_cv, average="macro"), 3)},
        "baseline_cross": cross,
        "max_similarity_hand_gigachat": round(float(sim.max()), 3),
        "need_letters": sample_size(),
    }


def forecast_eval():
    X, paid, _, p_true = F.generate_history(truth=True)
    n = int(len(X) * 0.75)
    clf = LogisticRegression(max_iter=2000).fit(X[:n], paid[:n])
    auc_model = roc_auc_score(paid[n:], clf.predict_proba(X[n:])[:, 1])
    auc_ceiling = roc_auc_score(paid[n:], p_true[n:])
    auc_one_feature = roc_auc_score(paid[n:], -X[n:, F.FEATURES.index("late_share")])

    # «Другой мир»: другие доли неоплаты по причинам и другая сила признаков. Модель та же, обученная выше.
    other_gen = {"documents": (6, 0.10), "dispute": (18, 0.05), "liquidity": (35, 0.12), "approval": (7, 0.15),
                 "details": (3, 0.08), "silence": (14, 0.30), "paid": (1, 0.0), "none": (5, 0.10)}
    Xo, paid_o, _, p_true_o = F.generate_history(seed=8, gen=other_gen, truth=True,
                                                 effects={"late_share": 0.5, "insolvency": 0.3, "promise": 0.2})
    auc_shift = roc_auc_score(paid_o, clf.predict_proba(Xo)[:, 1])
    auc_shift_ceiling = roc_auc_score(paid_o, p_true_o)
    calib_shift = float(abs(clf.predict_proba(Xo)[:, 1].mean() - paid_o.mean()))
    return {
        "auc_model": round(auc_model, 3), "auc_ceiling": round(auc_ceiling, 3), "auc_one_feature": round(auc_one_feature, 3),
        "auc_other_world": round(auc_shift, 3), "auc_other_world_ceiling": round(auc_shift_ceiling, 3),
        "mean_prob_error_other_world": round(calib_shift, 3),
    }


def main():
    out = {"causes": causes_eval(), "forecast": forecast_eval()}
    path = ROOT / "web" / "data" / "honest_eval.json"
    path.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    return out


if __name__ == "__main__":
    print(json.dumps(main(), ensure_ascii=False, indent=1))

"""Прогноз оплаты счёта: вероятность, что клиент вообще заплатит, и распределение срока оплаты.

Модель из двух частей (cure-модель выживаемости):
  1) P(оплатит в течение 120 дней) — логистическая регрессия;
  2) срок оплаты при условии оплаты — логнормальная AFT-модель: ln(дни от сегодня) = w·x + ε, ε ~ N(0, σ).
Обе части линейные, поэтому веса выгружаются в JSON и считаются прямо в браузере (web/js/forecast.js).

ВАЖНО: обучено на СИНТЕТИЧЕСКОЙ истории (generate_history). Синтетика задаёт правдоподобные зависимости
по литературе (поведение плательщика важнее свойств счёта: Appel et al. 2019, Hovanesyan 2019), но численное
качество на ней не является доказательством. В пилоте модель переобучается на выписке и реестре клиента.
"""
import json
import math

import numpy as np
from sklearn.linear_model import LinearRegression, LogisticRegression
from sklearn.metrics import brier_score_loss, mean_absolute_error, roc_auc_score

from pipeline.causes import CAUSES
from pipeline.clients import ROOT

CAUSE_KEYS = list(CAUSES) + ["none"]
# Параметры генератора: медиана дней до оплаты после диагностики и вероятность неоплаты, по причинам.
# Это допущения команды для демонстрации, а не измерения.
GEN = {
    "documents": (6, 0.03), "dispute": (18, 0.12), "liquidity": (35, 0.35), "approval": (7, 0.02),
    "details": (3, 0.01), "silence": (14, 0.10), "paid": (1, 0.0), "none": (5, 0.03),
}
FEATURES = ["late_share", "avg_delay_log", "days_overdue_log", "amount_log", "promise", "fixable", "insolvency",
            "registry_risk"] + [f"cause_{k}" for k in CAUSE_KEYS]


def featurize(late_share, avg_delay, days_overdue, amount, promise, fixable, insolvency, registry_risk, cause):
    x = {
        "late_share": late_share, "avg_delay_log": math.log1p(avg_delay), "days_overdue_log": math.log1p(max(days_overdue, 0)),
        "amount_log": math.log10(max(amount, 1000)) - 5, "promise": promise, "fixable": fixable, "insolvency": insolvency,
        "registry_risk": registry_risk,
    }
    for k in CAUSE_KEYS:
        x[f"cause_{k}"] = 1.0 if cause == k else 0.0
    return [x[f] for f in FEATURES]


# Сила влияния признаков на неоплату в генераторе: тоже допущения команды.
EFFECTS = {"late_share": 2.0, "registry_risk": 1.2, "insolvency": 1.0, "days_overdue": 0.012, "promise": -0.6}


def generate_history(n=6000, seed=7, gen=None, effects=None, truth=False):
    """Синтетическая история счетов. gen и effects задают «мир»; truth=True дополнительно возвращает
    истинную вероятность оплаты из генератора — потолок, выше которого никакая модель на этих данных не поднимется."""
    gen, e = gen or GEN, {**EFFECTS, **(effects or {})}
    rng = np.random.default_rng(seed)
    X, paid, days, p_true = [], [], [], []
    shares = np.array([0.18, 0.13, 0.15, 0.14, 0.05, 0.20, 0.07, 0.08])  # documents..none
    for _ in range(n):
        cause = rng.choice(CAUSE_KEYS, p=shares / shares.sum())
        late_share = float(np.clip(rng.beta(2, 4), 0, 1))
        avg_delay = float(rng.gamma(2, 5) * (0.5 + late_share))
        days_overdue = float(rng.integers(0, 60))
        amount = float(10 ** rng.uniform(4, 6.3))
        registry_risk = float(rng.random() < (0.35 if cause == "liquidity" else 0.06))
        promise = float(rng.random() < {"approval": 0.7, "documents": 0.5, "liquidity": 0.25}.get(cause, 0.15))
        fixable = float(CAUSES.get(cause, {}).get("fixable", True))
        insolvency = float(rng.random() < (0.55 if cause == "liquidity" else 0.03))
        med, p_default = gen[cause]
        logit_default = math.log(p_default / (1 - p_default) + 1e-6) + e["late_share"] * late_share + e["registry_risk"] * registry_risk \
            + e["insolvency"] * insolvency + e["days_overdue"] * days_overdue + e["promise"] * promise
        p_def = 1 / (1 + math.exp(-logit_default))
        will_pay = rng.random() > p_def
        mu = math.log(med) + 0.8 * late_share + 0.25 * math.log1p(avg_delay) + 0.15 * (math.log10(amount) - 5) \
            - 0.35 * promise + 0.4 * insolvency + 0.3 * registry_risk
        d = float(np.exp(mu + rng.normal(0, 0.55)))
        X.append(featurize(late_share, avg_delay, days_overdue, amount, promise, fixable, insolvency, registry_risk, cause))
        paid.append(will_pay and d <= 120)
        days.append(min(d, 120))
        p_true.append((1 - p_def) * 0.5 * (1 + math.erf((math.log(120) - mu) / (0.55 * math.sqrt(2)))))
    if truth:
        return np.array(X), np.array(paid), np.array(days), np.array(p_true)
    return np.array(X), np.array(paid), np.array(days)


def train():
    X, paid, days = generate_history()
    n_train = int(len(X) * 0.75)
    clf = LogisticRegression(max_iter=2000, C=1.0).fit(X[:n_train], paid[:n_train])
    p = clf.predict_proba(X[n_train:])[:, 1]
    m = paid
    reg = LinearRegression().fit(X[:n_train][m[:n_train]], np.log(days[:n_train][m[:n_train]]))
    resid = np.log(days[:n_train][m[:n_train]]) - reg.predict(X[:n_train][m[:n_train]])
    sigma = float(resid.std())
    test_mask = m[n_train:]
    pred_days = np.exp(reg.predict(X[n_train:][test_mask]))
    # калибровка по децилям
    bins = np.quantile(p, np.linspace(0, 1, 11))
    idx = np.clip(np.digitize(p, bins[1:-1]), 0, 9)
    calib = [{"pred": float(p[idx == b].mean()), "obs": float(paid[n_train:][idx == b].mean()), "n": int((idx == b).sum())} for b in range(10)]
    ece = sum(c["n"] * abs(c["pred"] - c["obs"]) for c in calib) / len(p)
    metrics = {
        "train_rows": n_train, "test_rows": len(X) - n_train,
        "auc_pay": round(float(roc_auc_score(paid[n_train:], p)), 3),
        "brier_pay": round(float(brier_score_loss(paid[n_train:], p)), 3),
        "ece_pay": round(float(ece), 3),
        "mae_days": round(float(mean_absolute_error(days[n_train:][test_mask], pred_days)), 1),
        "median_abs_err_days": round(float(np.median(np.abs(days[n_train:][test_mask] - pred_days))), 1),
        "calibration": calib,
        "note": "Синтетическая история: метрики показывают работу конвейера, а не качество на реальных данных.",
    }
    model = {
        "features": FEATURES,
        "pay": {"coef": clf.coef_[0].round(5).tolist(), "intercept": round(float(clf.intercept_[0]), 5)},
        "days": {"coef": reg.coef_.round(5).tolist(), "intercept": round(float(reg.intercept_), 5), "sigma": round(sigma, 4)},
        "metrics": metrics,
    }
    out = ROOT / "web" / "data" / "forecast_model.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(model, ensure_ascii=False, indent=1), encoding="utf-8")
    return model


if __name__ == "__main__":
    m = train()
    print({k: v for k, v in m["metrics"].items() if k != "calibration"})

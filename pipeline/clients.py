"""Клиенты внешних моделей: Jev (TypeSafe System One API) и GigaChat.

Ключи читаются из переменных окружения или файла .env в корне репозитория (.env в git не попадает).
Каждый ответ кэшируется на диск по хэшу запроса: повторная сборка демо не тратит квоту
и даёт воспроизводимый результат.
"""
from __future__ import annotations

import hashlib
import threading
import json
import os
import time
import uuid
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "pipeline" / "cache"


def load_env() -> dict:
    env = dict(os.environ)
    f = ROOT / ".env"
    if f.exists():
        for line in f.read_text(encoding="utf-8").splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                k, v = line.split("=", 1)
                env.setdefault(k.strip(), v.strip())
    return env


ENV = load_env()


def gigachat_verify():
    """Проверка TLS для GigaChat. Сертификаты Сбера выпущены НУЦ Минцифры, которого нет в стандартном наборе:
    укажите путь к russian_trusted_root_ca.pem в GIGACHAT_CA_BUNDLE. Отключить проверку можно только явно
    (GIGACHAT_INSECURE_TLS=1) и только для локальной разработки."""
    if ENV.get("GIGACHAT_INSECURE_TLS") == "1":
        return False
    return ENV.get("GIGACHAT_CA_BUNDLE") or True


def _cached(kind: str, payload: dict, fn):
    CACHE.mkdir(parents=True, exist_ok=True)
    key = hashlib.sha1(json.dumps(payload, ensure_ascii=False, sort_keys=True).encode()).hexdigest()
    path = CACHE / f"{kind}_{key}.json"
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    out = fn()
    path.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    return out


class Jev:
    """Калиброванная decision-модель: отвечает вероятностями на атомарные вопросы о тексте.

    Типы вопросов: noul (да/нет → вероятность), choice (один из вариантов → распределение),
    score (уровень по шкале → распределение по уровням).
    """

    def __init__(self, model: str | None = None):
        self.key = ENV.get("TYPESAFE_API_KEY", "")
        self.base = ENV.get("TYPESAFE_BASE_URL", "https://api.typesafe.ai").rstrip("/")
        self.model = model or ENV.get("JEV_MODEL", "jev-1.13.0")
        self.available = bool(self.key)
        self.calls = 0
        self.ms = 0

    def ask(self, state: str, questions: dict) -> dict:
        payload = {"state": state, "model": self.model, "questions": questions}

        def call():
            if not self.available:
                raise RuntimeError("TYPESAFE_API_KEY не задан: Jev недоступна")
            last = ""
            for attempt in range(4):
                t = time.perf_counter()
                try:
                    r = httpx.post(self.base + "/v1/systemone", json=payload, timeout=90,
                                   headers={"Authorization": f"Bearer {self.key}"})
                    if r.status_code == 429 or r.status_code >= 500:
                        raise httpx.HTTPStatusError(f"HTTP {r.status_code}", request=r.request, response=r)
                    r.raise_for_status()
                    self.calls += 1
                    self.ms += int((time.perf_counter() - t) * 1000)
                    data = r.json()
                    data["latency_ms"] = int((time.perf_counter() - t) * 1000)
                    return data
                except (httpx.HTTPError, ValueError) as e:
                    last = f"{type(e).__name__}: {e}"
                    time.sleep(1.5 * (attempt + 1))
            raise RuntimeError(last)

        return _cached("jev", payload, call)


class GigaChat:
    """GigaChat (Сбер) — российская генеративная модель для черновиков писем и извлечения дат.

    В контуре банка заменяется on-prem моделью с OpenAI-совместимым API (GigaChat on-prem, T-Pro, Qwen3):
    код вызова тот же, меняется только адрес и ключ.
    """

    def __init__(self):
        self.auth = ENV.get("GIGACHAT_AUTH_KEY", "")
        self.model = ENV.get("GIGACHAT_MODEL", "GigaChat-2")
        self.scope = ENV.get("GIGACHAT_SCOPE", "GIGACHAT_API_PERS")
        self.available = bool(self.auth)
        self._token = None
        self._exp = 0
        self._lock = threading.Lock()  # у персонального ключа GigaChat лимит — 1 одновременный запрос

    def _tok(self):
        if self._token and time.time() < self._exp - 60:
            return self._token
        r = httpx.post("https://ngw.devices.sberbank.ru:9443/api/v2/oauth", verify=gigachat_verify(), timeout=30,
                       headers={"Authorization": "Basic " + self.auth, "RqUID": str(uuid.uuid4()),
                                "Content-Type": "application/x-www-form-urlencoded"},
                       data={"scope": self.scope})
        r.raise_for_status()
        d = r.json()
        self._token, self._exp = d["access_token"], d["expires_at"] / 1000
        return self._token

    def chat(self, system: str, user: str, temperature: float = 0.2, max_tokens: int = 700) -> str:
        payload = {"model": self.model, "system": system, "user": user, "t": temperature}

        def call():
            if not self.available:
                raise RuntimeError("GIGACHAT_AUTH_KEY не задан")
            for attempt in range(4):
                try:
                    r = httpx.post("https://gigachat.devices.sberbank.ru/api/v1/chat/completions", verify=gigachat_verify(), timeout=120,
                                   headers={"Authorization": "Bearer " + self._tok()},
                                   json={"model": self.model, "temperature": temperature, "max_tokens": max_tokens,
                                         "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}]})
                    if r.status_code == 429 or r.status_code >= 500:
                        time.sleep(3 * (attempt + 1))
                        continue
                    r.raise_for_status()
                    return {"text": r.json()["choices"][0]["message"]["content"].strip(), "model": self.model}
                except httpx.HTTPError as e:
                    last = f"{type(e).__name__}: {e}"
                    time.sleep(3 * (attempt + 1))
                    continue
            raise RuntimeError("GigaChat не ответил: " + locals().get("last", "429/5xx"))

        with self._lock:
            return _cached("giga", payload, call)["text"]


class OpenAICompat:
    """On-prem генеративная модель в контуре банка: любой OpenAI-совместимый сервер (vLLM, TGI) с T-Pro, Qwen3
    или GigaChat on-prem. Включается переменными OPENAI_BASE_URL и OPENAI_MODEL; интерфейс тот же, что у GigaChat."""

    def __init__(self):
        self.base = ENV.get("OPENAI_BASE_URL", "").rstrip("/")
        self.model = ENV.get("OPENAI_MODEL", "")
        self.key = ENV.get("OPENAI_API_KEY", "")
        self.available = bool(self.base and self.model)

    def chat(self, system: str, user: str, temperature: float = 0.2, max_tokens: int = 700) -> str:
        payload = {"model": self.model, "base": self.base, "system": system, "user": user, "t": temperature}

        def call():
            if not self.available:
                raise RuntimeError("OPENAI_BASE_URL и OPENAI_MODEL не заданы")
            last = ""
            for attempt in range(3):
                try:
                    r = httpx.post(self.base + "/chat/completions", timeout=120,
                                   headers={"Authorization": "Bearer " + self.key} if self.key else {},
                                   json={"model": self.model, "temperature": temperature, "max_tokens": max_tokens,
                                         "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}]})
                    if r.status_code == 429 or r.status_code >= 500:
                        raise httpx.HTTPStatusError(f"HTTP {r.status_code}", request=r.request, response=r)
                    r.raise_for_status()
                    return {"text": r.json()["choices"][0]["message"]["content"].strip(), "model": self.model}
                except (httpx.HTTPError, KeyError, ValueError) as e:
                    last = f"{type(e).__name__}: {e}"
                    time.sleep(2 * (attempt + 1))
            raise RuntimeError("LLM не ответила: " + last)

        return _cached("llm", payload, call)["text"]


def letter_llm():
    """Генеративная модель для писем: on-prem, если задан OPENAI_BASE_URL, иначе облачный GigaChat."""
    on_prem = OpenAICompat()
    return on_prem if on_prem.available else GigaChat()

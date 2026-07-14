import json
import os
from dataclasses import dataclass
from typing import Any
import urllib.error
import urllib.request


@dataclass(frozen=True)
class ProviderPreset:
    api_key_env: str
    api_url_env: str
    model_env: str
    timeout_env: str
    default_api_url: str
    default_model: str
    auth_header: str
    bearer_auth: bool
    max_tokens_field: str


PROVIDER_PRESETS = {
    "openrouter": ProviderPreset(
        api_key_env="OPENROUTER_API_KEY",
        api_url_env="OPENROUTER_API_URL",
        model_env="OPENROUTER_MODEL",
        timeout_env="OPENROUTER_TIMEOUT_SECONDS",
        default_api_url="https://openrouter.ai/api/v1/chat/completions",
        default_model="openrouter/free",
        auth_header="Authorization",
        bearer_auth=True,
        max_tokens_field="max_tokens",
    ),
    "mimo": ProviderPreset(
        api_key_env="MIMO_API_KEY",
        api_url_env="MIMO_API_URL",
        model_env="MIMO_MODEL",
        timeout_env="MIMO_TIMEOUT_SECONDS",
        default_api_url="https://api.xiaomimimo.com/v1/chat/completions",
        default_model="mimo-v2.5",
        auth_header="api-key",
        bearer_auth=False,
        max_tokens_field="max_completion_tokens",
    ),
}


class ModelApiError(RuntimeError):
    pass


class OpenAICompatibleClient:
    def __init__(self, provider: str) -> None:
        try:
            preset = PROVIDER_PRESETS[provider]
        except KeyError as error:
            supported = ", ".join(PROVIDER_PRESETS)
            raise ModelApiError(
                f"unsupported LLM provider {provider!r}; choose one of: {supported}"
            ) from error

        api_key = os.environ.get("LLM_API_KEY") or os.environ.get(
            preset.api_key_env
        )
        if not api_key:
            raise ModelApiError(
                f"{preset.api_key_env} or LLM_API_KEY is required for provider {provider}"
            )

        timeout_value = (
            os.environ.get("LLM_TIMEOUT_SECONDS")
            or os.environ.get(preset.timeout_env)
            or "60"
        )
        try:
            timeout_seconds = float(timeout_value)
        except ValueError as error:
            raise ModelApiError("LLM timeout must be a number") from error
        if timeout_seconds <= 0:
            raise ModelApiError("LLM timeout must be greater than zero")

        self.provider = provider
        self.api_key = api_key
        self.api_url = (
            os.environ.get("LLM_API_URL")
            or os.environ.get(preset.api_url_env)
            or preset.default_api_url
        )
        self.model = (
            os.environ.get("LLM_MODEL")
            or os.environ.get(preset.model_env)
            or preset.default_model
        )
        self.timeout_seconds = timeout_seconds
        self._preset = preset

    def _headers(self) -> dict[str, str]:
        credential = self.api_key
        if self._preset.bearer_auth:
            credential = f"Bearer {credential}"
        return {
            self._preset.auth_header: credential,
            "Content-Type": "application/json",
        }

    def _payload(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]],
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            "tools": tools,
            "tool_choice": "auto",
            self._preset.max_tokens_field: 1024,
            "stream": False,
        }
        if self.provider == "mimo":
            thinking = os.environ.get("MIMO_THINKING", "disabled")
            if thinking not in {"disabled", "enabled"}:
                raise ModelApiError(
                    "MIMO_THINKING must be either 'disabled' or 'enabled'"
                )
            payload["thinking"] = {"type": thinking}
        return payload

    def complete(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]],
    ) -> dict[str, Any]:
        payload = self._payload(messages, tools)
        request = urllib.request.Request(
            self.api_url,
            data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            headers=self._headers(),
            method="POST",
        )

        try:
            with urllib.request.urlopen(
                request, timeout=self.timeout_seconds
            ) as response:
                response_body = response.read().decode("utf-8")
        except urllib.error.HTTPError as error:
            body = error.read().decode("utf-8", errors="replace")[:2_000]
            raise ModelApiError(
                f"{self.provider} API returned HTTP {error.code}: {body}"
            ) from error
        except urllib.error.URLError as error:
            raise ModelApiError(
                f"failed to reach {self.provider} API: {error.reason}"
            ) from error

        try:
            response_json = json.loads(response_body)
            return response_json["choices"][0]["message"]
        except (json.JSONDecodeError, KeyError, IndexError, TypeError) as error:
            raise ModelApiError(
                f"{self.provider} API returned an unexpected response: "
                f"{response_body[:2_000]}"
            ) from error

"""
app/services/openai_failover.py
-------------------------------
A drop-in replacement for OpenAI and AsyncOpenAI clients that includes
failover logic across multiple API keys/providers.
"""

import logging
import os

from openai import (
    APIError,
    AsyncOpenAI,
    AuthenticationError,
    OpenAI,
    RateLimitError,
)

from app.config import settings

logger = logging.getLogger(__name__)

env_key = (
    os.getenv("OPENAI_API_KEY")
    or settings.OPENAI_API_KEY.get_secret_value()
    or os.getenv("MINIMAX_API_KEY")
    or settings.MINIMAX_API_KEY.get_secret_value()
)
env_base_url = (
    os.getenv("OPENAI_BASE_URL")
    or settings.OPENAI_BASE_URL
    or os.getenv("MINIMAX_BASE_URL")
    or settings.MINIMAX_BASE_URL
)
env_model = (
    os.getenv("OPENAI_PREMIUM_MODEL")
    or os.getenv("OPENAI_MODEL")
    or settings.OPENAI_PREMIUM_MODEL
    or settings.OPENAI_MODEL
    or settings.LLM_MODEL
)

env_provider = None
if env_key:
    env_provider = {
        "id": env_model or None,
        "base_url": env_base_url,
        "api_key": env_key,
    }

# opensamga round-3 (2026-05-15) audit removed the third-party URL
# defaults that previously baked `https://zjuapi.com/v1/` and
# `https://coding.dashscope.aliyuncs.com/v1` into the failover slots.
# A deployer who set only `FAILOVER_MODEL_N_KEY` (a real OpenAI key,
# say) would silently route their traffic to those hosts. Now both URL
# and key MUST be set explicitly, or the slot is dropped.
DEFAULT_FAILOVER_MODELS = []
for _slot in (1, 2, 3):
    _id = os.getenv(f"FAILOVER_MODEL_{_slot}_ID", "")
    _url = os.getenv(f"FAILOVER_MODEL_{_slot}_URL", "")
    _key = os.getenv(f"FAILOVER_MODEL_{_slot}_KEY", "")
    if _id and _url and _key:
        DEFAULT_FAILOVER_MODELS.append({"id": _id, "base_url": _url, "api_key": _key})
    elif _key and not _url:
        # Loud warning: the most likely misconfiguration is a key set with
        # no URL. Don't pick a default — it would silently exfiltrate the
        # key to whatever URL we happened to pick.
        logger.warning(
            "FAILOVER_MODEL_%d_KEY is set but FAILOVER_MODEL_%d_URL is empty; "
            "slot ignored. Set both URL and ID explicitly to enable failover.",
            _slot,
            _slot,
        )

FAILOVER_MODELS = [env_provider] if env_provider else DEFAULT_FAILOVER_MODELS


def _prepare_request_kwargs(kwargs: dict, model_info: dict) -> dict:
    """Rewrite requests to the concrete model exposed by the active provider."""
    current_kwargs = kwargs.copy()
    provider_model = model_info.get("id")
    if provider_model:
        requested_model = current_kwargs.get("model")
        if requested_model != provider_model:
            logger.debug(
                "Failover: overriding requested model '%s' with provider model '%s'",
                requested_model,
                provider_model,
            )
        current_kwargs["model"] = provider_model
    return current_kwargs


class OpenAIFailoverClient:
    """Drop-in replacement for synchronous OpenAI client with failover."""

    FAILOVER_ERRORS = (RateLimitError, AuthenticationError, APIError)

    def __init__(self, **default_kwargs):
        self.default_kwargs = default_kwargs
        self.models_to_try = FAILOVER_MODELS
        if not self.models_to_try:
            self.models_to_try = [{"id": None, "base_url": None, "api_key": None}]

        # Shim for chat.completions.create
        class CompletionsShim:
            def __init__(self, failover_executor):
                self.failover_executor = failover_executor

            def create(self, *args, **kwargs):
                return self.failover_executor("chat", "completions", "create", *args, **kwargs)

        class ChatShim:
            def __init__(self, failover_executor):
                self.completions = CompletionsShim(failover_executor)

        class EmbeddingsShim:
            def __init__(self, default_kwargs):
                env_kwargs = default_kwargs.copy()
                if env_key:
                    env_kwargs["api_key"] = env_key
                    if env_base_url:
                        env_kwargs["base_url"] = env_base_url
                elif "api_key" not in env_kwargs:
                    env_kwargs["api_key"] = FAILOVER_MODELS[0]["api_key"]
                    env_kwargs["base_url"] = FAILOVER_MODELS[0]["base_url"]
                self.client = OpenAI(**env_kwargs)

            def create(self, *args, **kwargs):
                return self.client.embeddings.create(*args, **kwargs)

        class AudioShim:
            def __init__(self, default_kwargs):
                env_kwargs = default_kwargs.copy()
                if env_key:
                    env_kwargs["api_key"] = env_key
                    if env_base_url:
                        env_kwargs["base_url"] = env_base_url
                elif "api_key" not in env_kwargs:
                    env_kwargs["api_key"] = FAILOVER_MODELS[0]["api_key"]
                    env_kwargs["base_url"] = FAILOVER_MODELS[0]["base_url"]
                self.client = OpenAI(**env_kwargs)

            @property
            def speech(self):
                return self.client.audio.speech

        class ModerationsShim:
            def __init__(self, default_kwargs):
                env_kwargs = default_kwargs.copy()
                if env_key:
                    env_kwargs["api_key"] = env_key
                    if env_base_url:
                        env_kwargs["base_url"] = env_base_url
                elif "api_key" not in env_kwargs:
                    env_kwargs["api_key"] = FAILOVER_MODELS[0]["api_key"]
                    env_kwargs["base_url"] = FAILOVER_MODELS[0]["base_url"]
                self.client = OpenAI(**env_kwargs)

            def create(self, *args, **kwargs):
                return self.client.moderations.create(*args, **kwargs)

        self.chat = ChatShim(self._execute)
        self.embeddings = EmbeddingsShim(default_kwargs)
        self.audio = AudioShim(default_kwargs)
        self.moderations = ModerationsShim(default_kwargs)

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        pass

    def _create_client(self, model_info: dict) -> OpenAI:
        kwargs = self.default_kwargs.copy()
        if model_info.get("base_url"):
            kwargs["base_url"] = model_info["base_url"]
        if model_info.get("api_key"):
            kwargs["api_key"] = model_info["api_key"]
        return OpenAI(**kwargs)

    def _execute(self, api_group: str, api_subgroup: str, api_method: str, *args, **kwargs):
        last_error = None
        for i, model_info in enumerate(self.models_to_try):
            try:
                current_kwargs = _prepare_request_kwargs(kwargs, model_info)
                client = self._create_client(model_info)
                group = getattr(client, api_group)
                subgroup = getattr(group, api_subgroup)
                method = getattr(subgroup, api_method)

                logger.debug(
                    f"Failover: Attempting with provider (Try {i + 1}/{len(self.models_to_try)})"
                )
                return method(*args, **current_kwargs)
            except self.FAILOVER_ERRORS as e:
                logger.warning(f"Failover: Error: {type(e).__name__} - {str(e)[:100]}")
                last_error = e
                continue
            except Exception:
                logger.exception("Failover: Non-recoverable error")
                raise

        logger.error("Failover: All fallback models exhausted.")
        if last_error:
            raise last_error
        raise Exception("All fallback models exhausted.")


class AsyncOpenAIFailoverClient:
    """Drop-in replacement for Asynchronous OpenAI client with failover."""

    FAILOVER_ERRORS = (RateLimitError, AuthenticationError, APIError)

    def __init__(self, **default_kwargs):
        self.default_kwargs = default_kwargs
        self.models_to_try = FAILOVER_MODELS
        if not self.models_to_try:
            self.models_to_try = [{"id": None, "base_url": None, "api_key": None}]

        class AsyncCompletionsShim:
            def __init__(self, failover_executor):
                self.failover_executor = failover_executor

            async def create(self, *args, **kwargs):
                return await self.failover_executor(
                    "chat", "completions", "create", *args, **kwargs
                )

        class AsyncChatShim:
            def __init__(self, failover_executor):
                self.completions = AsyncCompletionsShim(failover_executor)

        class AsyncEmbeddingsShim:
            def __init__(self, default_kwargs):
                env_kwargs = default_kwargs.copy()
                if env_key:
                    env_kwargs["api_key"] = env_key
                    if env_base_url:
                        env_kwargs["base_url"] = env_base_url
                elif "api_key" not in env_kwargs:
                    env_kwargs["api_key"] = FAILOVER_MODELS[0]["api_key"]
                    env_kwargs["base_url"] = FAILOVER_MODELS[0]["base_url"]
                self.client = AsyncOpenAI(**env_kwargs)

            async def create(self, *args, **kwargs):
                return await self.client.embeddings.create(*args, **kwargs)

        class AsyncAudioShim:
            def __init__(self, default_kwargs):
                env_kwargs = default_kwargs.copy()
                if env_key:
                    env_kwargs["api_key"] = env_key
                    if env_base_url:
                        env_kwargs["base_url"] = env_base_url
                elif "api_key" not in env_kwargs:
                    env_kwargs["api_key"] = FAILOVER_MODELS[0]["api_key"]
                    env_kwargs["base_url"] = FAILOVER_MODELS[0]["base_url"]
                self.client = AsyncOpenAI(**env_kwargs)

            @property
            def speech(self):
                return self.client.audio.speech

        class AsyncModerationsShim:
            def __init__(self, default_kwargs):
                env_kwargs = default_kwargs.copy()
                if env_key:
                    env_kwargs["api_key"] = env_key
                    if env_base_url:
                        env_kwargs["base_url"] = env_base_url
                elif "api_key" not in env_kwargs:
                    env_kwargs["api_key"] = FAILOVER_MODELS[0]["api_key"]
                    env_kwargs["base_url"] = FAILOVER_MODELS[0]["base_url"]
                self.client = AsyncOpenAI(**env_kwargs)

            async def create(self, *args, **kwargs):
                return await self.client.moderations.create(*args, **kwargs)

        self.chat = AsyncChatShim(self._async_execute)
        self.embeddings = AsyncEmbeddingsShim(default_kwargs)
        self.audio = AsyncAudioShim(default_kwargs)
        self.moderations = AsyncModerationsShim(default_kwargs)

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        pass

    def _create_client(self, model_info: dict) -> AsyncOpenAI:
        kwargs = self.default_kwargs.copy()
        if model_info.get("base_url"):
            kwargs["base_url"] = model_info["base_url"]
        if model_info.get("api_key"):
            kwargs["api_key"] = model_info["api_key"]
        return AsyncOpenAI(**kwargs)

    async def _async_execute(
        self, api_group: str, api_subgroup: str, api_method: str, *args, **kwargs
    ):
        last_error = None
        for i, model_info in enumerate(self.models_to_try):
            try:
                current_kwargs = _prepare_request_kwargs(kwargs, model_info)

                client = self._create_client(model_info)
                group = getattr(client, api_group)
                subgroup = getattr(group, api_subgroup)
                method = getattr(subgroup, api_method)

                logger.debug(f"Failover: Attempting async (Try {i + 1}/{len(self.models_to_try)})")
                return await method(*args, **current_kwargs)
            except self.FAILOVER_ERRORS as e:
                logger.warning(f"Failover: Error async: {type(e).__name__} - {str(e)[:100]}")
                last_error = e
                continue
            except Exception:
                logger.exception("Failover: Non-recoverable async error")
                raise

        logger.error("Failover: All async fallback models exhausted.")
        if last_error:
            raise last_error
        raise Exception("All fallback models exhausted.")

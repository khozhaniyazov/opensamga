"""Regression tests for cache proxy wiring and startup imports."""

import asyncio
import os


def test_cache_proxy_identity_stable():
    import app.services.vector_search as vector_search
    from app.utils import cache as cache_module
    from app.utils.cache import SimpleCache

    original = cache_module.cache
    asyncio.run(cache_module.cache.set_backend(SimpleCache()))

    assert cache_module.cache is original
    assert vector_search.cache is cache_module.cache


def test_app_main_imports_cleanly():
    os.environ.setdefault("OPENAI_API_KEY", "test-key")
    import app.main

    assert hasattr(app.main, "app")


def test_cache_proxy_backend_swap_no_consumer_rebind_needed():
    import app.services.vector_search as vector_search
    from app.utils import cache as cache_module

    class FakeBackend:
        def __init__(self):
            self.values = {}
            self.closed = False

        async def get(self, key):
            return self.values.get(key)

        async def set(self, key, value, ttl_seconds=3600):
            self.values[key] = value

        async def invalidate(self, pattern):
            self.values = {k: v for k, v in self.values.items() if pattern not in k}

        async def clear(self):
            self.values.clear()

        def size(self):
            return len(self.values)

        async def cleanup_expired(self):
            return None

        async def close(self):
            self.closed = True

    backend = FakeBackend()
    asyncio.run(cache_module.cache.set_backend(backend))
    asyncio.run(vector_search.cache.set("k", "v", ttl_seconds=60))

    assert asyncio.run(vector_search.cache.get("k")) == "v"

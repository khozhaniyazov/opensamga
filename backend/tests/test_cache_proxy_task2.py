"""RED tests for cache proxy backend swapping."""

import asyncio


def test_cache_module_exposes_cache_proxy_instance():
    from app.utils import cache as cache_module
    from app.utils.cache import CacheProxy

    assert isinstance(cache_module.cache, CacheProxy)


def test_cache_identity_stays_stable_for_direct_import_consumers():
    import app.services.vector_search as vector_search
    from app.utils import cache as cache_module
    from app.utils.cache import SimpleCache

    original = cache_module.cache
    asyncio.run(cache_module.cache.set_backend(SimpleCache()))

    assert vector_search.cache is cache_module.cache
    assert cache_module.cache is original

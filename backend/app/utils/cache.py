"""
app/utils/cache.py
------------------
Simple in-memory cache with TTL support for Python/FastAPI backend.

This provides a lightweight caching layer without external dependencies (Redis).
Suitable for single-server deployments. Can be upgraded to Redis later.
"""

import hashlib
import json
import logging
from abc import ABC, abstractmethod
from datetime import UTC, datetime, timedelta

# UTC helper: datetime.utcnow() is deprecated in Python 3.12+ (scheduled for
# removal). datetime.now(UTC) is the modern, timezone-aware equivalent. We
# keep comparisons tz-aware by using the same helper everywhere in this file.
_UTC = UTC


def _now_utc() -> datetime:
    return datetime.now(_UTC)


import asyncio
from functools import wraps
from typing import Any

from app.config import settings

logger = logging.getLogger("cache")


class CacheBackend(ABC):
    @abstractmethod
    async def get(self, key: str) -> Any | None: ...

    @abstractmethod
    async def set(self, key: str, value: Any, ttl_seconds: int = 3600): ...

    @abstractmethod
    async def invalidate(self, pattern: str): ...

    @abstractmethod
    async def clear(self): ...

    @abstractmethod
    def size(self) -> int: ...

    @abstractmethod
    async def cleanup_expired(self): ...

    async def close(self):
        """Optional teardown hook for backends that own external
        resources (e.g. a Redis connection pool). The base class
        returns no-op rather than raising NotImplementedError so
        SimpleCache et al. can be GC'd without explicit closing.
        """
        return None


class SimpleCache(CacheBackend):
    """
    Thread-safe in-memory cache with TTL (Time To Live) support.

    Features:
    - Automatic expiration based on TTL
    - Cache key generation from arguments
    - Pattern-based invalidation
    - Memory-efficient (stores expiry times)
    """

    def __init__(self):
        self._cache: dict[str, tuple[Any, datetime]] = {}
        self._lock = asyncio.Lock()

    async def get(self, key: str) -> Any | None:
        """
        Get value from cache if it exists and hasn't expired.

        Args:
            key: Cache key

        Returns:
            Cached value if found and fresh, None otherwise
        """
        async with self._lock:
            if key in self._cache:
                value, expiry = self._cache[key]
                if _now_utc() < expiry:
                    return value
                else:
                    # Expired, remove from cache
                    del self._cache[key]
        return None

    async def set(self, key: str, value: Any, ttl_seconds: int = 3600):
        """
        Store value in cache with TTL.

        Args:
            key: Cache key
            value: Value to cache
            ttl_seconds: Time to live in seconds (default: 1 hour)
        """
        async with self._lock:
            expiry = _now_utc() + timedelta(seconds=ttl_seconds)
            self._cache[key] = (value, expiry)

    async def invalidate(self, pattern: str):
        """
        Invalidate all cache keys matching pattern.

        Args:
            pattern: String pattern to match (substring match)
        """
        async with self._lock:
            keys_to_delete = [k for k in self._cache.keys() if pattern in k]
            for key in keys_to_delete:
                del self._cache[key]

    async def clear(self):
        """Clear entire cache."""
        async with self._lock:
            self._cache.clear()

    def size(self) -> int:
        """Get number of items in cache."""
        return len(self._cache)

    async def cleanup_expired(self):
        """Remove all expired entries from cache (garbage collection)."""
        async with self._lock:
            now = _now_utc()
            expired_keys = [k for k, (_, expiry) in self._cache.items() if now >= expiry]
            for key in expired_keys:
                del self._cache[key]

    async def close(self):
        pass


class RedisCache(CacheBackend):
    def __init__(self, pool):
        import redis.asyncio as aioredis

        self._redis = aioredis.Redis(connection_pool=pool)
        self._pool = pool

    async def get(self, key: str) -> Any | None:
        try:
            value = await self._redis.get(key)
            if value is not None:
                return json.loads(value)
        except Exception as e:
            logger.warning(f"Redis GET failed for key={key[:50]}: {e}")
        return None

    async def set(self, key: str, value: Any, ttl_seconds: int = 3600):
        try:
            serialized = json.dumps(value, default=str)
            await self._redis.setex(key, ttl_seconds, serialized)
        except Exception as e:
            logger.warning(f"Redis SET failed for key={key[:50]}: {e}")

    async def invalidate(self, pattern: str):
        try:
            cursor = 0
            while True:
                cursor, keys = await self._redis.scan(
                    cursor=cursor, match=f"*{pattern}*", count=100
                )
                if keys:
                    await self._redis.delete(*keys)
                if cursor == 0:
                    break
        except Exception as e:
            logger.warning(f"Redis INVALIDATE failed for pattern={pattern}: {e}")

    async def clear(self):
        try:
            await self._redis.flushdb()
        except Exception as e:
            logger.warning(f"Redis FLUSHDB failed: {e}")

    def size(self) -> int:
        # Synchronous call not ideal; return -1 for Redis
        return -1

    async def cleanup_expired(self):
        # No-op: Redis handles TTL expiry natively
        pass

    async def close(self):
        try:
            await self._redis.aclose()
            await self._pool.disconnect()
            logger.info("Redis connection pool closed")
        except Exception as e:
            logger.warning(f"Redis close failed: {e}")


class CacheProxy(CacheBackend):
    """Stable cache object that forwards to a swappable backend."""

    def __init__(self, backend: CacheBackend):
        self._backend = backend
        self._backend_lock = asyncio.Lock()

    async def set_backend(self, backend: CacheBackend):
        """Swap backend without replacing proxy object identity."""
        old_backend = None
        async with self._backend_lock:
            if backend is self._backend:
                return
            old_backend = self._backend
            self._backend = backend

        if old_backend is not None and old_backend is not backend:
            await old_backend.close()

    async def get(self, key: str) -> Any | None:
        return await self._backend.get(key)

    async def set(self, key: str, value: Any, ttl_seconds: int = 3600):
        await self._backend.set(key, value, ttl_seconds=ttl_seconds)

    async def invalidate(self, pattern: str):
        await self._backend.invalidate(pattern)

    async def clear(self):
        await self._backend.clear()

    def size(self) -> int:
        return self._backend.size()

    async def cleanup_expired(self):
        await self._backend.cleanup_expired()

    async def close(self):
        await self._backend.close()


async def create_cache(redis_url: str = "") -> CacheBackend:
    """Create cache backend: Redis if URL provided, else in-memory SimpleCache."""
    if redis_url:
        try:
            import redis.asyncio as aioredis

            pool = aioredis.ConnectionPool.from_url(
                redis_url,
                max_connections=settings.REDIS_MAX_CONNECTIONS,
                decode_responses=True,
                socket_timeout=settings.REDIS_SOCKET_TIMEOUT,
                socket_connect_timeout=settings.REDIS_SOCKET_TIMEOUT,
            )
            redis_cache = RedisCache(pool)
            # Test connection
            await redis_cache._redis.ping()
            logger.info("Redis cache initialized successfully")
            return redis_cache
        except Exception as e:
            logger.warning(f"Redis connection failed, falling back to in-memory cache: {e}")
            return SimpleCache()
    logger.info("Using in-memory cache (Redis not configured)")
    return SimpleCache()


# Global cache instance
cache = CacheProxy(SimpleCache())


def cache_key(*args, **kwargs) -> str:
    """
    Generate a cache key from function arguments.

    Args:
        *args: Positional arguments
        **kwargs: Keyword arguments

    Returns:
        SHA256 hash of arguments (first 16 chars)
    """
    # Combine args and kwargs into a single string
    key_data = {"args": args, "kwargs": kwargs}
    key_str = json.dumps(key_data, sort_keys=True, default=str)
    key_hash = hashlib.sha256(key_str.encode()).hexdigest()[:16]
    return key_hash


def cached(ttl_seconds: int = 3600, key_prefix: str = ""):
    """
    Decorator for caching function results.

    Usage:
        @cached(ttl_seconds=300, key_prefix="user")
        async def get_user(user_id: int):
            return await db.query(User).filter(User.id == user_id).first()

    Args:
        ttl_seconds: Cache TTL in seconds
        key_prefix: Prefix for cache key (useful for invalidation)
    """

    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            # Generate cache key
            key = f"{key_prefix}:{func.__name__}:{cache_key(*args, **kwargs)}"

            # Check cache
            cached_value = await cache.get(key)
            if cached_value is not None:
                return cached_value

            # Cache miss - call function
            result = await func(*args, **kwargs)

            # Store in cache
            await cache.set(key, result, ttl_seconds=ttl_seconds)

            return result

        return wrapper

    return decorator


# Periodic cleanup task (optional - can be called from lifespan)
async def cache_cleanup_task():
    """Background task to clean up expired cache entries every 5 minutes."""
    while True:
        await asyncio.sleep(300)  # 5 minutes
        await cache.cleanup_expired()
        # v3.57: route cleanup heartbeat through the existing module
        # logger so it lands in standard scrapers (was print-only).
        logger.debug("Cleaned up expired entries. Current size: %d", cache.size())

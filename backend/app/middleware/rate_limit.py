"""Rate-limit key extraction.

opensamga round-3 (2026-05-15) audit fixed first-hop XFF trust. The
previous behaviour took ``X-Forwarded-For.split(',')[0]``, which is
attacker-controlled when the request flows through a non-XFF-stripping
proxy (or no proxy at all): an attacker rotating
``X-Forwarded-For: 1.2.3.<n>`` defeated any limiter. Same shape as v3.3
``dev_console`` fix.

Trust model:

* A small allowlist of trusted-proxy IPs (loopback + RFC1918) is read
  from ``RATE_LIMIT_TRUSTED_PROXIES`` (CSV, default ``"127.0.0.1,::1"``).
* If the immediate peer is NOT in that allowlist, we ignore XFF entirely
  and bind to the peer.
* If the immediate peer IS trusted, we walk XFF right-to-left and skip
  trusted-proxy entries; the first non-trusted hop is the real client.

This lets a deployment behind a single nginx (TRUSTED_PROXIES=127.0.0.1)
get a real client IP, while a direct-to-uvicorn deploy ignores forged
XFF entirely.
"""

from __future__ import annotations

import ipaddress
import os
from functools import lru_cache

from fastapi import Request
from slowapi import Limiter
from slowapi.util import get_remote_address


@lru_cache(maxsize=1)
def _trusted_proxies() -> tuple[ipaddress._BaseAddress | ipaddress._BaseNetwork, ...]:
    raw = os.getenv("RATE_LIMIT_TRUSTED_PROXIES", "127.0.0.1,::1")
    parsed: list[ipaddress._BaseAddress | ipaddress._BaseNetwork] = []
    for token in raw.split(","):
        token = token.strip()
        if not token:
            continue
        try:
            if "/" in token:
                parsed.append(ipaddress.ip_network(token, strict=False))
            else:
                parsed.append(ipaddress.ip_address(token))
        except ValueError:
            # Malformed entry — skip silently rather than letting a typo in
            # ops config kill the whole rate-limit middleware.
            continue
    return tuple(parsed)


def _is_trusted(ip_str: str) -> bool:
    try:
        ip = ipaddress.ip_address(ip_str)
    except ValueError:
        return False
    for entry in _trusted_proxies():
        if isinstance(entry, ipaddress._BaseNetwork):
            if ip in entry:
                return True
        elif ip == entry:
            return True
    return False


def get_client_ip(request: Request) -> str:
    """Return the client IP for rate-limit keying.

    Trusts ``X-Forwarded-For`` only when the immediate peer is a
    configured trusted proxy. Walks XFF right-to-left to get the
    first non-trusted hop (the real client).
    """
    peer = request.client.host if request.client else None

    if peer and _is_trusted(peer):
        forwarded = request.headers.get("X-Forwarded-For", "")
        if forwarded:
            for hop in reversed([h.strip() for h in forwarded.split(",") if h.strip()]):
                if not _is_trusted(hop):
                    return hop
        # All hops trusted (unlikely) — fall back to the peer itself.
        return peer

    # Direct-to-app or untrusted peer — ignore any XFF the client sent.
    return peer or get_remote_address(request)


limiter = Limiter(key_func=get_client_ip, default_limits=[])


# opensamga round-4 (2026-05-15) audit: centralised per-endpoint
# rate-limit budgets, env-overridable. Centralising here keeps
# router decorators short (`@limiter.limit(LIMIT_AUTH_LOGIN)`) and
# lets ops tune deployments without touching code.
def _env_limit(name: str, default: str) -> str:
    value = os.getenv(f"RATE_LIMIT_{name}", default).strip()
    return value or default


LIMIT_AUTH_LOGIN = _env_limit("AUTH_LOGIN", "10/minute")
LIMIT_AUTH_REGISTER = _env_limit("AUTH_REGISTER", "5/minute")
LIMIT_AUTH_REFRESH = _env_limit("AUTH_REFRESH", "20/minute")
LIMIT_CHAT_OCR = _env_limit("CHAT_OCR", "10/minute")
LIMIT_CHAT_STREAM = _env_limit("CHAT_STREAM", "30/minute")
LIMIT_ADMIN_UPLOAD = _env_limit("ADMIN_UPLOAD", "5/minute")

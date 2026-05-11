# Security

## Disclosure

This is a released-as-is MIT snapshot with no active maintainer. There
is no bug bounty program and no SLA on security fixes.

If you find a genuine security issue in this codebase, please open a
GitHub issue describing the problem. Do NOT include exploit payloads,
credentials, or PII in the public issue.

If you believe the issue is being actively exploited against a live
deployment, contact the deployment operator directly — **not** the
upstream author.

## What this snapshot explicitly doesn't warrant

- That secrets in the private upstream history were never leaked. The
  public snapshot is a fresh single-commit tree and does not contain
  that history, but historical commits of the upstream private repo
  are not audited here.
- That every dependency is current. `dependabot` is not configured on
  the public fork by default; run your own dependency audit before
  any production use (`npm audit`, `pip audit`).
- That all input paths are hardened against pathological adversarial
  student input. The code was written for a friendly student audience;
  self-hosters should review chat prompts, file-upload handlers, and
  admin-gate logic before exposing the service publicly.

## If you self-host

Before shipping to production, at minimum:

1. **Rotate or generate** `SECRET_KEY`, `BILLING_WEBHOOK_SECRET`, all
   provider API keys.
2. **Set** `ENVIRONMENT=production` — `app/config.py::validate_settings`
   will refuse to start if dev defaults leak into prod.
3. **Review** `backend/app/routers/admin*.py` and the admin-gate helpers
   in `backend/app/dependencies/` — the admin allowlist is env-driven
   (`RAG_ADMIN_EMAILS`) and ships empty.
4. **Review** `backend/app/services/safety.py` and the prompt sanitizer
   in `backend/app/services/chat/prompts.py` if you plan to expose the
   chat surface to an untrusted audience.
5. **Review** your CORS, cookie, and CSRF policies — the defaults are
   tuned for the original single-domain deployment and may be too
   permissive for your deployment.

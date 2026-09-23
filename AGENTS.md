# WSA Repository Guardrails

This repository is part of Walker Systems & Automation (WSA).

## Mandatory startup
Before material work:
1. Read this file.
2. If available to you, read the canonical private governance files in `jaylawalker1999-glitch/agency-internal`: `AGENTS.md`, `SECURITY.md`, and `WSA_CURRENT_STATE.md`.
3. Inspect the current branch and relevant files.
4. If the task depends on live behavior, inspect current deployed/configured state when access exists.

If you cannot access the canonical governance/current-state files, do not guess about WSA-wide architecture or make production-impacting cross-system changes. Ask for the current checkpoint.

## Authority and change control
Jayla Walker is the final human authority for production deploys, destructive changes, credential/security changes, billing/contracts, and material architecture decisions.

Default mode for Codex, Claude, Muse, and other engineering agents:
- work on a branch
- test
- open/review a PR
- do not directly deploy production unless the current task explicitly authorizes that specific production action

Browser access or credentials are not production authorization.

## Security
- Never commit secrets, API keys, service-role keys, OAuth secrets/tokens, webhook secrets, passwords, production .env files, payment credentials, or private customer exports.
- Do not hardcode production tenant credentials or IDs except clearly labeled test fixtures.
- Do not weaken authentication/RLS to make a test pass.
- Do not send real customer messages, create charges, or alter appointments during tests unless explicitly authorized.

## Evidence
Current verified production evidence outranks old prompts, chats, summaries, and legacy docs.

Use WSA status terms accurately: PLANNED / BUILT / TESTED / LIVE-VERIFIED / VERIFY / LEGACY / RETIRED.

# Security Policy

## Supported version

Security updates currently target Business Eyes v1 Lite (`1.x`).

## Reporting a vulnerability

Do not publish bot tokens, webhook secrets, payment identifiers, user data, or exploit details in a public issue. Contact the repository owner privately and include only the minimum information required to reproduce the problem.

If a secret may have been exposed, rotate it immediately before beginning the investigation.

## Production deployment checklist

- Store `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, and `HF_TOKEN` only in the hosting provider's encrypted secret store.
- Keep `ALLOW_PREVIEW_MODE=false` in production.
- Generate a random webhook secret containing at least 32 characters from Telegram's supported character set.
- Configure the Telegram webhook with the same `secret_token` and limit `allowed_updates` to `message`, `callback_query`, and `pre_checkout_query`.
- Apply every D1 migration, including `0002_security_hardening.sql`, before deploying the matching application version.
- Keep `MAX_REPORTS_PER_MINUTE`, `MAX_REPORTS_PER_DAY`, and `HF_TIMEOUT_MS` within the documented bounds.
- Never log raw Telegram `initData`, authorization headers, bot tokens, Hugging Face tokens, or complete payment objects.
- Keep Cloudflare, Next.js, Vinext, and all direct dependencies updated.
- Enable GitHub Dependabot alerts, secret scanning, and branch protection on the remote repository.
- Require the security workflow to pass before merging into `main`.

## Incident response

### Exposed Telegram bot token

1. Revoke or regenerate the bot token through BotFather.
2. Update the hosting secret.
3. Redeploy the application.
4. Re-register the webhook using the new token and the existing or rotated webhook secret.
5. Review recent bot activity and payment records.

### Exposed webhook secret

1. Generate a new random webhook secret.
2. Update the hosting secret.
3. Call `setWebhook` again with the new `secret_token`.
4. Confirm that requests using the old secret receive `401 Unauthorized`.

### Suspicious wallet activity

1. Preserve the relevant D1 transaction records.
2. Compare the internal transaction with Telegram's `telegram_payment_charge_id`.
3. Temporarily disable subscription purchases if transaction integrity is uncertain.
4. Rotate secrets if unauthorized webhook access is suspected.

## Security controls implemented in the application

- Signed Telegram Mini App identity validation with a one-hour freshness limit
- Constant-time webhook-secret comparison
- Strict webhook-secret format and minimum length
- HTTPS-only Mini App URL validation
- Bounded JSON request-body parsing
- Per-user minute and daily report-generation limits
- Time-limited Hugging Face requests
- Idempotent payment completion and unique Telegram payment charge IDs
- Transactional wallet debits and subscription activation
- No-store API responses for user reports and authentication results
- Browser security headers and Telegram-only framing
- Automated dependency audit, tests, lint, and production build checks

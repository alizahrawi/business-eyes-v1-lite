# Daily Report Builder

`Daily Report Builder` is the first application in the **Business Eyes** product family. It is a Persian-first Telegram Mini App that converts informal daily activity notes into concise, structured, manager-ready work reports.

[← Business Eyes repository](../../README.md) · [Architecture](../../docs/architecture/daily-report-builder/README.md) · [Security policy](../../SECURITY.md)

## Responsibilities of this module

- Render the Persian Telegram Mini App interface
- Read the authenticated Telegram user's name and profile image
- Accept natural-language activity notes
- Generate formal, concise, or result-oriented reports
- Validate Telegram Mini App `initData` on the server
- Enforce trial and subscription access
- Process Telegram bot commands and Stars payments
- Maintain wallet credits and subscriptions in Cloudflare D1
- Call the configured Hugging Face model with a bounded timeout
- Fall back to deterministic report formatting when AI is unavailable

## Application boundaries

This application owns report creation, Telegram access, wallet transactions, and subscription activation. Future Business Eyes products—such as management analytics or team workflow intelligence—should be implemented as separate folders under the repository-level `apps/` directory.

## Important routes

| Route | Responsibility |
| --- | --- |
| `/` | Telegram Mini App report-builder interface |
| `/api/generate` | Authentication, access checks, rate limiting, and report generation |
| `/api/telegram/webhook` | Bot commands, invoices, successful payments, wallet credits, and subscriptions |

## Local setup

From the repository root:

```bash
npm ci
npm run dev
```

The root workspace scripts delegate to this application. To call the workspace directly:

```bash
npm run build --workspace @business-eyes/daily-report-builder
npm run test --workspace @business-eyes/daily-report-builder
```

## Environment

Copy `.env.example` to a local secret file that is ignored by Git, then configure:

```env
TELEGRAM_BOT_TOKEN=
TELEGRAM_WEBHOOK_SECRET=
APP_URL=https://your-app.example.com
MONTHLY_PRICE_CREDITS=
QUARTERLY_PRICE_CREDITS=
HF_TOKEN=
HF_MODEL=Qwen/Qwen2.5-7B-Instruct-1M:fastest
ALLOW_PREVIEW_MODE=false
MAX_REPORTS_PER_MINUTE=6
MAX_REPORTS_PER_DAY=100
HF_TIMEOUT_MS=25000
```

Never commit a real token or secret. Production secrets must be stored in the hosting provider's encrypted secret store.

## Database

The application uses three business tables and one security table:

- `telegram_users`
- `wallet_transactions`
- `bot_sessions`
- `api_rate_limits`

Apply every SQL migration in `drizzle/` before deploying the corresponding application version.

## Deployment root

When a hosting platform asks for the application or project directory, use:

```text
apps/daily-report-builder
```

The application-specific `.openai/hosting.json`, framework configuration, source, migrations, and runtime scripts are all contained inside this directory.


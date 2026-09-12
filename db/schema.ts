import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const telegramUsers = sqliteTable("telegram_users", {
  telegramUserId: text("telegram_user_id").primaryKey(),
  firstName: text("first_name").notNull().default(""),
  username: text("username"),
  trialStartedAt: integer("trial_started_at").notNull().default(0),
  trialEndsAt: integer("trial_ends_at").notNull().default(0),
  subscriptionEndsAt: integer("subscription_ends_at").notNull().default(0),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const botSessions = sqliteTable("bot_sessions", {
  telegramUserId: text("telegram_user_id").primaryKey(),
  kind: text("kind").notNull(),
  expiresAt: integer("expires_at").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const walletTransactions = sqliteTable(
  "wallet_transactions",
  {
    id: text("id").primaryKey(),
    telegramUserId: text("telegram_user_id").notNull(),
    type: text("type").notNull(),
    amountStars: integer("amount_stars").notNull(),
    creditDelta: integer("credit_delta").notNull(),
    status: text("status").notNull(),
    invoicePayload: text("invoice_payload").notNull(),
    telegramPaymentChargeId: text("telegram_payment_charge_id"),
    providerPaymentChargeId: text("provider_payment_charge_id"),
    createdAt: integer("created_at").notNull(),
    completedAt: integer("completed_at"),
  },
  (table) => [
    index("idx_wallet_transactions_user_status").on(table.telegramUserId, table.status),
    uniqueIndex("idx_wallet_transactions_charge_id").on(table.telegramPaymentChargeId),
  ],
);

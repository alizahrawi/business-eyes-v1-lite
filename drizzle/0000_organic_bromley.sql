CREATE TABLE `telegram_users` (
	`telegram_user_id` text PRIMARY KEY NOT NULL,
	`first_name` text DEFAULT '' NOT NULL,
	`username` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `wallet_transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`telegram_user_id` text NOT NULL,
	`type` text NOT NULL,
	`amount_stars` integer NOT NULL,
	`credit_delta` integer NOT NULL,
	`status` text NOT NULL,
	`invoice_payload` text NOT NULL,
	`telegram_payment_charge_id` text,
	`provider_payment_charge_id` text,
	`created_at` integer NOT NULL,
	`completed_at` integer
);
--> statement-breakpoint
CREATE INDEX `idx_wallet_transactions_user_status` ON `wallet_transactions` (`telegram_user_id`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_wallet_transactions_charge_id` ON `wallet_transactions` (`telegram_payment_charge_id`);
--> statement-breakpoint
PRAGMA optimize;

CREATE TABLE `bot_sessions` (
	`telegram_user_id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `telegram_users` ADD `trial_started_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `telegram_users` ADD `trial_ends_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `telegram_users` ADD `subscription_ends_at` integer DEFAULT 0 NOT NULL;
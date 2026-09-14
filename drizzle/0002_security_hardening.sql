CREATE TABLE `api_rate_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`telegram_user_id` text NOT NULL,
	`scope` text NOT NULL,
	`window_started_at` integer NOT NULL,
	`request_count` integer DEFAULT 1 NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_api_rate_limits_updated_at` ON `api_rate_limits` (`updated_at`);

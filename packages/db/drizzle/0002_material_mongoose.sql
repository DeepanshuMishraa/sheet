CREATE TABLE `design_comment` (
	`id` text NOT NULL,
	`design_id` text NOT NULL,
	`user_id` text NOT NULL,
	`node_id` text NOT NULL,
	`node_label` text NOT NULL,
	`body` text NOT NULL,
	`author` text DEFAULT 'user' NOT NULL,
	`resolved_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`id`, `user_id`),
	FOREIGN KEY (`design_id`,`user_id`) REFERENCES `design`(`id`,`user_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `design_comment_design_idx` ON `design_comment` (`user_id`,`design_id`,`node_id`,`created_at`);
CREATE TABLE `asset` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`media_type` text NOT NULL,
	`size` integer NOT NULL,
	`storage_key` text,
	`data` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `asset_user_id_idx` ON `asset` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `canvas_transaction` (
	`design_id` text NOT NULL,
	`user_id` text NOT NULL,
	`author_user_id` text,
	`target_key` text NOT NULL,
	`transaction_id` text NOT NULL,
	`base_revision` integer NOT NULL,
	`revision` integer NOT NULL,
	`transaction` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `design_id`, `target_key`, `transaction_id`),
	FOREIGN KEY (`design_id`,`user_id`) REFERENCES `design`(`id`,`user_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `canvas_transaction_target_revision_idx` ON `canvas_transaction` (`user_id`,`design_id`,`target_key`,`revision`);--> statement-breakpoint
CREATE INDEX `canvas_transaction_created_idx` ON `canvas_transaction` (`created_at`);--> statement-breakpoint
CREATE TABLE `design` (
	`id` text NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`shapes` text NOT NULL,
	`pages` text NOT NULL,
	`canvas_version` integer DEFAULT 1 NOT NULL,
	`canvas_document` text,
	`canvas_migration_lease_id` text,
	`canvas_migration_lease_expires_at` integer,
	`revision` integer DEFAULT 0 NOT NULL,
	`archived_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`id`, `user_id`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `design_user_id_idx` ON `design` (`user_id`);--> statement-breakpoint
CREATE TABLE `design_draft` (
	`id` text NOT NULL,
	`design_id` text NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`base_shapes` text NOT NULL,
	`shapes` text NOT NULL,
	`base_pages` text NOT NULL,
	`pages` text NOT NULL,
	`canvas_version` integer DEFAULT 1 NOT NULL,
	`base_canvas_version` integer DEFAULT 1 NOT NULL,
	`base_canvas_document` text,
	`canvas_document` text,
	`base_revision` integer NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`applied_version_id` text,
	`proposed_at` integer,
	`applied_at` integer,
	`closed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`id`, `user_id`),
	FOREIGN KEY (`design_id`,`user_id`) REFERENCES `design`(`id`,`user_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `design_draft_design_idx` ON `design_draft` (`user_id`,`design_id`,`status`,`updated_at`);--> statement-breakpoint
CREATE TABLE `design_version` (
	`id` text NOT NULL,
	`design_id` text NOT NULL,
	`draft_id` text,
	`user_id` text NOT NULL,
	`message` text NOT NULL,
	`shapes` text NOT NULL,
	`pages` text NOT NULL,
	`canvas_version` integer DEFAULT 1 NOT NULL,
	`canvas_document` text,
	`added` integer NOT NULL,
	`removed` integer NOT NULL,
	`changed` integer NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`id`, `user_id`),
	FOREIGN KEY (`design_id`,`user_id`) REFERENCES `design`(`id`,`user_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`draft_id`,`user_id`) REFERENCES `design_draft`(`id`,`user_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `design_version_design_idx` ON `design_version` (`user_id`,`design_id`,`draft_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `user_preferences` (
	`user_id` text PRIMARY KEY NOT NULL,
	`shortcuts` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);

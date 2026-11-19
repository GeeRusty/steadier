ALTER TABLE `steadier_compass_keys` MODIFY COLUMN `connectorActor` enum('claude','chatgpt','grok','manus','connector');--> statement-breakpoint
ALTER TABLE `steadier_workspace_backups` MODIFY COLUMN `actor` enum('claude','chatgpt','grok','manus','connector','owner') NOT NULL;--> statement-breakpoint
ALTER TABLE `steadier_pending_deletes` MODIFY COLUMN `requestedBy` enum('claude','chatgpt','grok','manus','connector') NOT NULL DEFAULT 'claude';--> statement-breakpoint
ALTER TABLE `steadier_compass_oauth_codes` MODIFY COLUMN `connectorActor` enum('claude','chatgpt','grok','manus','connector') NOT NULL DEFAULT 'connector';

ALTER TABLE `steadier_workspace_backups` MODIFY COLUMN `actor` enum('claude','chatgpt','connector','owner') NOT NULL;--> statement-breakpoint
ALTER TABLE `steadier_compass_keys` ADD `refreshTokenHash` char(64);--> statement-breakpoint
ALTER TABLE `steadier_compass_keys` ADD `refreshExpiresAt` timestamp;--> statement-breakpoint
ALTER TABLE `steadier_compass_keys` ADD `oauthClientId` varchar(96);--> statement-breakpoint
ALTER TABLE `steadier_compass_keys` ADD `connectorActor` enum('claude','chatgpt','connector');--> statement-breakpoint
ALTER TABLE `steadier_compass_oauth_clients` ADD `refreshEnabled` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `steadier_compass_oauth_codes` ADD `offlineAccess` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `steadier_compass_oauth_requests` ADD `offlineAccess` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `steadier_pending_deletes` ADD `requestedBy` enum('claude','chatgpt','connector') DEFAULT 'claude' NOT NULL;--> statement-breakpoint
ALTER TABLE `steadier_compass_keys` ADD CONSTRAINT `steadier_compass_keys_refreshTokenHash_unique` UNIQUE(`refreshTokenHash`);
CREATE TABLE `steadier_pending_deletes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`ownerId` int NOT NULL,
	`itemKind` enum('task','project') NOT NULL,
	`itemId` varchar(128) NOT NULL,
	`itemTitle` varchar(500) NOT NULL,
	`reason` text NOT NULL,
	`status` enum('pending','deleted','kept') NOT NULL DEFAULT 'pending',
	`requestedAt` timestamp NOT NULL DEFAULT (now()),
	`decidedAt` timestamp,
	CONSTRAINT `steadier_pending_deletes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `steadier_workspace_backups` (
	`id` int AUTO_INCREMENT NOT NULL,
	`ownerId` int NOT NULL,
	`sourceRevision` int NOT NULL,
	`workspaceJson` mediumtext NOT NULL,
	`timeZone` varchar(100) NOT NULL,
	`actor` enum('claude','owner') NOT NULL,
	`reason` varchar(500) NOT NULL,
	`taskCount` int NOT NULL,
	`projectCount` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `steadier_workspace_backups_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `steadier_compass_keys` ADD `scope` varchar(64) DEFAULT 'steadier:read' NOT NULL;--> statement-breakpoint
CREATE INDEX `steadier_pending_delete_owner` ON `steadier_pending_deletes` (`ownerId`,`status`);--> statement-breakpoint
CREATE INDEX `steadier_backup_owner_created` ON `steadier_workspace_backups` (`ownerId`,`createdAt`);
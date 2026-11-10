CREATE TABLE `steadier_compass_keys` (
	`id` int AUTO_INCREMENT NOT NULL,
	`ownerId` int NOT NULL,
	`tokenHash` char(64) NOT NULL,
	`label` varchar(100) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`expiresAt` timestamp NOT NULL,
	`lastUsedAt` timestamp,
	`revokedAt` timestamp,
	CONSTRAINT `steadier_compass_keys_id` PRIMARY KEY(`id`),
	CONSTRAINT `steadier_compass_keys_tokenHash_unique` UNIQUE(`tokenHash`)
);
--> statement-breakpoint
CREATE TABLE `steadier_workspace_recoveries` (
	`id` int AUTO_INCREMENT NOT NULL,
	`ownerId` int NOT NULL,
	`sourceRevision` int NOT NULL,
	`workspaceJson` mediumtext NOT NULL,
	`timeZone` varchar(100) NOT NULL,
	`focusOwnerClientId` varchar(128),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `steadier_workspace_recoveries_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `steadier_workspaces` (
	`ownerId` int NOT NULL,
	`workspaceJson` mediumtext NOT NULL,
	`revision` int NOT NULL,
	`timeZone` varchar(100) NOT NULL,
	`focusOwnerClientId` varchar(128),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `steadier_workspaces_ownerId` PRIMARY KEY(`ownerId`)
);
--> statement-breakpoint
CREATE INDEX `steadier_compass_owner` ON `steadier_compass_keys` (`ownerId`);--> statement-breakpoint
CREATE INDEX `steadier_recovery_owner_created` ON `steadier_workspace_recoveries` (`ownerId`,`createdAt`);
CREATE TABLE `steadier_calendar_feeds` (
	`id` int AUTO_INCREMENT NOT NULL,
	`ownerId` int NOT NULL,
	`tokenHash` char(64) NOT NULL,
	`hideTitles` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`lastFetchedAt` timestamp,
	`revokedAt` timestamp,
	CONSTRAINT `steadier_calendar_feeds_id` PRIMARY KEY(`id`),
	CONSTRAINT `steadier_calendar_feeds_tokenHash_unique` UNIQUE(`tokenHash`)
);
--> statement-breakpoint
CREATE INDEX `steadier_calendar_owner` ON `steadier_calendar_feeds` (`ownerId`);
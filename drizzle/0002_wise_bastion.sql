CREATE TABLE `steadier_compass_oauth_clients` (
	`clientId` varchar(96) NOT NULL,
	`clientName` varchar(120) NOT NULL,
	`redirectUrisJson` mediumtext NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `steadier_compass_oauth_clients_clientId` PRIMARY KEY(`clientId`)
);
--> statement-breakpoint
CREATE TABLE `steadier_compass_oauth_codes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`requestId` char(64) NOT NULL,
	`codeHash` char(64) NOT NULL,
	`ownerId` int NOT NULL,
	`clientId` varchar(96) NOT NULL,
	`redirectUri` varchar(2048) NOT NULL,
	`codeChallenge` varchar(128) NOT NULL,
	`scope` varchar(64) NOT NULL,
	`resource` varchar(2048) NOT NULL,
	`issuedAt` timestamp NOT NULL DEFAULT (now()),
	`expiresAt` timestamp NOT NULL,
	`redeemedAt` timestamp,
	CONSTRAINT `steadier_compass_oauth_codes_id` PRIMARY KEY(`id`),
	CONSTRAINT `steadier_compass_oauth_codes_codeHash_unique` UNIQUE(`codeHash`)
);
--> statement-breakpoint
CREATE TABLE `steadier_compass_oauth_requests` (
	`id` char(64) NOT NULL,
	`clientId` varchar(96) NOT NULL,
	`redirectUri` varchar(2048) NOT NULL,
	`state` text,
	`codeChallenge` varchar(128) NOT NULL,
	`scope` varchar(64) NOT NULL,
	`resource` varchar(2048) NOT NULL,
	`ownerId` int,
	`status` enum('pending','approved','denied') NOT NULL DEFAULT 'pending',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`expiresAt` timestamp NOT NULL,
	`decidedAt` timestamp,
	CONSTRAINT `steadier_compass_oauth_requests_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `steadier_oauth_client_created` ON `steadier_compass_oauth_clients` (`createdAt`);--> statement-breakpoint
CREATE INDEX `steadier_oauth_code_owner` ON `steadier_compass_oauth_codes` (`ownerId`,`issuedAt`);--> statement-breakpoint
CREATE INDEX `steadier_oauth_code_expiry` ON `steadier_compass_oauth_codes` (`expiresAt`);--> statement-breakpoint
CREATE INDEX `steadier_oauth_request_owner` ON `steadier_compass_oauth_requests` (`ownerId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `steadier_oauth_request_expiry` ON `steadier_compass_oauth_requests` (`expiresAt`);
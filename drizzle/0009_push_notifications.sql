CREATE TABLE `steadier_push_subscriptions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`ownerId` int NOT NULL,
	`endpointHash` char(64) NOT NULL,
	`endpoint` text NOT NULL,
	`p256dh` varchar(200) NOT NULL,
	`auth` varchar(100) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`lastSentAt` timestamp,
	CONSTRAINT `steadier_push_subscriptions_id` PRIMARY KEY(`id`),
	CONSTRAINT `steadier_push_subscriptions_endpointHash_unique` UNIQUE(`endpointHash`)
);--> statement-breakpoint
CREATE TABLE `steadier_push_sent` (
	`ownerId` int NOT NULL,
	`keyHash` char(64) NOT NULL,
	`sentAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `steadier_push_sent_ownerId_keyHash_pk` PRIMARY KEY(`ownerId`,`keyHash`)
);

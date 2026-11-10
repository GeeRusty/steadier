CREATE TABLE `steadier_local_credentials` (
	`userId` int NOT NULL,
	`email` varchar(320) NOT NULL,
	`passwordHash` varchar(255) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `steadier_local_credentials_userId` PRIMARY KEY(`userId`),
	CONSTRAINT `steadier_local_credentials_email_unique` UNIQUE(`email`)
);

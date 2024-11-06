// Copyright 2024 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
/**
 * Interface for the entity storage background task connector.
 */
export interface IEntityStorageBackgroundTaskConnectorConfig {
	/**
	 * The default interval to leave between tasks in milliseconds, defaults to 100ms.
	 */
	taskInterval?: number;

	/**
	 * The default retry interval to leave between tasks in milliseconds, defaults to 5000ms.
	 */
	retryInterval?: number;

	/**
	 * The default cleanup interval for removing retained tasks, defaults to 120000ms.
	 */
	cleanupInterval?: number;
}

// Copyright 2024 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import type { IEntityStorageBackgroundTaskConnectorConfig } from "./IEntityStorageBackgroundTaskConnectorConfig";

/**
 * Options for the entity storage background task connector constructor.
 */
export interface IEntityStorageBackgroundTaskConnectorConstructorOptions {
	/**
	 * The background task entity storage connector type.
	 * @default background-task
	 */
	backgroundTaskEntityStorageType?: string;

	/**
	 * The logging connector type.
	 * @default logging
	 */
	loggingConnectorType?: string;

	/**
	 * The configuration for the connector.
	 */
	config?: IEntityStorageBackgroundTaskConnectorConfig;
}

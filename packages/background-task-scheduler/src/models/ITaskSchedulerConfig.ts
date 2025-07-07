// Copyright 2024 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.

/**
 * Interface for the task scheduler configuration.
 */
export interface ITaskSchedulerConfig {
	/**
	 * The interval between checks for running tasks, defaults to 1 minute since that is the resolution of the tasks.
	 * @default 60000
	 */
	overrideInterval?: number;
}

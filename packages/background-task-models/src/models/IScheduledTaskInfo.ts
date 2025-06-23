// Copyright 2024 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import type { IScheduledTaskTime } from "./IScheduledTaskTime";

/**
 * Interface describing a scheduled task information.
 */
export interface IScheduledTaskInfo {
	/**
	 * The information for the tasks.
	 */
	tasks: {
		[id: string]: IScheduledTaskTime[];
	};
}

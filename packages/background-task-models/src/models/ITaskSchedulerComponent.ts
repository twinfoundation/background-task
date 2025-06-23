// Copyright 2024 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import type { IComponent } from "@twin.org/core";
import type { IScheduledTaskInfo } from "./IScheduledTaskInfo";
import type { IScheduledTaskTime } from "./IScheduledTaskTime";

/**
 * Interface describing a task scheduler.
 */
export interface ITaskSchedulerComponent extends IComponent {
	/**
	 * Add a task to the scheduler.
	 * @param taskId The id of the task to add.
	 * @param times The times at which the task should be scheduled.
	 * @param taskCallback The callback to execute when the task is scheduled.
	 * @returns Nothing.
	 */
	addTask(
		taskId: string,
		times: IScheduledTaskTime[],
		taskCallback: () => Promise<void>
	): Promise<void>;

	/**
	 * Remove a task from the scheduler.
	 * @param taskId The id of the task to remove.
	 * @returns Nothing.
	 */
	removeTask(taskId: string): Promise<void>;

	/**
	 * Get the information about the tasks.
	 * @returns The tasks information.
	 */
	tasksInfo(): Promise<IScheduledTaskInfo>;
}

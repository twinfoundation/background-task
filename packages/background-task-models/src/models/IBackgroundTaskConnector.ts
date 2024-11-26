// Copyright 2024 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import type { IComponent } from "@twin.org/core";
import type { SortDirection } from "@twin.org/entity";
import type { IBackgroundTask } from "./IBackgroundTask";
import type { TaskStatus } from "./taskStatus";

/**
 * Interface describing a background task connector.
 */
export interface IBackgroundTaskConnector extends IComponent {
	/**
	 * Register a handler for a task.
	 * @param taskType The type of the task the handler can process.
	 * @param module The module the handler is in.
	 * @param method The method in the module to execute.
	 * @returns Nothing.
	 */
	registerHandler(taskType: string, module: string, method: string): Promise<void>;

	/**
	 * Unregister a handler for a task.
	 * @param taskType The type of the task handler to remove.
	 * @returns Nothing.
	 */
	unregisterHandler(taskType: string): Promise<void>;

	/**
	 * Create a new task.
	 * @param type The type of the task.
	 * @param payload The payload for the task.
	 * @param options Additional options for the task.
	 * @param options.retryCount The number of times to retry the task if it fails, leave undefined to retry forever.
	 * @param options.retryInterval The interval in milliseconds to wait between retries, defaults to 5000, leave undefined for default scheduling.
	 * @param options.retainFor The amount of time in milliseconds to retain the result until removal, defaults to 0 for immediate removal, set to -1 to keep forever.
	 * @returns The id of the created task.
	 */
	create<T>(
		type: string,
		payload?: T,
		options?: {
			retryCount?: number;
			retryInterval?: number;
			retainFor?: number;
		}
	): Promise<string>;

	/**
	 * Get the task details.
	 * @param taskId The id of the task to get the details for.
	 * @returns The details of the task.
	 */
	get<T, U>(taskId: string): Promise<IBackgroundTask<T, U> | undefined>;

	/**
	 * Retry a failed task immediately instead of waiting for it's next scheduled retry time.
	 * @param taskId The id of the task to retry.
	 * @returns Nothing.
	 */
	retry(taskId: string): Promise<void>;

	/**
	 * Remove a task ignoring any retain until date.
	 * @param taskId The id of the task to remove.
	 * @returns Nothing.
	 */
	remove(taskId: string): Promise<void>;

	/**
	 * Cancel a task, will only be actioned if the task is currently pending.
	 * @param taskId The id of the task to cancel.
	 * @returns Nothing.
	 */
	cancel(taskId: string): Promise<void>;

	/**
	 * Get a list of tasks.
	 * @param taskType The type of the task to get.
	 * @param taskStatus The status of the task to get.
	 * @param sortProperty The property to sort by, defaults to dateCreated.
	 * @param sortDirection The order to sort by, defaults to ascending.
	 * @param cursor The cursor to get the next page of tasks.
	 * @param pageSize The maximum number of entities in a page.
	 * @returns The list of tasks.
	 */
	query(
		taskType?: string,
		taskStatus?: TaskStatus,
		sortProperty?: "dateCreated" | "dateModified" | "dateCompleted" | "status",
		sortDirection?: SortDirection,
		cursor?: string,
		pageSize?: number
	): Promise<{
		entities: IBackgroundTask[];
		cursor?: string;
	}>;
}

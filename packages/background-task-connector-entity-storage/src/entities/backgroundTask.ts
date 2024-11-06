// Copyright 2024 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import type { TaskStatus } from "@twin.org/background-task-models";
import type { IError } from "@twin.org/core";
import { entity, property, SortDirection } from "@twin.org/entity";

/**
 * Class defining a background task.
 */
@entity()
export class BackgroundTask {
	/**
	 * The id.
	 */
	@property({ type: "string", isPrimary: true })
	public id!: string;

	/**
	 * The type of the task.
	 */
	@property({ type: "string", sortDirection: SortDirection.Ascending })
	public type!: string;

	/**
	 * The retry interval in milliseconds, undefined if default scheduling.
	 */
	@property({ type: "number" })
	public retryInterval?: number;

	/**
	 * The number of retries remaining, undefined if infinite retries.
	 */
	@property({ type: "number" })
	public retriesRemaining?: number;

	/**
	 * The date the task was created.
	 */
	@property({ type: "string", format: "date-time", sortDirection: SortDirection.Ascending })
	public dateCreated!: string;

	/**
	 * The date the task was last modified.
	 */
	@property({ type: "string", format: "date-time", sortDirection: SortDirection.Ascending })
	public dateModified!: string;

	/**
	 * The date the task is next to be processed.
	 */
	@property({ type: "string", format: "date-time", sortDirection: SortDirection.Ascending })
	public dateNextProcess?: string;

	/**
	 * The date the task was cancelled.
	 */
	@property({ type: "string", format: "date-time" })
	public dateCancelled?: string;

	/**
	 * The date the task was completed.
	 */
	@property({ type: "string", format: "date-time" })
	public dateCompleted?: string;

	/**
	 * The amount of time in milliseconds to retain the task after completion.
	 */
	@property({ type: "number" })
	public retainFor?: number;

	/**
	 * The timestamp of when to retain the task until.
	 */
	@property({ type: "number" })
	public retainUntil?: number;

	/**
	 * The status of the task.
	 */
	@property({ type: "string" })
	public status!: TaskStatus;

	/**
	 * The payload to execute the task with.
	 */
	@property({ type: "object" })
	public payload?: unknown;

	/**
	 * The result of the execution.
	 */
	@property({ type: "object" })
	public result?: unknown;

	/**
	 * The error at last execution.
	 */
	@property({ type: "object" })
	public error?: IError;
}

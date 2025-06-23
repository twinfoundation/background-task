// Copyright 2024 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import type { IScheduledTaskTime, ITaskSchedulerComponent } from "@twin.org/background-task-models";
import { BaseError, Is } from "@twin.org/core";
import { type ILoggingConnector, LoggingConnectorFactory } from "@twin.org/logging-models";
import { nameof } from "@twin.org/nameof";
import type { ITaskSchedulerConstructorOptions } from "./models/ITaskSchedulerConstructorOptions";
import type { IScheduledTaskInfo } from "../../background-task-models/dist/types/models/IScheduledTaskInfo";

/**
 * Class for performing task operations in entity storage.
 */
export class TaskScheduler implements ITaskSchedulerComponent {
	/**
	 * Runtime name for the class.
	 */
	public readonly CLASS_NAME: string = nameof<TaskScheduler>();

	/**
	 * The logger for the task connector.
	 * @internal
	 */
	private readonly _logging?: ILoggingConnector;

	/**
	 * The interval in milliseconds at which the tasks are checked.
	 * @internal
	 */
	private readonly _tickInterval: number;

	/**
	 * The tasks that are scheduled.
	 * @internal
	 */
	private readonly _tasks: {
		[id: string]: {
			times: IScheduledTaskTime[];
			taskCallback: () => Promise<void>;
		};
	};

	/**
	 * The timer for running scheduled tasks.
	 * @internal
	 */
	private _timer?: NodeJS.Timeout;

	/**
	 * Create a new instance of TaskScheduler.
	 * @param options The options for the scheduler.
	 */
	constructor(options?: ITaskSchedulerConstructorOptions) {
		this._logging = LoggingConnectorFactory.getIfExists(options?.loggingConnectorType ?? "logging");
		this._tasks = {};
		this._tickInterval = options?.config?.overrideInterval ?? 60 * 1000; // Default to 1 minute
	}

	/**
	 * The component needs to be stopped when the node is closed.
	 * @param nodeIdentity The identity of the node stopping the component.
	 * @param nodeLoggingConnectorType The node logging connector type, defaults to "node-logging".
	 * @param componentState A persistent state which can be modified by the method.
	 * @returns Nothing.
	 */
	public async stop(
		nodeIdentity: string,
		nodeLoggingConnectorType: string | undefined,
		componentState?: {
			[id: string]: unknown;
		}
	): Promise<void> {
		this.stopTimer();
	}

	/**
	 * Add a task to the scheduler.
	 * @param taskId The id of the task to add.
	 * @param times The times at which the task should be scheduled.
	 * @param taskCallback The callback to execute when the task is scheduled.
	 * @returns Nothing.
	 */
	public async addTask(
		taskId: string,
		times: IScheduledTaskTime[],
		taskCallback: () => Promise<void>
	): Promise<void> {
		this._tasks[taskId] = {
			times: times.map(time => ({
				...time,
				nextTriggerTime: Is.empty(time.nextTriggerTime)
					? this.calculateNextTriggerTime(time)
					: time.nextTriggerTime
			})),
			taskCallback
		};

		this._logging?.log({
			level: "info",
			source: this.CLASS_NAME,
			ts: Date.now(),
			message: "taskAdded",
			data: {
				id: taskId
			}
		});

		this.startTimer();
	}

	/**
	 * Remove a task from the scheduler.
	 * @param taskId The id of the task to remove.
	 * @returns Nothing.
	 */
	public async removeTask(taskId: string): Promise<void> {
		if (!Is.empty(this._tasks[taskId])) {
			this._logging?.log({
				level: "info",
				source: this.CLASS_NAME,
				ts: Date.now(),
				message: "taskRemoved",
				data: {
					id: taskId
				}
			});

			delete this._tasks[taskId];

			if (Object.keys(this._tasks).length === 0) {
				this.stopTimer();
			}
		}
	}

	/**
	 * Get the information about the tasks.
	 * @returns The tasks information.
	 */
	public async tasksInfo(): Promise<IScheduledTaskInfo> {
		const tasksInfo: IScheduledTaskInfo = {
			tasks: {}
		};
		for (const taskId in this._tasks) {
			tasksInfo.tasks[taskId] = this._tasks[taskId].times;
		}
		return tasksInfo;
	}

	/**
	 * Calculate the next run time for a task based on its scheduled times.
	 * @param time The times at which the task should be scheduled.
	 * @returns The update time with the next run.
	 * @internal
	 */
	private calculateNextTriggerTime(time: IScheduledTaskTime): number {
		let nextTriggerTime = time.nextTriggerTime;

		if (Is.empty(nextTriggerTime)) {
			nextTriggerTime = Date.now();
		}

		if (!Is.empty(time.intervalDays)) {
			nextTriggerTime += time.intervalDays * 24 * 60 * 60 * 1000;
		}

		if (!Is.empty(time.intervalHours)) {
			nextTriggerTime += time.intervalHours * 60 * 60 * 1000;
		}

		if (!Is.empty(time.intervalMinutes)) {
			nextTriggerTime += time.intervalMinutes * 60 * 1000;
		}

		return nextTriggerTime;
	}

	/**
	 * Start the timer for running scheduled tasks.
	 * @internal
	 */
	private startTimer(): void {
		if (Is.empty(this._timer)) {
			this._timer = setInterval(async () => this.triggerScheduledTasks(), this._tickInterval);
		}
	}

	/**
	 * Stop the timer for running scheduled tasks.
	 * @internal
	 */
	private stopTimer(): void {
		if (!Is.empty(this._timer)) {
			clearInterval(this._timer);
			this._timer = undefined;
		}
	}

	/**
	 * Trigger scheduled tasks based on their next run times.
	 * @internal
	 */
	private async triggerScheduledTasks(): Promise<void> {
		const now = Date.now();

		for (const taskId in this._tasks) {
			const task = this._tasks[taskId];

			for (const taskTime of task.times) {
				if (!Is.empty(taskTime.nextTriggerTime) && taskTime.nextTriggerTime <= now) {
					this._logging?.log({
						level: "info",
						source: this.CLASS_NAME,
						ts: Date.now(),
						message: "taskTriggered",
						data: {
							id: taskId,
							time: new Date(taskTime.nextTriggerTime).toISOString()
						}
					});

					try {
						await task.taskCallback();
					} catch (error) {
						this._logging?.log({
							level: "info",
							source: this.CLASS_NAME,
							ts: Date.now(),
							message: "taskFailed",
							data: {
								id: taskId
							},
							error: BaseError.fromError(error)
						});
					}

					// If the intervals are empty, we do not recalculate a next run time
					if (
						Is.empty(taskTime.intervalDays) &&
						Is.empty(taskTime.intervalHours) &&
						Is.empty(taskTime.intervalMinutes)
					) {
						taskTime.nextTriggerTime = undefined;
					} else {
						// Recalculate the next run time based on the current time and the intervals
						taskTime.nextTriggerTime = this.calculateNextTriggerTime(taskTime);
					}
				}
			}
		}
	}
}

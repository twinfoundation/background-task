// Copyright 2024 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import {
	type IBackgroundTask,
	type IBackgroundTaskConnector,
	TaskStatus
} from "@twin.org/background-task-models";
import {
	BaseError,
	Converter,
	GeneralError,
	Guards,
	type IError,
	Is,
	type IValidationFailure,
	ObjectHelper,
	RandomHelper,
	StringHelper,
	Urn,
	Validation
} from "@twin.org/core";
import { EngineCoreFactory } from "@twin.org/engine-models";
import {
	ComparisonOperator,
	type EntityCondition,
	LogicalOperator,
	SortDirection
} from "@twin.org/entity";
import {
	EntityStorageConnectorFactory,
	type IEntityStorageConnector
} from "@twin.org/entity-storage-models";
import { type ILoggingConnector, LoggingConnectorFactory } from "@twin.org/logging-models";
import { ModuleHelper } from "@twin.org/modules";
import { nameof } from "@twin.org/nameof";
import type { BackgroundTask } from "./entities/backgroundTask";
import type { IEntityStorageBackgroundTaskConnectorConfig } from "./models/IEntityStorageBackgroundTaskConnectorConfig";

/**
 * Class for performing background task operations in entity storage.
 */
export class EntityStorageBackgroundTaskConnector implements IBackgroundTaskConnector {
	/**
	 * The namespace supported by the background task connector.
	 */
	public static readonly NAMESPACE: string = "entity-storage";

	/**
	 * The default task interval in milliseconds.
	 * @internal
	 */
	private static readonly _DEFAULT_TASK_INTERVAL: number = 100;

	/**
	 * The default retry interval in milliseconds.
	 * @internal
	 */
	private static readonly _DEFAULT_RETRY_INTERVAL: number = 5000;

	/**
	 * The default cleanup interval in milliseconds.
	 * @internal
	 */
	private static readonly _DEFAULT_CLEANUP_INTERVAL: number = 120000;

	/**
	 * Runtime name for the class.
	 */
	public readonly CLASS_NAME: string = nameof<EntityStorageBackgroundTaskConnector>();

	/**
	 * The handlers for tasks.
	 * @internal
	 */
	private readonly _taskHandlers: {
		[taskType: string]: {
			module: string;
			method: string;
		};
	};

	/**
	 * The entity storage for the background tasks keys.
	 * @internal
	 */
	private readonly _backgroundTaskEntityStorageConnector: IEntityStorageConnector<BackgroundTask>;

	/**
	 * The logger for the background task connector.
	 * @internal
	 */
	private readonly _logging?: ILoggingConnector;

	/**
	 * The current task being processed.
	 * @internal
	 */
	private readonly _currentTasks: {
		[type: string]: {
			task?: IBackgroundTask;
			waitTimerId?: NodeJS.Timeout;
		};
	};

	/**
	 * Determine if the component has been started.
	 * @internal
	 */
	private _started: boolean;

	/**
	 * The last time the retained tasks were cleaned up
	 * @internal
	 */
	private _lastCleanup: number;

	/**
	 * The default interval to leave between tasks in milliseconds, defaults to 100ms.
	 * @internal
	 */
	private readonly _taskInterval: number;

	/**
	 * The default retry interval to leave between tasks in milliseconds, defaults to 5000ms.
	 * @internal
	 */
	private readonly _retryInterval: number;

	/**
	 * The default cleanup interval for removing retained tasks in milliseconds, defaults to 120000ms.
	 * @internal
	 */
	private readonly _cleanupInterval: number;

	/**
	 * The name of the engine to clone when creating a background task.
	 * @internal
	 */
	private readonly _engineName: string;

	/**
	 * Create a new instance of EntityStorageBackgroundTaskConnector.
	 * @param options The options for the connector.
	 * @param options.backgroundTaskEntityStorageType The background task entity storage connector type, defaults to "background-task".
	 * @param options.loggingConnectorType The logging connector type, defaults to "logging".
	 * @param options.config The configuration for the connector.
	 */
	constructor(options?: {
		backgroundTaskEntityStorageType?: string;
		loggingConnectorType?: string;
		config?: IEntityStorageBackgroundTaskConnectorConfig;
	}) {
		this._backgroundTaskEntityStorageConnector = EntityStorageConnectorFactory.get(
			options?.backgroundTaskEntityStorageType ?? "background-task"
		);
		this._logging = LoggingConnectorFactory.getIfExists(options?.loggingConnectorType ?? "logging");
		this._taskHandlers = {};
		this._currentTasks = {};
		this._started = false;
		this._lastCleanup = 0;

		const validationErrors: IValidationFailure[] = [];
		if (!Is.undefined(options?.config?.taskInterval)) {
			Guards.integer(
				this.CLASS_NAME,
				nameof(options.config.taskInterval),
				options.config.taskInterval
			);
			Validation.integer(
				nameof(options.config.taskInterval),
				options.config.taskInterval,
				validationErrors,
				undefined,
				{ minValue: 1 }
			);
		}
		if (!Is.undefined(options?.config?.retryInterval)) {
			Guards.integer(
				this.CLASS_NAME,
				nameof(options.config.retryInterval),
				options.config.retryInterval
			);
			Validation.integer(
				nameof(options.config.retryInterval),
				options.config.retryInterval,
				validationErrors,
				undefined,
				{ minValue: 1 }
			);
		}
		if (!Is.undefined(options?.config?.cleanupInterval)) {
			Guards.integer(
				this.CLASS_NAME,
				nameof(options.config.cleanupInterval),
				options.config.cleanupInterval
			);
			Validation.integer(
				nameof(options.config.cleanupInterval),
				options.config.cleanupInterval,
				validationErrors,
				undefined,
				{ minValue: 5000 }
			);
		}
		Validation.asValidationError(this.CLASS_NAME, nameof(options?.config), validationErrors);

		this._engineName = options?.config?.engineName ?? "engine";
		this._taskInterval =
			options?.config?.taskInterval ?? EntityStorageBackgroundTaskConnector._DEFAULT_TASK_INTERVAL;
		this._retryInterval =
			options?.config?.retryInterval ??
			EntityStorageBackgroundTaskConnector._DEFAULT_RETRY_INTERVAL;
		this._cleanupInterval =
			options?.config?.cleanupInterval ??
			EntityStorageBackgroundTaskConnector._DEFAULT_CLEANUP_INTERVAL;
	}

	/**
	 * The component needs to be started when the node is initialized.
	 * @param nodeIdentity The identity of the node starting the component.
	 * @param nodeLoggingConnectorType The node logging connector type, defaults to "node-logging".
	 * @returns Nothing.
	 */
	public async start(nodeIdentity: string, nodeLoggingConnectorType?: string): Promise<void> {
		this._started = true;

		await this.cleanupRetained();

		const types = Object.keys(this._taskHandlers);
		for (const type of types) {
			await this.processTasks(type);
		}
	}

	/**
	 * The component needs to be stopped when the node is closed.
	 * @param nodeIdentity The identity of the node stopping the component.
	 * @param nodeLoggingConnectorType The node logging connector type, defaults to "node-logging".
	 * @returns Nothing.
	 */
	public async stop(nodeIdentity: string, nodeLoggingConnectorType?: string): Promise<void> {
		this._started = false;

		const types = Object.keys(this._taskHandlers);
		for (const type of types) {
			if (this._currentTasks[type]?.waitTimerId) {
				clearTimeout(this._currentTasks[type].waitTimerId);
				delete this._currentTasks[type].waitTimerId;
			}
		}
	}

	/**
	 * Register a handler for a task.
	 * @param taskType The type of the task the handler can process.
	 * @param module The module the handler is in.
	 * @param method The method in the module to execute.
	 */
	public async registerHandler(taskType: string, module: string, method: string): Promise<void> {
		Guards.stringValue(this.CLASS_NAME, nameof(taskType), taskType);
		Guards.stringValue(this.CLASS_NAME, nameof(module), module);
		Guards.stringValue(this.CLASS_NAME, nameof(method), method);

		this._taskHandlers[taskType] = {
			module,
			method
		};

		if (this._started) {
			await this.processTasks(taskType);
		}
	}

	/**
	 * Unregister a handler for a task.
	 * @param taskType The type of the task handler to remove.
	 */
	public async unregisterHandler(taskType: string): Promise<void> {
		Guards.stringValue(this.CLASS_NAME, nameof(taskType), taskType);
		delete this._taskHandlers[taskType];
	}

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
	public async create<T>(
		type: string,
		payload?: T,
		options?: {
			retryCount?: number;
			retryInterval?: number;
			retainFor?: number;
		}
	): Promise<string> {
		Guards.stringValue(this.CLASS_NAME, nameof(type), type);

		const validationErrors: IValidationFailure[] = [];
		if (!Is.undefined(options?.retryCount)) {
			Guards.integer(this.CLASS_NAME, nameof(options.retryCount), options.retryCount);
			Validation.integer(
				nameof(options.retryCount),
				options.retryCount,
				validationErrors,
				undefined,
				{ minValue: 1 }
			);
		}
		if (!Is.undefined(options?.retryInterval)) {
			Guards.integer(this.CLASS_NAME, nameof(options.retryInterval), options.retryInterval);
			Validation.integer(
				nameof(options.retryInterval),
				options.retryInterval,
				validationErrors,
				undefined,
				{ minValue: 1 }
			);
		}
		if (!Is.undefined(options?.retainFor)) {
			Guards.integer(this.CLASS_NAME, nameof(options.retainFor), options.retainFor);
			Validation.integer(
				nameof(options.retainFor),
				options.retainFor,
				validationErrors,
				undefined,
				{ minValue: -1 }
			);
		}
		Validation.asValidationError(this.CLASS_NAME, nameof(options), validationErrors);

		const id = Converter.bytesToHex(RandomHelper.generate(16));

		const now = new Date(Date.now()).toISOString();

		const backgroundTask: BackgroundTask = {
			id,
			type,
			dateCreated: now,
			dateModified: now,
			dateNextProcess: now,
			retryInterval: options?.retryInterval,
			retainFor: options?.retainFor ?? 0,
			status: TaskStatus.Pending,
			retriesRemaining: options?.retryCount,
			payload: ObjectHelper.clone(payload)
		};

		await this._backgroundTaskEntityStorageConnector.set(backgroundTask);

		if (this._started) {
			await this.processTasks(type);
		}

		return `background-task:${EntityStorageBackgroundTaskConnector.NAMESPACE}:${id}`;
	}

	/**
	 * Get the task details.
	 * @param taskId The id of the task to get the details for.
	 * @returns The details of the task.
	 */
	public async get<T, U>(taskId: string): Promise<IBackgroundTask<T, U> | undefined> {
		Urn.guard(this.CLASS_NAME, nameof(taskId), taskId);

		const urnParsed = Urn.fromValidString(taskId);

		if (urnParsed.namespaceMethod() !== EntityStorageBackgroundTaskConnector.NAMESPACE) {
			throw new GeneralError(this.CLASS_NAME, "namespaceMismatch", {
				namespace: EntityStorageBackgroundTaskConnector.NAMESPACE,
				id: taskId
			});
		}

		const task = await this._backgroundTaskEntityStorageConnector.get(
			urnParsed.namespaceSpecific(1)
		);

		if (Is.object(task)) {
			return this.mapEntityToModel(task);
		}
	}

	/**
	 * Retry a failed task immediately instead of waiting for it's next scheduled retry time.
	 * @param taskId The id of the task to retry.
	 * @returns Nothing.
	 */
	public async retry(taskId: string): Promise<void> {
		Urn.guard(this.CLASS_NAME, nameof(taskId), taskId);

		const urnParsed = Urn.fromValidString(taskId);

		if (urnParsed.namespaceMethod() !== EntityStorageBackgroundTaskConnector.NAMESPACE) {
			throw new GeneralError(this.CLASS_NAME, "namespaceMismatch", {
				namespace: EntityStorageBackgroundTaskConnector.NAMESPACE,
				id: taskId
			});
		}

		const task = await this._backgroundTaskEntityStorageConnector.get(
			urnParsed.namespaceSpecific(1)
		);

		if (
			Is.object(task) &&
			Is.stringValue(task.dateNextProcess) &&
			task.status === TaskStatus.Pending
		) {
			task.dateNextProcess = new Date(Date.now()).toISOString();
			await this._backgroundTaskEntityStorageConnector.set(task);
		}
	}

	/**
	 * Remove a task ignoring any retain until date.
	 * @param taskId The id of the task to remove.
	 * @returns Nothing.
	 */
	public async remove(taskId: string): Promise<void> {
		Urn.guard(this.CLASS_NAME, nameof(taskId), taskId);

		const urnParsed = Urn.fromValidString(taskId);

		if (urnParsed.namespaceMethod() !== EntityStorageBackgroundTaskConnector.NAMESPACE) {
			throw new GeneralError(this.CLASS_NAME, "namespaceMismatch", {
				namespace: EntityStorageBackgroundTaskConnector.NAMESPACE,
				id: taskId
			});
		}

		const task = await this._backgroundTaskEntityStorageConnector.get(
			urnParsed.namespaceSpecific(1)
		);

		if (Is.object(task)) {
			await this._backgroundTaskEntityStorageConnector.remove(urnParsed.namespaceSpecific(1));
		}
	}

	/**
	 * Cancel a task, will only be actioned if the task is currently pending.
	 * @param taskId The id of the task to cancel.
	 * @returns Nothing.
	 */
	public async cancel(taskId: string): Promise<void> {
		Urn.guard(this.CLASS_NAME, nameof(taskId), taskId);

		const urnParsed = Urn.fromValidString(taskId);

		if (urnParsed.namespaceMethod() !== EntityStorageBackgroundTaskConnector.NAMESPACE) {
			throw new GeneralError(this.CLASS_NAME, "namespaceMismatch", {
				namespace: EntityStorageBackgroundTaskConnector.NAMESPACE,
				id: taskId
			});
		}

		const task = await this._backgroundTaskEntityStorageConnector.get(
			urnParsed.namespaceSpecific(1)
		);

		if (Is.object(task) && task.status === TaskStatus.Pending) {
			task.status = TaskStatus.Cancelled;
			task.dateCancelled = new Date(Date.now()).toISOString();
			task.dateNextProcess = undefined;
			task.retainUntil = this.calculateRetainTimestamp(task);
			await this._backgroundTaskEntityStorageConnector.set(task);
		}
	}

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
	public async query(
		taskType?: string,
		taskStatus?: TaskStatus,
		sortProperty?: "dateCreated" | "dateModified" | "dateCompleted" | "status",
		sortDirection?: SortDirection,
		cursor?: string,
		pageSize?: number
	): Promise<{
		entities: IBackgroundTask[];
		cursor?: string;
	}> {
		const result = await this.internalQuery(
			taskType,
			taskStatus ? [taskStatus] : undefined,
			sortProperty,
			sortDirection,
			cursor,
			pageSize
		);

		return {
			entities: result.entities.map(t => this.mapEntityToModel(t)),
			cursor: result.cursor
		};
	}

	/**
	 * Get a list of tasks.
	 * @param taskType The type of the task to get.
	 * @param taskStatuses The status of the task to get.
	 * @param sortProperty The property to sort by, defaults to dateCreated.
	 * @param sortDirection The order to sort by, defaults to ascending.
	 * @param cursor The cursor to get the next page of tasks.
	 * @param pageSize The maximum number of entities in a page.
	 * @returns The list of tasks.
	 * @internal
	 */
	private async internalQuery(
		taskType?: string,
		taskStatuses?: TaskStatus[],
		sortProperty?: "dateCreated" | "dateModified" | "dateCompleted" | "dateNextProcess" | "status",
		sortDirection?: SortDirection,
		cursor?: string,
		pageSize?: number
	): Promise<{
		entities: BackgroundTask[];
		cursor?: string;
	}> {
		const condition: EntityCondition<BackgroundTask> = {
			conditions: [],
			logicalOperator: LogicalOperator.And
		};

		if (Is.stringValue(taskType)) {
			condition.conditions.push({
				property: "type",
				comparison: ComparisonOperator.Equals,
				value: taskType
			});
		}

		if (Is.arrayValue(taskStatuses)) {
			const statusCondition: EntityCondition<BackgroundTask> = {
				conditions: [],
				logicalOperator: LogicalOperator.Or
			};
			for (const taskStatus of taskStatuses) {
				if (Is.arrayOneOf(taskStatus, Object.values(TaskStatus))) {
					statusCondition.conditions.push({
						property: "status",
						comparison: ComparisonOperator.Equals,
						value: taskStatus
					});
				}
			}
			condition.conditions.push(statusCondition);
		}

		const result = await this._backgroundTaskEntityStorageConnector.query(
			condition,
			[
				{
					property: sortProperty ?? "dateCreated",
					sortDirection: sortDirection ?? SortDirection.Descending
				}
			],
			undefined,
			cursor,
			pageSize
		);

		return {
			entities: result.entities as BackgroundTask[],
			cursor: result.cursor
		};
	}

	/**
	 * Map the entity to a model.
	 * @param task The task to map to the model.
	 * @returns The task model.
	 * @internal
	 */
	private mapEntityToModel<T, U>(task: BackgroundTask): IBackgroundTask<T, U> {
		return {
			id: task.id,
			type: task.type,
			dateCreated: task.dateCreated,
			dateModified: task.dateModified,
			dateCompleted: task.dateCompleted,
			dateCancelled: task.dateCancelled,
			dateRetainUntil: Is.integer(task.retainUntil)
				? new Date(task.retainUntil).toISOString()
				: undefined,
			retryInterval: task.retryInterval,
			retriesRemaining: task.retriesRemaining,
			status: task.status,
			payload: task.payload as T,
			result: task.result as U,
			error: task.error
		};
	}

	/**
	 * Calculate the retain timestamp for the task.
	 * @param task The task to calculate the retain timestamp.
	 * @returns The retain timestamp or undefined if not is calculated.
	 * @internal
	 */
	private calculateRetainTimestamp(task: BackgroundTask): number | undefined {
		let retainTimestamp: number | undefined;

		// We only calculate a retain timestamp if the task is in a completion state
		// and has a length of time set for how long to retain it
		// If the retain time is -1 that means retain forever, these tasks can
		// still be removed with a manual remove call
		if (
			(task.status === TaskStatus.Success ||
				task.status === TaskStatus.Cancelled ||
				task.status === TaskStatus.Failed) &&
			Is.integer(task.retainFor)
		) {
			if (task.retainFor > 0) {
				retainTimestamp = new Date(task.dateModified).getTime() + task.retainFor;
			} else if (task.retainFor === -1) {
				retainTimestamp = -1;
			}
		}

		return retainTimestamp;
	}

	/**
	 * Process the tasks of the specified type.
	 * @param taskType The type of the task to process.
	 * @internal
	 */
	private async processTasks(taskType: string): Promise<void> {
		// Only start a new task processing if there is not already a task being processed.
		if (this._started) {
			if (Is.undefined(this._currentTasks[taskType]?.task)) {
				this._currentTasks[taskType] ??= {};

				// If there is a wait time for this task type then clear it up
				const waitTimerId = this._currentTasks[taskType]?.waitTimerId;
				if (!Is.undefined(waitTimerId)) {
					clearTimeout(waitTimerId);
					delete this._currentTasks[taskType].waitTimerId;
				}

				// If there is a processing task from a previous run, we need to finish up handling that first.
				// we sort by dateNextProcess so that anything that failed or is in a retry state will get processed
				// in the correct order.
				const processingTasks = await this.internalQuery(
					taskType,
					[TaskStatus.Processing, TaskStatus.Pending],
					"dateNextProcess",
					SortDirection.Ascending,
					undefined,
					1
				);
				if (processingTasks.entities.length > 0) {
					const nextTask = processingTasks.entities[0];

					// All tasks with processing or pending status should have next process set
					if (Is.stringValue(nextTask.dateNextProcess)) {
						// If we haven't reached the earliest next process time, we need to wait until then.
						// any new tasks added in the interim will automatically retrigger this
						const now = Date.now();
						const nextProcess = new Date(nextTask.dateNextProcess).getTime();

						// Already reached the epoch for the next item, so process it now.
						if (nextProcess <= now) {
							await this.processTask(nextTask);
						} else {
							// Otherwise, wait until the next process time.
							this._currentTasks[taskType].waitTimerId = setTimeout(
								async () => this.processTasks(taskType),
								nextProcess - now
							);
						}
					}
				}
			}

			await this.cleanupRetained();
		}
	}

	/**
	 * Process the task.
	 * @internal
	 */
	private async processTask(task: BackgroundTask): Promise<void> {
		if (this._taskHandlers[task.type]) {
			let taskError: IError | undefined;
			try {
				// Immediately set the task to processing to prevent multiple instances of the same task running.
				task.status = TaskStatus.Processing;
				task.dateModified = new Date(Date.now()).toISOString();
				await this._backgroundTaskEntityStorageConnector.set(task);
				this._currentTasks[task.type].task = task;

				this._logging?.log({
					level: "info",
					source: this.CLASS_NAME,
					ts: Date.now(),
					message: "start",
					data: {
						id: task.id,
						type: task.type
					}
				});

				// Get the clone data for the current engine
				const engine = EngineCoreFactory.getIfExists(this._engineName);
				const engineCloneData = engine?.getCloneData();

				// Execute the task, if it throws we will catch this and store it as a failure
				const result = await ModuleHelper.execModuleMethodThread(
					this._taskHandlers[task.type].module,
					this._taskHandlers[task.type].method,
					Is.empty(task.payload) ? [engineCloneData] : [engineCloneData, task.payload]
				);

				// No error so set the result and complete the task.
				task.result = result;
				task.status = TaskStatus.Success;
				task.dateNextProcess = undefined;
				task.dateCompleted = new Date(Date.now()).toISOString();
				delete task.retriesRemaining;
				delete task.retryInterval;
				delete task.error;
			} catch (err) {
				// Task handler threw an error, so set the error which will trigger a retry if needed.
				taskError = BaseError.fromError(err).toJsonObject();
				if (
					taskError.message === `${StringHelper.camelCase(nameof(ModuleHelper))}.workerException` &&
					!Is.empty(taskError.inner)
				) {
					taskError = BaseError.fromError(taskError.inner).toJsonObject();
				}
			}

			// If there is an error, set the task to failed and handle retries if needed.
			if (Is.object(taskError)) {
				task.error = taskError;

				// If there are retries remaining, set the task to pending and schedule the next retry.
				if (Is.integer(task.retriesRemaining) && task.retriesRemaining > 0) {
					task.status = TaskStatus.Pending;
					task.retriesRemaining--;
					const nextRetryMs = task.retryInterval ?? this._retryInterval;
					task.dateNextProcess = new Date(
						new Date(task.dateModified).getTime() + nextRetryMs
					).toISOString();
				} else {
					// Otherwise set the task to failed.
					task.status = TaskStatus.Failed;
					task.dateCompleted = new Date(Date.now()).toISOString();
					task.dateNextProcess = undefined;
				}
			}

			// If the retainFor is 0, the default, it should be removed immediately.
			// If the retainFor is -1, it should be retained forever.
			// If it has a value in milliseconds, it should be retained until the retainUntil date.
			if (task.retainFor === 0) {
				await this._backgroundTaskEntityStorageConnector.remove(task.id);
			} else {
				task.retainUntil = this.calculateRetainTimestamp(task);
				if (Is.integer(task.retainUntil)) {
					delete task.retainFor;
				}
				await this._backgroundTaskEntityStorageConnector.set(task);
			}

			this._logging?.log({
				level: "info",
				source: this.CLASS_NAME,
				ts: Date.now(),
				message: "complete",
				data: {
					id: task.id,
					type: task.type,
					status: task.status
				}
			});

			// Start processing of next task after a short interval
			delete this._currentTasks[task.type].task;
			setTimeout(async () => this.processTasks(task.type), this._taskInterval);
		} else {
			this._logging?.log({
				level: "error",
				source: this.CLASS_NAME,
				ts: Date.now(),
				message: "noHandler",
				data: {
					id: task.id,
					type: task.type
				}
			});
		}
	}

	/**
	 * Cleanup the retained tasks.
	 * @internal
	 */
	private async cleanupRetained(): Promise<void> {
		try {
			const now = Date.now();

			// Cleanup every minute
			if (now - this._lastCleanup < this._cleanupInterval) {
				return;
			}

			this._lastCleanup = now;

			let cursor: string | undefined;

			do {
				const result = await this._backgroundTaskEntityStorageConnector.query({
					conditions: [
						{
							property: "retainUntil",
							value: 0,
							comparison: ComparisonOperator.GreaterThan
						},
						{
							property: "retainUntil",
							value: now,
							comparison: ComparisonOperator.LessThan
						},
						{
							conditions: [
								{
									property: "status",
									value: TaskStatus.Success,
									comparison: ComparisonOperator.Equals
								},
								{
									property: "status",
									value: TaskStatus.Failed,
									comparison: ComparisonOperator.Equals
								},
								{
									property: "status",
									value: TaskStatus.Cancelled,
									comparison: ComparisonOperator.Equals
								}
							],
							logicalOperator: LogicalOperator.Or
						}
					]
				});
				cursor = result.cursor;

				for (const entity of result.entities) {
					await this._backgroundTaskEntityStorageConnector.remove(entity.id as string);
				}
			} while (Is.stringValue(cursor));
		} catch {
			// If cleaning up the retained items fail we don't really care, they will get cleaned up on the next sweep.
		}
	}
}

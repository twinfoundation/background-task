// Copyright 2024 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import { GeneralError, RandomHelper } from "@twin.org/core";
import { SortDirection } from "@twin.org/entity";
import { MemoryEntityStorageConnector } from "@twin.org/entity-storage-connector-memory";
import { EntityStorageConnectorFactory } from "@twin.org/entity-storage-models";
import { nameof } from "@twin.org/nameof";
import type { BackgroundTask } from "../src/entities/backgroundTask";
import { EntityStorageBackgroundTaskConnector } from "../src/entityStorageBackgroundTaskConnector";
import { initSchema } from "../src/schema";

const FIRST_TIMESTAMP = 1724327000000;

let backgroundTaskEntityStorageConnector: MemoryEntityStorageConnector<BackgroundTask>;

/**
 * Tes payload for testing.
 */
interface TestPayload {
	/**
	 * The id of the item.
	 */
	id: number;

	/**
	 * The counter.
	 */
	counter: number;
}

/**
 * Dummy result for testing.
 */
interface TestResult {
	/**
	 * The result.
	 */
	res: string;
}

/**
 * Wait for status.
 * @param status The status to wait for.
 * @param itemIndex The item index to wait for.
 */
async function waitForStatus(status: string, itemIndex: number = 0): Promise<void> {
	for (let i = 0; i < 500; i++) {
		await new Promise(resolve => setTimeout(resolve, 100));
		if (backgroundTaskEntityStorageConnector.getStore()[itemIndex]?.status === status) {
			break;
		}
	}
}

const originalTimeout = globalThis.setTimeout;

describe("EntityStorageBackgroundTaskConnector", () => {
	beforeAll(() => {
		initSchema();
	});

	beforeEach(() => {
		backgroundTaskEntityStorageConnector = new MemoryEntityStorageConnector<BackgroundTask>({
			entitySchema: nameof<BackgroundTask>()
		});

		EntityStorageConnectorFactory.register(
			"background-task",
			() => backgroundTaskEntityStorageConnector
		);

		const mockNow = vi.fn();

		let timeCounter: number = 0;
		mockNow.mockImplementation(() => FIRST_TIMESTAMP + timeCounter++);
		Date.now = mockNow;

		const mockRandom = vi.fn();

		for (let k = 0; k < 50; k++) {
			mockRandom.mockImplementationOnce(length => new Uint8Array(length).fill(k));
		}

		RandomHelper.generate = mockRandom;

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(globalThis.setTimeout as any) = vi.fn().mockImplementation((method, interval) => {
			// Perform a timewarp based on the timeout interval
			timeCounter += interval;
			originalTimeout(method, 0);
		});
	});

	afterEach(() => {
		EntityStorageConnectorFactory.unregister("background-task");
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(globalThis.setTimeout as any) = originalTimeout;
	});

	test("can construct with dependencies", async () => {
		const backgroundTaskConnector = new EntityStorageBackgroundTaskConnector();

		expect(backgroundTaskConnector).toBeDefined();
	});

	test("can create a task with no handler", async () => {
		const backgroundTaskConnector = new EntityStorageBackgroundTaskConnector();

		await backgroundTaskConnector.start("");
		await backgroundTaskConnector.create("my-type");

		const store = backgroundTaskEntityStorageConnector.getStore();
		expect(store).toEqual([
			{
				dateCreated: "2024-08-22T11:43:20.001Z",
				dateModified: "2024-08-22T11:43:20.001Z",
				dateNextProcess: "2024-08-22T11:43:20.001Z",
				id: "00000000000000000000000000000000",
				retainFor: 0,
				status: "pending",
				type: "my-type"
			}
		]);
	});

	test("can create a task with handler and no retainment", async () => {
		const backgroundTaskConnector = new EntityStorageBackgroundTaskConnector();

		await backgroundTaskConnector.registerHandler<TestPayload, TestResult>(
			"my-type",
			async payload => {
				payload.counter++;
				return { res: "ok" };
			}
		);

		await backgroundTaskConnector.start("");
		await backgroundTaskConnector.create("my-type", { counter: 0 });

		const store = backgroundTaskEntityStorageConnector.getStore();
		expect(store).toEqual([]);
	});

	test("can create a task with handler and retainment", async () => {
		const backgroundTaskConnector = new EntityStorageBackgroundTaskConnector();

		await backgroundTaskConnector.registerHandler<TestPayload, TestResult>(
			"my-type",
			async payload => {
				payload.counter++;
				return { res: "ok" };
			}
		);

		await backgroundTaskConnector.start("");
		await backgroundTaskConnector.create("my-type", { counter: 0 }, { retainFor: 10000 });

		const store = backgroundTaskEntityStorageConnector.getStore();
		expect(store).toEqual([
			{
				id: "00000000000000000000000000000000",
				dateCreated: "2024-08-22T11:43:20.002Z",
				dateModified: "2024-08-22T11:43:20.004Z",
				dateCompleted: "2024-08-22T11:43:20.005Z",
				payload: {
					counter: 1
				},
				result: {
					res: "ok"
				},
				retainUntil: 1724327010004,
				status: "success",
				type: "my-type"
			}
		]);
	});

	test("can create a task with handler and retainment with error and no retries", async () => {
		const backgroundTaskConnector = new EntityStorageBackgroundTaskConnector();

		await backgroundTaskConnector.registerHandler<TestPayload, TestResult>(
			"my-type",
			async payload => {
				throw new GeneralError("Test", "error");
			}
		);

		await backgroundTaskConnector.start("");
		await backgroundTaskConnector.create("my-type", { counter: 0 }, { retainFor: 10000 });

		const store = backgroundTaskEntityStorageConnector.getStore();
		delete store[0]?.error?.stack;
		expect(store).toEqual([
			{
				id: "00000000000000000000000000000000",
				type: "my-type",
				dateCreated: "2024-08-22T11:43:20.002Z",
				dateModified: "2024-08-22T11:43:20.004Z",
				dateCompleted: "2024-08-22T11:43:20.005Z",
				retainUntil: 1724327010004,
				status: "failed",
				payload: {
					counter: 0
				},
				error: {
					source: "Test",
					name: "GeneralError",
					message: "test.error"
				}
			}
		]);
	});

	test("can create a task with handler and retainment with error and single retry", async () => {
		const backgroundTaskConnector = new EntityStorageBackgroundTaskConnector();

		let counter = 0;
		await backgroundTaskConnector.registerHandler<TestPayload, TestResult>(
			"my-type",
			async payload => {
				if (counter === 0) {
					counter++;
					throw new GeneralError("Test", "error");
				}
				payload.counter++;
				return { res: "ok" };
			}
		);

		await backgroundTaskConnector.start("");
		await backgroundTaskConnector.create(
			"my-type",
			{ counter: 0 },
			{ retainFor: 10000, retryCount: 1, retryInterval: 1000 }
		);

		let store = backgroundTaskEntityStorageConnector.getStore();
		delete store[0]?.error?.stack;
		expect(store).toEqual([
			{
				id: "00000000000000000000000000000000",
				type: "my-type",
				dateCreated: "2024-08-22T11:43:20.002Z",
				dateModified: "2024-08-22T11:43:20.004Z",
				dateNextProcess: "2024-08-22T11:43:21.004Z",
				retryInterval: 1000,
				retainFor: 10000,
				status: "pending",
				retriesRemaining: 0,
				payload: {
					counter: 0
				},
				error: {
					name: "GeneralError",
					source: "Test",
					message: "test.error"
				}
			}
		]);

		await waitForStatus("success");

		store = backgroundTaskEntityStorageConnector.getStore();

		expect(store).toEqual([
			{
				id: "00000000000000000000000000000000",
				type: "my-type",
				dateCreated: "2024-08-22T11:43:20.002Z",
				dateModified: "2024-08-22T11:43:21.107Z",
				dateCompleted: "2024-08-22T11:43:21.108Z",
				retainUntil: 1724327011107,
				status: "success",
				payload: {
					counter: 1
				},
				result: {
					res: "ok"
				}
			}
		]);
	});

	test("can add multiple tasks and process them in order", async () => {
		const backgroundTaskConnector = new EntityStorageBackgroundTaskConnector();

		let counter = 0;
		await backgroundTaskConnector.registerHandler<TestPayload, TestResult>(
			"my-type",
			async payload => {
				payload.counter = counter++;
				return { res: "ok" };
			}
		);

		await backgroundTaskConnector.start("");

		for (let i = 0; i < 5; i++) {
			await backgroundTaskConnector.create("my-type", { id: i, counter: 0 }, { retainFor: 10000 });
		}

		await waitForStatus("success", 4);

		const store = backgroundTaskEntityStorageConnector.getStore();
		expect(store).toEqual([
			{
				id: "00000000000000000000000000000000",
				type: "my-type",
				dateCreated: "2024-08-22T11:43:20.002Z",
				dateModified: "2024-08-22T11:43:20.004Z",
				status: "success",
				payload: {
					id: 0,
					counter: 0
				},
				result: {
					res: "ok"
				},
				dateCompleted: "2024-08-22T11:43:20.005Z",
				retainUntil: 1724327010004
			},
			{
				id: "01010101010101010101010101010101",
				type: "my-type",
				dateCreated: "2024-08-22T11:43:20.107Z",
				dateModified: "2024-08-22T11:43:20.109Z",
				status: "success",
				payload: {
					id: 1,
					counter: 1
				},
				result: {
					res: "ok"
				},
				dateCompleted: "2024-08-22T11:43:20.110Z",
				retainUntil: 1724327010109
			},
			{
				id: "02020202020202020202020202020202",
				type: "my-type",
				dateCreated: "2024-08-22T11:43:20.212Z",
				dateModified: "2024-08-22T11:43:20.214Z",
				status: "success",
				payload: {
					id: 2,
					counter: 2
				},
				result: {
					res: "ok"
				},
				dateCompleted: "2024-08-22T11:43:20.215Z",
				retainUntil: 1724327010214
			},
			{
				id: "03030303030303030303030303030303",
				type: "my-type",
				dateCreated: "2024-08-22T11:43:20.317Z",
				dateModified: "2024-08-22T11:43:20.319Z",
				status: "success",
				payload: {
					id: 3,
					counter: 3
				},
				result: {
					res: "ok"
				},
				dateCompleted: "2024-08-22T11:43:20.320Z",
				retainUntil: 1724327010319
			},
			{
				id: "04040404040404040404040404040404",
				type: "my-type",
				dateCreated: "2024-08-22T11:43:20.422Z",
				dateModified: "2024-08-22T11:43:20.424Z",
				status: "success",
				payload: {
					id: 4,
					counter: 4
				},
				result: {
					res: "ok"
				},
				dateCompleted: "2024-08-22T11:43:20.425Z",
				retainUntil: 1724327010424
			}
		]);
	});

	test("can add multiple tasks and process them in order, when one item fails and no retry", async () => {
		const backgroundTaskConnector = new EntityStorageBackgroundTaskConnector();

		let hasErrored = false;
		let counter = 0;
		await backgroundTaskConnector.registerHandler<TestPayload, TestResult>(
			"my-type",
			async payload => {
				if (payload.id === 2 && !hasErrored) {
					hasErrored = true;
					throw new GeneralError("Test", "error");
				}
				payload.counter = counter++;
				return { res: "ok" };
			}
		);

		await backgroundTaskConnector.start("");
		for (let i = 0; i < 5; i++) {
			await backgroundTaskConnector.create("my-type", { id: i, counter: 0 }, { retainFor: 10000 });
		}

		await waitForStatus("success", 4);

		const store = backgroundTaskEntityStorageConnector.getStore();
		delete store[2]?.error?.stack;

		expect(store).toEqual([
			{
				id: "00000000000000000000000000000000",
				type: "my-type",
				dateCreated: "2024-08-22T11:43:20.002Z",
				dateModified: "2024-08-22T11:43:20.004Z",
				status: "success",
				payload: {
					id: 0,
					counter: 0
				},
				result: {
					res: "ok"
				},
				dateCompleted: "2024-08-22T11:43:20.005Z",
				retainUntil: 1724327010004
			},
			{
				id: "01010101010101010101010101010101",
				type: "my-type",
				dateCreated: "2024-08-22T11:43:20.107Z",
				dateModified: "2024-08-22T11:43:20.109Z",
				status: "success",
				payload: {
					id: 1,
					counter: 1
				},
				result: {
					res: "ok"
				},
				dateCompleted: "2024-08-22T11:43:20.110Z",
				retainUntil: 1724327010109
			},
			{
				id: "02020202020202020202020202020202",
				type: "my-type",
				dateCreated: "2024-08-22T11:43:20.212Z",
				dateModified: "2024-08-22T11:43:20.214Z",
				status: "failed",
				payload: {
					id: 2,
					counter: 0
				},
				error: {
					name: "GeneralError",
					source: "Test",
					message: "test.error"
				},
				dateCompleted: "2024-08-22T11:43:20.215Z",
				retainUntil: 1724327010214
			},
			{
				id: "03030303030303030303030303030303",
				type: "my-type",
				dateCreated: "2024-08-22T11:43:20.317Z",
				dateModified: "2024-08-22T11:43:20.319Z",
				status: "success",
				payload: {
					id: 3,
					counter: 2
				},
				result: {
					res: "ok"
				},
				dateCompleted: "2024-08-22T11:43:20.320Z",
				retainUntil: 1724327010319
			},
			{
				id: "04040404040404040404040404040404",
				type: "my-type",
				dateCreated: "2024-08-22T11:43:20.422Z",
				dateModified: "2024-08-22T11:43:20.424Z",
				status: "success",
				payload: {
					id: 4,
					counter: 3
				},
				result: {
					res: "ok"
				},
				dateCompleted: "2024-08-22T11:43:20.425Z",
				retainUntil: 1724327010424
			}
		]);
	});

	test("can add multiple tasks and process them in order, when one item fails and retry", async () => {
		const backgroundTaskConnector = new EntityStorageBackgroundTaskConnector({
			config: { taskInterval: 500 }
		});

		let hasErrored = false;
		let counter = 0;
		await backgroundTaskConnector.registerHandler<TestPayload, TestResult>(
			"my-type",
			async payload => {
				if (payload.id === 2 && !hasErrored) {
					hasErrored = true;
					throw new GeneralError("Test", "error");
				}
				payload.counter = counter++;
				return { res: "ok" };
			}
		);

		await backgroundTaskConnector.start("");
		for (let i = 0; i < 5; i++) {
			await backgroundTaskConnector.create(
				"my-type",
				{ id: i, counter: 0 },
				{ retainFor: 10000, retryCount: 1, retryInterval: 3000 }
			);
		}

		await waitForStatus("success", 2);

		const store = backgroundTaskEntityStorageConnector.getStore();
		delete store[2]?.error?.stack;
		expect(store).toEqual([
			{
				id: "00000000000000000000000000000000",
				type: "my-type",
				dateCreated: "2024-08-22T11:43:20.002Z",
				dateModified: "2024-08-22T11:43:20.004Z",
				status: "success",
				payload: {
					id: 0,
					counter: 0
				},
				result: {
					res: "ok"
				},
				dateCompleted: "2024-08-22T11:43:20.005Z",
				retainUntil: 1724327010004
			},
			{
				id: "01010101010101010101010101010101",
				type: "my-type",
				dateCreated: "2024-08-22T11:43:20.507Z",
				dateModified: "2024-08-22T11:43:20.509Z",
				status: "success",
				payload: {
					id: 1,
					counter: 1
				},
				result: {
					res: "ok"
				},
				dateCompleted: "2024-08-22T11:43:20.510Z",
				retainUntil: 1724327010509
			},
			{
				id: "02020202020202020202020202020202",
				type: "my-type",
				dateCreated: "2024-08-22T11:43:21.012Z",
				dateModified: "2024-08-22T11:43:24.017Z",
				status: "success",
				payload: {
					id: 2,
					counter: 4
				},
				retainUntil: 1724327014017,
				result: {
					res: "ok"
				},
				dateCompleted: "2024-08-22T11:43:24.018Z"
			},
			{
				id: "03030303030303030303030303030303",
				type: "my-type",
				dateCreated: "2024-08-22T11:43:21.516Z",
				dateModified: "2024-08-22T11:43:21.518Z",
				status: "success",
				payload: {
					id: 3,
					counter: 2
				},
				result: {
					res: "ok"
				},
				dateCompleted: "2024-08-22T11:43:21.519Z",
				retainUntil: 1724327011518
			},
			{
				id: "04040404040404040404040404040404",
				type: "my-type",
				dateCreated: "2024-08-22T11:43:22.021Z",
				dateModified: "2024-08-22T11:43:22.023Z",
				status: "success",
				payload: {
					id: 4,
					counter: 3
				},
				result: {
					res: "ok"
				},
				dateCompleted: "2024-08-22T11:43:22.024Z",
				retainUntil: 1724327012023
			}
		]);

		const completedOrder = await backgroundTaskConnector.query(
			"my-type",
			"success",
			"dateCompleted",
			SortDirection.Ascending
		);
		expect(completedOrder.entities.length).toBe(5);
		expect(completedOrder.entities[0].id).toBe("00000000000000000000000000000000");
		expect(completedOrder.entities[1].id).toBe("01010101010101010101010101010101");
		expect(completedOrder.entities[2].id).toBe("03030303030303030303030303030303");
		expect(completedOrder.entities[3].id).toBe("04040404040404040404040404040404");
		expect(completedOrder.entities[4].id).toBe("02020202020202020202020202020202");
	});

	test("can create a task and cancel it", async () => {
		const backgroundTaskConnector = new EntityStorageBackgroundTaskConnector({
			config: { taskInterval: 1000 }
		});

		await backgroundTaskConnector.registerHandler<TestPayload, TestResult>(
			"my-type",
			async payload => {
				throw new GeneralError("Test", "error");
			}
		);

		await backgroundTaskConnector.start("");
		const id = await backgroundTaskConnector.create(
			"my-type",
			{ counter: 0 },
			{ retryCount: 10, retryInterval: 10000, retainFor: 10000 }
		);

		await backgroundTaskConnector.cancel(id);

		const store = backgroundTaskEntityStorageConnector.getStore();
		delete store[0]?.error?.stack;

		expect(store).toEqual([
			{
				id: "00000000000000000000000000000000",
				type: "my-type",
				dateCreated: "2024-08-22T11:43:20.002Z",
				dateModified: "2024-08-22T11:43:20.004Z",
				retryInterval: 10000,
				retainFor: 10000,
				status: "cancelled",
				retriesRemaining: 9,
				payload: {
					counter: 0
				},
				error: {
					name: "GeneralError",
					source: "Test",
					message: "test.error"
				},
				retainUntil: 1724327010004,
				dateCancelled: "2024-08-22T11:43:21.006Z"
			}
		]);
	});

	test("can cleanup retained items when passed their retained date", async () => {
		const backgroundTaskConnector = new EntityStorageBackgroundTaskConnector({
			config: { taskInterval: 1000 }
		});

		await backgroundTaskEntityStorageConnector.set({
			id: "00000000000000000000000000000000",
			type: "my-type",
			dateCreated: "2024-08-22T11:43:20.002Z",
			dateModified: "2024-08-22T11:43:20.004Z",
			retryInterval: 10000,
			retainFor: 10000,
			status: "success",
			retriesRemaining: 9,
			payload: {
				counter: 0
			},
			retainUntil: FIRST_TIMESTAMP - 1
		});

		await backgroundTaskConnector.start("");

		const store = backgroundTaskEntityStorageConnector.getStore();
		expect(store.length).toEqual(0);
	});

	test("can not cleanup retained items when equalling their retained date", async () => {
		const backgroundTaskConnector = new EntityStorageBackgroundTaskConnector({
			config: { taskInterval: 1000 }
		});

		await backgroundTaskEntityStorageConnector.set({
			id: "00000000000000000000000000000000",
			type: "my-type",
			dateCreated: "2024-08-22T11:43:20.002Z",
			dateModified: "2024-08-22T11:43:20.004Z",
			retryInterval: 10000,
			retainFor: 10000,
			status: "success",
			retriesRemaining: 9,
			payload: {
				counter: 0
			},
			retainUntil: FIRST_TIMESTAMP
		});

		await backgroundTaskConnector.start("");

		const store = backgroundTaskEntityStorageConnector.getStore();
		expect(store.length).toEqual(1);
	});

	test("can not cleanup retained items when no retained date set", async () => {
		const backgroundTaskConnector = new EntityStorageBackgroundTaskConnector({
			config: { taskInterval: 1000 }
		});

		await backgroundTaskEntityStorageConnector.set({
			id: "00000000000000000000000000000000",
			type: "my-type",
			dateCreated: "2024-08-22T11:43:20.002Z",
			dateModified: "2024-08-22T11:43:20.004Z",
			retryInterval: 10000,
			retainFor: 10000,
			status: "success",
			retriesRemaining: 9,
			payload: {
				counter: 0
			}
		});

		await backgroundTaskConnector.start("");

		const store = backgroundTaskEntityStorageConnector.getStore();
		expect(store.length).toEqual(1);
	});
});

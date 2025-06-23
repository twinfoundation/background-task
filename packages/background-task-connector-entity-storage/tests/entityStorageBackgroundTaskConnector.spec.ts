// Copyright 2024 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import path from "node:path";
import { RandomHelper } from "@twin.org/core";
import { EngineCore } from "@twin.org/engine-core";
import { EngineCoreFactory } from "@twin.org/engine-models";
import { SortDirection } from "@twin.org/entity";
import { MemoryEntityStorageConnector } from "@twin.org/entity-storage-connector-memory";
import { EntityStorageConnectorFactory } from "@twin.org/entity-storage-models";
import { nameof } from "@twin.org/nameof";
import type { BackgroundTask } from "../src/entities/backgroundTask";
import { EntityStorageBackgroundTaskConnector } from "../src/entityStorageBackgroundTaskConnector";
import { initSchema } from "../src/schema";

let backgroundTaskEntityStorageConnector: MemoryEntityStorageConnector<BackgroundTask>;

/**
 * Wait for status.
 * @param status The status to wait for.
 * @param itemIndex The item index to wait for.
 */
async function waitForStatus(status: string, itemIndex: number = 0): Promise<void> {
	for (let i = 0; i < 50; i++) {
		await new Promise(resolve => setTimeout(resolve, 100));
		if (backgroundTaskEntityStorageConnector.getStore()[itemIndex]?.status === status) {
			return;
		}
	}
	// eslint-disable-next-line no-restricted-syntax
	throw new Error("Timeout waiting for status");
}

/**
 * Wait for error.
 * @param itemIndex The item index to wait for.
 */
async function waitForError(itemIndex: number = 0): Promise<void> {
	for (let i = 0; i < 50; i++) {
		await new Promise(resolve => setTimeout(resolve, 100));
		if (backgroundTaskEntityStorageConnector.getStore()[itemIndex]?.error) {
			return;
		}
	}
	// eslint-disable-next-line no-restricted-syntax
	throw new Error("Timeout waiting for error");
}

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

		const mockRandom = vi.fn();

		for (let k = 0; k < 50; k++) {
			mockRandom.mockImplementationOnce(length => new Uint8Array(length).fill(k));
		}

		RandomHelper.generate = mockRandom;
	});

	test("can construct with dependencies", async () => {
		const backgroundTaskConnector = new EntityStorageBackgroundTaskConnector();

		expect(backgroundTaskConnector).toBeDefined();
	});

	test("can create a task with no handler", async () => {
		const backgroundTaskConnector = new EntityStorageBackgroundTaskConnector();

		await backgroundTaskConnector.start("");
		const taskId = await backgroundTaskConnector.create("my-type");
		expect(taskId.split(":")[0]).toEqual("background-task");
		expect(taskId.split(":")[1]).toEqual("entity-storage");

		const store = backgroundTaskEntityStorageConnector.getStore();
		expect(store).toMatchObject([
			{
				id: "00000000000000000000000000000000",
				retainFor: 0,
				status: "pending",
				type: "my-type"
			}
		]);
	});

	test("can create a task with handler and no retainment", async () => {
		const backgroundTaskConnector = new EntityStorageBackgroundTaskConnector();

		await backgroundTaskConnector.registerHandler(
			"my-type",
			`file://${path.join(__dirname, "testModule.js")}`,
			"testMethod"
		);

		await backgroundTaskConnector.start("");
		await backgroundTaskConnector.create("my-type", { counter: 0 });

		const store = backgroundTaskEntityStorageConnector.getStore();
		expect(store).toMatchObject([]);
	});

	test("can create a task with handler and retainment", async () => {
		const backgroundTaskConnector = new EntityStorageBackgroundTaskConnector();

		await backgroundTaskConnector.registerHandler(
			"my-type",
			`file://${path.join(__dirname, "testModule.js")}`,
			"testMethod"
		);

		await backgroundTaskConnector.start("");
		await backgroundTaskConnector.create("my-type", { counter: 0 }, { retainFor: 10000 });

		await waitForStatus("success");

		const store = backgroundTaskEntityStorageConnector.getStore();
		expect(store).toMatchObject([
			{
				id: "00000000000000000000000000000000",
				payload: {
					counter: 0
				},
				result: {
					counter: 1
				},
				status: "success",
				type: "my-type"
			}
		]);
	});

	test("can create a task with handler and retainment with error and no retries", async () => {
		const backgroundTaskConnector = new EntityStorageBackgroundTaskConnector();

		await backgroundTaskConnector.registerHandler(
			"my-type",
			`file://${path.join(__dirname, "testModule.js")}`,
			"testMethod"
		);

		await backgroundTaskConnector.start("");
		await backgroundTaskConnector.create(
			"my-type",
			{ throw: true, counter: 0 },
			{ retainFor: 10000 }
		);

		await waitForStatus("failed");

		const store = backgroundTaskEntityStorageConnector.getStore();
		expect(store).toMatchObject([
			{
				id: "00000000000000000000000000000000",
				type: "my-type",
				status: "failed",
				payload: {
					counter: 0,
					throw: true
				},
				error: {
					name: "GeneralError",
					message: "moduleHelper.resultError"
				}
			}
		]);
	});

	test("can create a task with handler and retainment with error and single retry", async () => {
		const backgroundTaskConnector = new EntityStorageBackgroundTaskConnector();

		const data = {
			throw: true,
			counter: 0
		};
		await backgroundTaskConnector.registerHandler(
			"my-type",
			`file://${path.join(__dirname, "testModule.js")}`,
			"testMethod"
		);

		await backgroundTaskConnector.start("");
		await backgroundTaskConnector.create("my-type", data, {
			retainFor: 10000,
			retryCount: 1,
			retryInterval: 1000
		});

		await waitForStatus("pending");

		let store = backgroundTaskEntityStorageConnector.getStore();
		expect(store).toMatchObject([
			{
				id: "00000000000000000000000000000000",
				type: "my-type",
				retryInterval: 1000,
				retainFor: 10000,
				status: "pending",
				payload: {
					counter: 0,
					throw: true
				},
				error: {
					name: "GeneralError",
					message: "moduleHelper.resultError"
				}
			}
		]);

		const task = await backgroundTaskConnector.get(
			"background-task:entity-storage:00000000000000000000000000000000"
		);
		expect(task).toBeDefined();

		if (task?.payload) {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(task.payload as any).throw = false;
		}

		await waitForStatus("success");

		store = backgroundTaskEntityStorageConnector.getStore();

		expect(store).toMatchObject([
			{
				id: "00000000000000000000000000000000",
				type: "my-type",
				status: "success",
				payload: {
					counter: 0,
					throw: false
				},
				result: {
					counter: 1,
					throw: false
				}
			}
		]);
	});

	test("can add multiple tasks and process them in order", async () => {
		const backgroundTaskConnector = new EntityStorageBackgroundTaskConnector();

		await backgroundTaskConnector.registerHandler(
			"my-type",
			`file://${path.join(__dirname, "testModule.js")}`,
			"testMethod"
		);

		await backgroundTaskConnector.start("");

		for (let i = 0; i < 5; i++) {
			await backgroundTaskConnector.create("my-type", { id: i, counter: i }, { retainFor: 10000 });
		}

		await waitForStatus("success", 4);

		const store = backgroundTaskEntityStorageConnector.getStore();

		expect(store).toMatchObject([
			{
				id: "00000000000000000000000000000000",
				type: "my-type",
				status: "success",
				payload: {
					id: 0,
					counter: 0
				},
				result: {
					id: 0,
					counter: 1
				}
			},
			{
				id: "01010101010101010101010101010101",
				type: "my-type",
				status: "success",
				payload: {
					id: 1,
					counter: 1
				},
				result: {
					id: 1,
					counter: 2
				}
			},
			{
				id: "02020202020202020202020202020202",
				type: "my-type",
				status: "success",
				payload: {
					id: 2,
					counter: 2
				},
				result: {
					id: 2,
					counter: 3
				}
			},
			{
				id: "03030303030303030303030303030303",
				type: "my-type",
				status: "success",
				payload: {
					id: 3,
					counter: 3
				},
				result: {
					id: 3,
					counter: 4
				}
			},
			{
				id: "04040404040404040404040404040404",
				type: "my-type",
				status: "success",
				payload: {
					id: 4,
					counter: 4
				},
				result: {
					id: 4,
					counter: 5
				}
			}
		]);
	});

	test("can add multiple tasks and process them in order, when one item fails and no retry", async () => {
		const backgroundTaskConnector = new EntityStorageBackgroundTaskConnector();

		await backgroundTaskConnector.registerHandler(
			"my-type",
			`file://${path.join(__dirname, "testModule.js")}`,
			"testMethod"
		);

		await backgroundTaskConnector.start("");
		for (let i = 0; i < 5; i++) {
			await backgroundTaskConnector.create(
				"my-type",
				{ id: i, counter: i, throw: i === 2 },
				{ retainFor: 10000 }
			);
		}

		await waitForStatus("success", 4);

		const store = backgroundTaskEntityStorageConnector.getStore();

		expect(store).toMatchObject([
			{
				id: "00000000000000000000000000000000",
				type: "my-type",
				status: "success",
				payload: {
					id: 0,
					counter: 0
				},
				result: {
					id: 0,
					counter: 1
				}
			},
			{
				id: "01010101010101010101010101010101",
				type: "my-type",
				status: "success",
				payload: {
					id: 1,
					counter: 1
				},
				result: {
					id: 1,
					counter: 2
				}
			},
			{
				id: "02020202020202020202020202020202",
				type: "my-type",
				status: "failed",
				payload: {
					id: 2,
					counter: 2
				},
				error: {
					name: "GeneralError",
					message: "moduleHelper.resultError"
				}
			},
			{
				id: "03030303030303030303030303030303",
				type: "my-type",
				status: "success",
				payload: {
					id: 3,
					counter: 3
				},
				result: {
					id: 3,
					counter: 4
				}
			},
			{
				id: "04040404040404040404040404040404",
				type: "my-type",
				status: "success",
				payload: {
					id: 4,
					counter: 4
				},
				result: {
					id: 4,
					counter: 5
				}
			}
		]);
	});

	test("can add multiple tasks and process them in order, when one item fails and retry", async () => {
		const backgroundTaskConnector = new EntityStorageBackgroundTaskConnector({
			config: { taskInterval: 500 }
		});

		await backgroundTaskConnector.registerHandler(
			"my-type",
			`file://${path.join(__dirname, "testModule.js")}`,
			"testMethod"
		);

		await backgroundTaskConnector.start("");
		for (let i = 0; i < 5; i++) {
			await backgroundTaskConnector.create(
				"my-type",
				{ id: i, counter: 0, throw: i === 2 },
				{ retainFor: 10000, retryCount: 1, retryInterval: 3000 }
			);
		}

		await waitForError(2);
		const store2 = backgroundTaskEntityStorageConnector.getStore();
		if (store2[2]?.payload) {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(store2[2].payload as any).throw = false;
		}
		await waitForStatus("success", 2);

		const store = backgroundTaskEntityStorageConnector.getStore();
		expect(store).toMatchObject([
			{
				id: "00000000000000000000000000000000",
				type: "my-type",
				status: "success",
				payload: {
					id: 0,
					counter: 0
				},
				result: {
					id: 0,
					counter: 1
				}
			},
			{
				id: "01010101010101010101010101010101",
				type: "my-type",
				status: "success",
				payload: {
					id: 1,
					counter: 0
				},
				result: {
					id: 1,
					counter: 1
				}
			},
			{
				id: "02020202020202020202020202020202",
				type: "my-type",
				status: "success",
				payload: {
					id: 2,
					counter: 0
				},
				result: {
					id: 2,
					counter: 1
				}
			},
			{
				id: "03030303030303030303030303030303",
				type: "my-type",
				status: "success",
				payload: {
					id: 3,
					counter: 0
				},
				result: {
					id: 3,
					counter: 1
				}
			},
			{
				id: "04040404040404040404040404040404",
				type: "my-type",
				status: "success",
				payload: {
					id: 4,
					counter: 0
				},
				result: {
					id: 4,
					counter: 1
				}
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

		await backgroundTaskConnector.start("");
		const id = await backgroundTaskConnector.create(
			"my-type",
			{ counter: 0 },
			{ retryCount: 10, retryInterval: 10000, retainFor: 10000 }
		);

		await backgroundTaskConnector.cancel(id);

		const store = backgroundTaskEntityStorageConnector.getStore();

		expect(store[0].status).toEqual("cancelled");
		expect(store[0].dateCancelled).toBeDefined();
	});

	test("can cleanup retained items when passed their retained date", async () => {
		const backgroundTaskConnector = new EntityStorageBackgroundTaskConnector({
			config: { taskInterval: 1000 }
		});

		const now = Date.now();
		await backgroundTaskEntityStorageConnector.set({
			id: "00000000000000000000000000000000",
			type: "my-type",
			dateCreated: new Date(now - 1000).toISOString(),
			dateModified: new Date(now - 1000).toISOString(),
			retryInterval: 10000,
			retainFor: 10000,
			status: "success",
			retriesRemaining: 9,
			payload: {
				counter: 0
			},
			retainUntil: now - 100
		});

		await backgroundTaskConnector.start("");

		const store = backgroundTaskEntityStorageConnector.getStore();
		expect(store.length).toEqual(0);
	});

	test("can not cleanup retained items when equalling their retained date", async () => {
		const backgroundTaskConnector = new EntityStorageBackgroundTaskConnector({
			config: { taskInterval: 1000 }
		});

		const now = Date.now();
		await backgroundTaskEntityStorageConnector.set({
			id: "00000000000000000000000000000000",
			type: "my-type",
			dateCreated: new Date(now).toISOString(),
			dateModified: new Date(now).toISOString(),
			retryInterval: 10000,
			retainFor: 10000,
			status: "success",
			retriesRemaining: 9,
			payload: {
				counter: 0
			},
			retainUntil: now
		});

		await backgroundTaskConnector.start("");

		const store = backgroundTaskEntityStorageConnector.getStore();
		expect(store.length).toEqual(1);
	});

	test("can not cleanup retained items when no retained date set", async () => {
		const backgroundTaskConnector = new EntityStorageBackgroundTaskConnector({
			config: { taskInterval: 1000 }
		});

		const now = Date.now();
		await backgroundTaskEntityStorageConnector.set({
			id: "00000000000000000000000000000000",
			type: "my-type",
			dateCreated: new Date(now).toISOString(),
			dateModified: new Date(now).toISOString(),
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

	test("can start a clone of the engine in the background task", async () => {
		const backgroundTaskConnector = new EntityStorageBackgroundTaskConnector({
			config: { taskInterval: 1000 }
		});

		const engineCore = new EngineCore({
			config: {
				debug: true,
				silent: true,
				types: {}
			}
		});
		EngineCoreFactory.register("engine", () => engineCore);

		await backgroundTaskConnector.registerHandler(
			"my-type",
			`file://${path.join(__dirname, "testModule.js")}`,
			"testMethodWithEngine"
		);

		await backgroundTaskConnector.create("my-type", { counter: 1 }, { retainFor: 10000 });
		await backgroundTaskConnector.start("");

		await waitForStatus("success");

		const store = backgroundTaskEntityStorageConnector.getStore();
		expect(store).toMatchObject([
			{
				id: "00000000000000000000000000000000",
				payload: {
					counter: 1
				},
				result: {
					counter: 2,
					engineCloneData: {
						config: {
							debug: true,
							silent: true,
							types: {}
						},
						state: {
							componentStates: {}
						},
						typeInitialisers: []
					}
				},
				status: "success",
				type: "my-type"
			}
		]);
	});
});

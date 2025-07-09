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
	for (let i = 0; i < 500; i++) {
		if (backgroundTaskEntityStorageConnector.getStore()[itemIndex]?.status === status) {
			return;
		}
		await new Promise(resolve => setTimeout(resolve, 100));
	}
	// eslint-disable-next-line no-restricted-syntax
	throw new Error("Timeout waiting for status");
}

/**
 * Wait for error.
 * @param itemIndex The item index to wait for.
 */
async function waitForError(itemIndex: number = 0): Promise<void> {
	for (let i = 0; i < 500; i++) {
		if (backgroundTaskEntityStorageConnector.getStore()[itemIndex]?.error) {
			return;
		}
		await new Promise(resolve => setTimeout(resolve, 100));
	}
	// eslint-disable-next-line no-restricted-syntax
	throw new Error("Timeout waiting for error");
}

describe("EntityStorageBackgroundTaskConnector", () => {
	beforeAll(() => {
		initSchema();

		const mockRandom = vi.fn();

		let i = 0;
		mockRandom.mockImplementation(length => new Uint8Array(length).fill(i++));

		RandomHelper.generate = mockRandom;
	});

	beforeEach(() => {
		backgroundTaskEntityStorageConnector = new MemoryEntityStorageConnector<BackgroundTask>({
			entitySchema: nameof<BackgroundTask>()
		});

		EntityStorageConnectorFactory.register(
			"background-task",
			() => backgroundTaskEntityStorageConnector
		);
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
		expect(store).toMatchObject([
			{
				id: "01010101010101010101010101010101",
				payload: {
					counter: 0
				},
				retainFor: 0,
				retriesRemaining: undefined,
				retryInterval: undefined,
				status: "pending",
				threadId: "main",
				type: "my-type"
			}
		]);
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
				id: "02020202020202020202020202020202",
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
				id: "03030303030303030303030303030303",
				type: "my-type",
				status: "failed",
				payload: {
					counter: 0,
					throw: true
				},
				error: {
					name: "Error",
					message: "error"
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
			retryInterval: 2000
		});

		await waitForError();

		let store = backgroundTaskEntityStorageConnector.getStore();
		expect(store).toMatchObject([
			{
				id: "04040404040404040404040404040404",
				type: "my-type",
				retryInterval: 2000,
				status: "pending",
				payload: {
					counter: 0,
					throw: true
				},
				error: {
					name: "Error",
					message: "error"
				}
			}
		]);

		if (store[0]?.payload) {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(store[0].payload as any).throw = false;
		}

		const task = await backgroundTaskConnector.get(
			"background-task:entity-storage:04040404040404040404040404040404"
		);
		expect(task).toBeDefined();

		await waitForStatus("success");

		store = backgroundTaskEntityStorageConnector.getStore();

		expect(store).toMatchObject([
			{
				id: "04040404040404040404040404040404",
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
				id: "05050505050505050505050505050505",
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
				id: "06060606060606060606060606060606",
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
				id: "07070707070707070707070707070707",
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
				id: "08080808080808080808080808080808",
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
				id: "09090909090909090909090909090909",
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
				id: "0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a",
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
				id: "0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b",
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
				id: "0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c",
				type: "my-type",
				status: "failed",
				payload: {
					id: 2,
					counter: 2
				},
				error: {
					name: "Error",
					message: "error"
				}
			},
			{
				id: "0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d",
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
				id: "0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e",
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
				id: "0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f",
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
				id: "10101010101010101010101010101010",
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
				id: "11111111111111111111111111111111",
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
				id: "12121212121212121212121212121212",
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
				id: "13131313131313131313131313131313",
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
		expect(completedOrder.entities[0].id).toBe("0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f");
		expect(completedOrder.entities[1].id).toBe("10101010101010101010101010101010");
		expect(completedOrder.entities[2].id).toBe("12121212121212121212121212121212");
		expect(completedOrder.entities[3].id).toBe("13131313131313131313131313131313");
		expect(completedOrder.entities[4].id).toBe("11111111111111111111111111111111");
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
			threadId: "main",
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
			threadId: "main",
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
			threadId: "main",
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
				id: "15151515151515151515151515151515",
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

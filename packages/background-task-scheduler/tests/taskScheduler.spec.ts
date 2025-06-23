// Copyright 2024 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import { TaskScheduler } from "../src/taskScheduler";

describe("TaskScheduler", () => {
	beforeEach(() => {
		const original = Date.now;
		const start = original();
		const mockNow = vi.fn();
		mockNow.mockImplementation(() => {
			const tick = original();
			return Math.floor((tick - start) / 100) * 100;
		});
		Date.now = mockNow;
	});

	test("can construct with dependencies", async () => {
		const taskScheduler = new TaskScheduler();

		expect(taskScheduler).toBeDefined();
	});

	test("can schedule a one off task to run at a specific time with no interval", async () => {
		const taskScheduler = new TaskScheduler({
			config: {
				overrideInterval: 1000
			}
		});

		let triggered = false;
		await taskScheduler.addTask("testTask", [{ nextTriggerTime: Date.now() + 500 }], async () => {
			triggered = true;
		});

		const taskInfo = await taskScheduler.tasksInfo();
		expect(taskInfo.tasks).toEqual({
			testTask: [
				{
					nextTriggerTime: 500
				}
			]
		});
		expect(triggered).toEqual(false);

		await new Promise(resolve => setTimeout(resolve, 1000));

		const taskInfo2 = await taskScheduler.tasksInfo();
		expect(taskInfo2.tasks).toEqual({
			testTask: [
				{
					nextTriggerTime: undefined
				}
			]
		});
		expect(triggered).toEqual(true);
	});

	test("can schedule a one off task to run at a specific time with minutes interval", async () => {
		const taskScheduler = new TaskScheduler({
			config: {
				overrideInterval: 1000
			}
		});

		let triggered = false;
		await taskScheduler.addTask(
			"testTask",
			[{ nextTriggerTime: Date.now() - 59000, intervalMinutes: 1 }],
			async () => {
				triggered = true;
			}
		);

		const taskInfo = await taskScheduler.tasksInfo();
		expect(taskInfo.tasks).toEqual({
			testTask: [
				{
					intervalMinutes: 1,
					nextTriggerTime: -59000
				}
			]
		});
		expect(triggered).toEqual(false);

		await new Promise(resolve => setTimeout(resolve, 1000));

		const taskInfo2 = await taskScheduler.tasksInfo();
		expect(taskInfo2.tasks).toEqual({
			testTask: [
				{
					intervalMinutes: 1,
					nextTriggerTime: 1000
				}
			]
		});
		expect(triggered).toEqual(true);
	});

	test("can remove a task", async () => {
		const taskScheduler = new TaskScheduler({
			config: {
				overrideInterval: 1000
			}
		});

		let triggerCount = 0;
		await taskScheduler.addTask(
			"testTask",
			[{ nextTriggerTime: Date.now() - 59000, intervalMinutes: 1 }],
			async () => {
				triggerCount++;
			}
		);

		const taskInfo = await taskScheduler.tasksInfo();
		expect(taskInfo.tasks).toEqual({
			testTask: [
				{
					intervalMinutes: 1,
					nextTriggerTime: -59000
				}
			]
		});

		await new Promise(resolve => setTimeout(resolve, 1000));
		expect(triggerCount).toEqual(1);

		await taskScheduler.removeTask("testTask");

		await new Promise(resolve => setTimeout(resolve, 1000));

		const taskInfo2 = await taskScheduler.tasksInfo();
		expect(taskInfo2.tasks).toEqual({});
		expect(triggerCount).toEqual(1);
	});

	test("can remove a task during a callback", async () => {
		const taskScheduler = new TaskScheduler({
			config: {
				overrideInterval: 1000
			}
		});

		let triggerCount = 0;
		await taskScheduler.addTask(
			"testTask",
			[{ nextTriggerTime: Date.now() - 59000, intervalMinutes: 1 }],
			async () => {
				triggerCount++;
				await taskScheduler.removeTask("testTask");
			}
		);

		const taskInfo = await taskScheduler.tasksInfo();
		expect(taskInfo.tasks).toEqual({
			testTask: [
				{
					intervalMinutes: 1,
					nextTriggerTime: -59000
				}
			]
		});

		await new Promise(resolve => setTimeout(resolve, 1000));
		expect(triggerCount).toEqual(1);

		const taskInfo2 = await taskScheduler.tasksInfo();
		expect(taskInfo2.tasks).toEqual({});
		expect(triggerCount).toEqual(1);
	});

	test("can throw an error in a task and continue", async () => {
		const taskScheduler = new TaskScheduler({
			config: {
				overrideInterval: 1000
			}
		});

		await taskScheduler.addTask("testTask", [{ nextTriggerTime: Date.now() + 500 }], async () => {
			// eslint-disable-next-line no-restricted-syntax
			throw new Error("Test error");
		});

		const taskInfo = await taskScheduler.tasksInfo();
		expect(taskInfo.tasks).toEqual({
			testTask: [
				{
					nextTriggerTime: 500
				}
			]
		});

		await new Promise(resolve => setTimeout(resolve, 1000));

		const taskInfo2 = await taskScheduler.tasksInfo();
		expect(taskInfo2.tasks).toEqual({
			testTask: [
				{
					nextTriggerTime: undefined
				}
			]
		});
	});
});

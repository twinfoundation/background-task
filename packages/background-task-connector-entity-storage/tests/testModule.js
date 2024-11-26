// Copyright 2024 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import { EngineCore } from '@twin.org/engine-core';

/**
 * Test method.
 * @param engineCloneData The engine clone data.
 * @param payload The payload.
 * @returns The test result.
 */
export async function testMethod(engineCloneData, payload) {
	if (payload.throw) {
		throw new Error('error');
	}
	payload.counter++;
	return payload;
}

/**
 * Test method using engine.
 * @param engineCloneData The engine clone data.
 * @param payload The payload.
 * @returns The test result.
 */
export async function testMethodWithEngine(engineCloneData, payload) {
	const engineCore = new EngineCore();
	engineCore.populateClone(engineCloneData);
	await engineCore.start();
	payload.counter++;
	payload.engineCloneData = engineCloneData;
	return payload;
}

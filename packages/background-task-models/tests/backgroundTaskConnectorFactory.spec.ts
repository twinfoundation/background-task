// Copyright 2024 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import { BackgroundTaskConnectorFactory } from "../src/factories/backgroundTaskConnectorFactory";
import type { IBackgroundTaskConnector } from "../src/models/IBackgroundTaskConnector";

describe("BackgroundTaskConnectorFactory", () => {
	test("can add an item to the factory", async () => {
		BackgroundTaskConnectorFactory.register(
			"my-background-task",
			() => ({}) as unknown as IBackgroundTaskConnector
		);
	});
});

// Copyright 2024 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import { EntitySchemaFactory, EntitySchemaHelper } from "@twin.org/entity";
import { nameof } from "@twin.org/nameof";
import { BackgroundTask } from "./entities/backgroundTask";

/**
 * Initialize the schema for the background task connector entity storage.
 */
export function initSchema(): void {
	EntitySchemaFactory.register(nameof<BackgroundTask>(), () =>
		EntitySchemaHelper.getSchema(BackgroundTask)
	);
}

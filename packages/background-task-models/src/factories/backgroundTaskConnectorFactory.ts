// Copyright 2024 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import { Factory } from "@twin.org/core";
import type { IBackgroundTaskConnector } from "../models/IBackgroundTaskConnector";

/**
 * Factory for creating background task connectors.
 */
// eslint-disable-next-line @typescript-eslint/naming-convention
export const BackgroundTaskConnectorFactory =
	Factory.createFactory<IBackgroundTaskConnector>("background-task");

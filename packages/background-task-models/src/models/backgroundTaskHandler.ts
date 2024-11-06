// Copyright 2024 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import type { IError } from "@twin.org/core";

/**
 * Interface describing a task handler.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type BackgroundTaskHandler<T = any, U = any> = (payload: T) => Promise<{
	result?: U;
	error?: IError;
}>;

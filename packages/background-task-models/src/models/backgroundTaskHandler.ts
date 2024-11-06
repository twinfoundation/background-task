// Copyright 2024 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.

/**
 * Interface describing a task handler, exceptions thrown in the handler will be caught.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type BackgroundTaskHandler<T = any, U = any> = (payload: T) => Promise<U>;

/**
 * Shared utility types used by `src/Tool.ts` and other framework code.
 *
 * Originally declared in a missing file — reconstructed from usage sites.
 */

export type Brand<T, B extends string> = T & { readonly __brand: B }

export type AsyncReturnType<T> = T extends PromiseLike<infer U> ? U : T

export type Nullable<T> = T | null

export type Dict<T = unknown> = Record<string, T>

export type Awaitable<T> = T | PromiseLike<T>

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K]
}

export type Overwrite<T, U> = Omit<T, keyof U> & U

export type Without<T, U> = { [P in Exclude<keyof T, keyof U>]?: never }
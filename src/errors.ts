export class DecideError extends Error {
  override readonly name: string = "DecideError";
}

/** A request failed provider-side validation. */
export class ValidationError extends DecideError {
  override readonly name = "ValidationError";
}

/** A provider call failed (network, auth, bad response...). */
export class ProviderError extends DecideError {
  override readonly name = "ProviderError";
  constructor(
    message: string,
    readonly provider: string,
    override readonly cause?: unknown,
  ) {
    super(message);
  }
}

/** Requested provider is not registered. */
export class UnknownProviderError extends DecideError {
  override readonly name = "UnknownProviderError";
  constructor(readonly provider: string) {
    super(`Unknown provider: ${provider}`);
  }
}

/** Every provider in the fallback chain failed. */
export class AllProvidersFailedError extends DecideError {
  override readonly name = "AllProvidersFailedError";
  constructor(
    readonly attempted: string[],
    readonly errors: Array<{ provider: string; error: unknown }>,
  ) {
    super(
      `All providers failed [${attempted.join(" -> ")}]: ${errors
        .map((e) => `${e.provider}: ${(e.error as Error)?.message ?? e.error}`)
        .join("; ")}`,
    );
  }
}

/** Call-count or cost budget exceeded. */
export class BudgetExceededError extends DecideError {
  override readonly name = "BudgetExceededError";
  constructor(
    message: string,
    readonly spent: number,
    readonly limit: number,
  ) {
    super(message);
  }
}

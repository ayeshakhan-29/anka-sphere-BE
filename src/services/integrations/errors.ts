/** Thrown when an integration's credentials are missing or the connection is absent/expired. */
export class IntegrationUnavailableError extends Error {
  readonly statusCode = 503;
}

/** Thrown when an upstream provider request fails. */
export class IntegrationRequestError extends Error {
  constructor(message: string, readonly statusCode: number = 502) {
    super(message);
  }
}

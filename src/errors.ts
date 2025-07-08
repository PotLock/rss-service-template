export class RssServiceError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class FeedNotFoundError extends RssServiceError {
  constructor(feedId: string) {
    super(`Feed with ID '${feedId}' not found.`, 404);
  }
}

export class DuplicateItemError extends RssServiceError {
  constructor(guid: string) {
    super(`Item with GUID '${guid}' already exists in this feed.`, 409);
  }
}

export class InvalidPayloadError extends RssServiceError {
  constructor(message: string) {
    super(message, 400);
  }
}

export class FeedConfigurationError extends RssServiceError {
  constructor(message: string) {
    super(`Feed configuration error: ${message}`, 400);
  }
}

export class StorageError extends RssServiceError {
  constructor(message: string) {
    super(`Storage error: ${message}`, 500);
  }
}

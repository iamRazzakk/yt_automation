export type ErrorCategory = "USER_INPUT" | "EXTERNAL" | "SYSTEM";

export interface AppErrorOptions {
  code: string;
  category: ErrorCategory;
  retryable: boolean;
  message: string;
  cause?: unknown;
}

export class AppError extends Error {
  readonly code: string;
  readonly category: ErrorCategory;
  readonly retryable: boolean;

  constructor(opts: AppErrorOptions) {
    super(opts.message);
    this.name = "AppError";
    this.code = opts.code;
    this.category = opts.category;
    this.retryable = opts.retryable;
    if (opts.cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = opts.cause;
    }
  }
}

export const ErrorCatalog = {
  URL_INVALID: {
    code: "URL_INVALID",
    category: "USER_INPUT" as const,
    retryable: false,
  },
  VIDEO_UNAVAILABLE: {
    code: "VIDEO_UNAVAILABLE",
    category: "USER_INPUT" as const,
    retryable: false,
  },
  VIDEO_TOO_LONG: {
    code: "VIDEO_TOO_LONG",
    category: "USER_INPUT" as const,
    retryable: false,
  },
  NO_SPEECH: {
    code: "NO_SPEECH",
    category: "USER_INPUT" as const,
    retryable: false,
  },
  DISK_LOW: {
    code: "DISK_LOW",
    category: "SYSTEM" as const,
    retryable: false,
  },
  DOWNLOAD_BLOCKED: {
    code: "DOWNLOAD_BLOCKED",
    category: "EXTERNAL" as const,
    retryable: true,
  },
  MEDIA_CORRUPT: {
    code: "MEDIA_CORRUPT",
    category: "USER_INPUT" as const,
    retryable: false,
  },
  TRANSCRIBE_FAILED: {
    code: "TRANSCRIBE_FAILED",
    category: "SYSTEM" as const,
    retryable: true,
  },
  NO_CLIPS: {
    code: "NO_CLIPS",
    category: "SYSTEM" as const,
    retryable: false,
  },
  RENDER_FAILED: {
    code: "RENDER_FAILED",
    category: "SYSTEM" as const,
    retryable: true,
  },
  YT_AUTH_EXPIRED: {
    code: "YT_AUTH_EXPIRED",
    category: "EXTERNAL" as const,
    retryable: false,
  },
  YT_QUOTA: {
    code: "YT_QUOTA",
    category: "EXTERNAL" as const,
    retryable: false,
  },
  YT_UPLOAD_LIMIT: {
    code: "YT_UPLOAD_LIMIT",
    category: "EXTERNAL" as const,
    retryable: false,
  },
  YT_REJECTED: {
    code: "YT_REJECTED",
    category: "EXTERNAL" as const,
    retryable: false,
  },
  YT_NETWORK: {
    code: "YT_NETWORK",
    category: "EXTERNAL" as const,
    retryable: true,
  },
} as const;

export function makeError(
  catalog: { code: string; category: ErrorCategory; retryable: boolean },
  message: string,
  cause?: unknown,
): AppError {
  return new AppError({ ...catalog, message, cause });
}

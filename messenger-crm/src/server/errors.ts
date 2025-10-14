/**
 * カスタムエラークラス
 * アプリケーション全体で統一されたエラーハンドリング
 */

export class AppError extends Error {
  constructor(
    message: string,
    public statusCode: number = 500,
    public code?: string,
  ) {
    super(message)
    this.name = this.constructor.name
    Error.captureStackTrace(this, this.constructor)
  }
}

/**
 * 認証エラー (401)
 */
export class AuthenticationError extends AppError {
  constructor(message = "認証が必要です") {
    super(message, 401, "AUTHENTICATION_ERROR")
  }
}

/**
 * 認可エラー (403)
 */
export class AuthorizationError extends AppError {
  constructor(message = "この操作を実行する権限がありません") {
    super(message, 403, "AUTHORIZATION_ERROR")
  }
}

/**
 * リソースが見つからない (404)
 */
export class NotFoundError extends AppError {
  constructor(resource: string) {
    super(`${resource}が見つかりませんでした`, 404, "NOT_FOUND_ERROR")
  }
}

/**
 * バリデーションエラー (400)
 */
export class ValidationError extends AppError {
  constructor(
    message: string,
    public fields?: Record<string, string>,
  ) {
    super(message, 400, "VALIDATION_ERROR")
  }
}

/**
 * LLMサービスエラー (503)
 */
export class LLMServiceError extends AppError {
  constructor(message: string, public operation?: string) {
    super(message, 503, "LLM_SERVICE_ERROR")
  }
}

/**
 * データベースエラー (500)
 */
export class DatabaseError extends AppError {
  constructor(message: string, public originalError?: Error) {
    super(message, 500, "DATABASE_ERROR")
  }
}

/**
 * 外部APIエラー (502)
 */
export class ExternalAPIError extends AppError {
  constructor(
    message: string,
    public service: string,
    public originalError?: Error,
  ) {
    super(message, 502, "EXTERNAL_API_ERROR")
  }
}

/**
 * エラーが AppError のインスタンスかチェック
 */
export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError
}

/**
 * エラーレスポンスを生成
 */
export function formatErrorResponse(error: unknown) {
  if (isAppError(error)) {
    return {
      error: error.message,
      code: error.code,
      statusCode: error.statusCode,
    }
  }

  if (error instanceof Error) {
    return {
      error: error.message,
      code: "INTERNAL_SERVER_ERROR",
      statusCode: 500,
    }
  }

  return {
    error: "予期しないエラーが発生しました",
    code: "UNKNOWN_ERROR",
    statusCode: 500,
  }
}

/**
 * エラーをログ出力
 */
export function logError(error: unknown, context?: string) {
  const prefix = context ? `[${context}]` : ""

  if (isAppError(error)) {
    console.error(`${prefix} AppError [${error.code}]:`, error.message)
    if (error.statusCode >= 500) {
      console.error(`${prefix} Stack:`, error.stack)
    }
  } else if (error instanceof Error) {
    console.error(`${prefix} Error:`, error.message)
    console.error(`${prefix} Stack:`, error.stack)
  } else {
    console.error(`${prefix} Unknown error:`, error)
  }
}

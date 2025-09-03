/**
 * Lightweight error handling utilities
 */

/**
 * Standard error response format
 */
export interface ErrorResponse {
  error: string;
  message?: string;
  details?: any;
}

/**
 * Create a standardized error response
 */
export function errorResponse(
  message: string,
  status: number = 500,
  details?: any
): Response {
  const body: ErrorResponse = {
    error: message,
  };
  
  if (details) {
    // In development, include details for debugging
    body.details = details;
  }
  
  return Response.json(body, { status });
}

/**
 * Handle errors and return appropriate response
 */
export function handleError(error: any): Response {
  console.error('Error occurred:', error);
  
  // Zod validation errors
  if (error.name === 'ZodError' || error.message?.startsWith('[')) {
    return errorResponse('Invalid request data', 400, error.errors || error.message);
  }
  
  // Validation errors
  if (error.message?.includes('Missing required') || 
      error.message?.includes('must be') ||
      error.message?.includes('Required')) {
    return errorResponse(error.message, 400);
  }
  
  // Not found errors
  if (error.message?.includes('not found') || 
      error.message?.includes('does not exist')) {
    return errorResponse(error.message, 404);
  }
  
  // Authorization errors
  if (error.message?.includes('Unauthorized') || 
      error.message?.includes('Forbidden')) {
    return errorResponse(error.message, 403);
  }
  
  // Default to internal server error
  return errorResponse(
    'Internal server error',
    500
  );
}

/**
 * Wrap an async handler with error handling
 */
export function withErrorHandling<T extends (...args: any[]) => Promise<any>>(
  handler: T
): T {
  return (async (...args: any[]) => {
    try {
      return await handler(...args);
    } catch (error) {
      return handleError(error);
    }
  }) as T;
}

/**
 * Log error with context
 */
export function logError(context: string, error: any): void {
  console.error(`[${context}]`, {
    message: error.message,
    stack: error.stack,
    timestamp: new Date().toISOString(),
  });
}
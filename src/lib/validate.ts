/**
 * Lightweight validation utilities
 */

/**
 * Check if required fields are present in the data object
 * @param data - The data object to validate
 * @param fields - Array of required field names
 * @throws Error if any required field is missing
 */
export function requireFields(data: any, fields: string[]): void {
  if (!data) {
    throw new Error('Request body is required');
  }
  
  const missing = fields.filter(field => !data[field]);
  if (missing.length > 0) {
    throw new Error(`Missing required fields: ${missing.join(', ')}`);
  }
}

/**
 * Validate that a value is a non-empty string
 */
export function requireString(value: any, fieldName: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${fieldName} must be a non-empty string`);
  }
  return value.trim();
}

/**
 * Validate that a value is a boolean
 */
export function requireBoolean(value: any, fieldName: string): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`${fieldName} must be a boolean`);
  }
  return value;
}

/**
 * Validate server endpoints structure
 */
export function validateServerEndpoints(endpoints: any): void {
  if (!endpoints || typeof endpoints !== 'object') {
    throw new Error('endpoints must be an object');
  }
  
  if (!endpoints.predict || typeof endpoints.predict !== 'string') {
    throw new Error('endpoints.predict must be a valid URL string');
  }
  
  if (!endpoints.health || typeof endpoints.health !== 'string') {
    throw new Error('endpoints.health must be a valid URL string');
  }
}

/**
 * Check if user has required role
 */
export function requireRole(roles: string[], requiredRole: string): boolean {
  return roles && roles.includes(requiredRole);
}
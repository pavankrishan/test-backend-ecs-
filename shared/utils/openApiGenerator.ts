/**
 * OpenAPI Specification Generator
 * Helps generate OpenAPI specs programmatically
 */

export interface OpenApiPath {
  path: string;
  method: 'get' | 'post' | 'put' | 'patch' | 'delete';
  summary: string;
  description?: string;
  tags?: string[];
  security?: Array<{ [key: string]: string[] }>;
  requestBody?: any;
  parameters?: any[];
  responses: { [statusCode: string]: any };
}

export interface ServiceOpenApiSpec {
  openapi: string;
  info: {
    title: string;
    version: string;
    description?: string;
  };
  servers: Array<{
    url: string;
    description?: string;
  }>;
  tags?: Array<{
    name: string;
    description?: string;
  }>;
  paths: { [path: string]: any };
  components?: {
    schemas?: { [key: string]: any };
    securitySchemes?: { [key: string]: any };
  };
}

/**
 * Generate OpenAPI spec from path definitions
 */
export function generateOpenApiSpec(
  serviceName: string,
  version: string,
  paths: OpenApiPath[],
  baseUrl: string = '/api/v1',
  options?: {
    description?: string;
    tags?: Array<{ name: string; description?: string }>;
    components?: {
      schemas?: { [key: string]: any };
      securitySchemes?: { [key: string]: any };
    };
  }
): ServiceOpenApiSpec {
  const spec: ServiceOpenApiSpec = {
    openapi: '3.0.3',
    info: {
      title: `${serviceName} API`,
      version,
      description: options?.description || `${serviceName} microservice API`,
    },
    servers: [
      {
        url: baseUrl,
        description: `${serviceName} API Server`,
      },
    ],
    paths: {},
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
      ...(options?.components || {}),
    },
  };

  if (options?.tags) {
    spec.tags = options.tags;
  }

  // Build paths object
  paths.forEach((pathDef) => {
    if (!spec.paths[pathDef.path]) {
      spec.paths[pathDef.path] = {};
    }

    const operation: any = {
      summary: pathDef.summary,
      ...(pathDef.description && { description: pathDef.description }),
      ...(pathDef.tags && { tags: pathDef.tags }),
      ...(pathDef.security && { security: pathDef.security }),
      ...(pathDef.parameters && { parameters: pathDef.parameters }),
      ...(pathDef.requestBody && { requestBody: pathDef.requestBody }),
      responses: pathDef.responses,
    };

    spec.paths[pathDef.path][pathDef.method] = operation;
  });

  return spec;
}

/**
 * Common response schemas
 */
export const commonSchemas = {
  ErrorResponse: {
    type: 'object',
    required: ['success', 'error'],
    properties: {
      success: {
        type: 'boolean',
        example: false,
      },
      error: {
        type: 'object',
        properties: {
          code: {
            type: 'string',
            example: 'ERROR_CODE',
          },
          message: {
            type: 'string',
            example: 'Error message',
          },
          details: {
            type: 'array',
            items: {
              type: 'object',
            },
          },
        },
      },
    },
  },
  SuccessResponse: {
    type: 'object',
    required: ['success', 'data'],
    properties: {
      success: {
        type: 'boolean',
        example: true,
      },
      data: {
        type: 'object',
      },
      message: {
        type: 'string',
      },
    },
  },
  PaginationResponse: {
    type: 'object',
    properties: {
      success: {
        type: 'boolean',
        example: true,
      },
      data: {
        type: 'array',
        items: {
          type: 'object',
        },
      },
      pagination: {
        type: 'object',
        properties: {
          page: { type: 'number' },
          limit: { type: 'number' },
          total: { type: 'number' },
          totalPages: { type: 'number' },
        },
      },
    },
  },
};

/**
 * Helper to create path definition
 */
export function createPath(
  path: string,
  method: OpenApiPath['method'],
  summary: string,
  options?: Partial<OpenApiPath>
): OpenApiPath {
  return {
    path,
    method,
    summary,
    responses: {
      '400': {
        description: 'Bad Request',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ErrorResponse' },
          },
        },
      },
      '500': {
        description: 'Internal Server Error',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ErrorResponse' },
          },
        },
      },
    },
    ...options,
  };
}


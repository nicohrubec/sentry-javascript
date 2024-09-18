import {
  SEMANTIC_ATTRIBUTE_SENTRY_OP,
  SEMANTIC_ATTRIBUTE_SENTRY_ORIGIN,
  applySdkMetadata,
  spanToJSON,
} from '@sentry/core';
import type { NodeClient, NodeOptions, Span } from '@sentry/node';
import { init as nodeInit } from '@sentry/node';

/**
 * Initializes the NestJS SDK
 */
export function init(options: NodeOptions | undefined = {}): NodeClient | undefined {
  const opts: NodeOptions = {
    ...options,
  };

  applySdkMetadata(opts, 'nestjs');

  const client = nodeInit(opts);

  if (client) {
    client.on('spanStart', span => {
      addNestSpanAttributes(span);
    });
  }

  return client;
}

function addNestSpanAttributes(span: Span): void {
  const attributes = spanToJSON(span).data || {};

  // this is one of: app_creation, request_context, handler
  const type = attributes['nestjs.type'];

  // If this is already set, or we have no nest.js span, no need to process again...
  if (attributes[SEMANTIC_ATTRIBUTE_SENTRY_OP] || !type) {
    return;
  }

  span.setAttributes({
    [SEMANTIC_ATTRIBUTE_SENTRY_ORIGIN]: 'auto.http.otel.nestjs',
    [SEMANTIC_ATTRIBUTE_SENTRY_OP]: `${type}.nestjs`,
  });
}

import type { ArgumentsHost, CallHandler, DynamicModule, ExecutionContext, NestInterceptor } from '@nestjs/common';
import { Catch, Global, HttpException, Injectable, Logger, Module } from '@nestjs/common';
import { APP_INTERCEPTOR, BaseExceptionFilter } from '@nestjs/core';
import { captureException, getDefaultIsolationScope, getIsolationScope } from '@sentry/core';
import { logger } from '@sentry/utils';
import type { Observable } from 'rxjs';
import { isExpectedError } from './helpers';

/**
 * Note: We cannot use @ syntax to add the decorators, so we add them directly below the classes as function wrappers.
 */

/**
 * Interceptor to add Sentry tracing capabilities to Nest.js applications.
 */
class SentryTracingInterceptor implements NestInterceptor {
  // used to exclude this class from being auto-instrumented
  public readonly __SENTRY_INTERNAL__: boolean;

  public constructor() {
    this.__SENTRY_INTERNAL__ = true;
  }

  /**
   * Intercepts HTTP requests to set the transaction name for Sentry tracing.
   */
  public intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (getIsolationScope() === getDefaultIsolationScope()) {
      logger.warn('Isolation scope is still the default isolation scope, skipping setting transactionName.');
      return next.handle();
    }

    if (context.getType() === 'http') {
      const req = context.switchToHttp().getRequest();
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      if (req.route) {
        // eslint-disable-next-line @sentry-internal/sdk/no-optional-chaining,@typescript-eslint/no-unsafe-member-access
        getIsolationScope().setTransactionName(`${req.method?.toUpperCase() || 'GET'} ${req.route.path}`);
      }
    }

    return next.handle();
  }
}
Injectable()(SentryTracingInterceptor);
export { SentryTracingInterceptor };

/**
 * Global filter to handle exceptions and report them to Sentry.
 */
class SentryGlobalFilter extends BaseExceptionFilter {
  public readonly __SENTRY_INTERNAL__: boolean;

  public constructor() {
    super();
    this.__SENTRY_INTERNAL__ = true;
  }

  /**
   * Catches exceptions and reports them to Sentry unless they are expected errors.
   */
  public catch(exception: unknown, host: ArgumentsHost): void {
    if (isExpectedError(exception)) {
      return super.catch(exception, host);
    }

    captureException(exception);
    return super.catch(exception, host);
  }
}
Catch()(SentryGlobalFilter);
export { SentryGlobalFilter };

/**
 * Global filter to handle exceptions and report them to Sentry.
 *
 * The BaseExceptionFilter does not work well in GraphQL applications.
 * By default, Nest GraphQL applications use the ExternalExceptionFilter, which just rethrows the error:
 * https://github.com/nestjs/nest/blob/master/packages/core/exceptions/external-exception-filter.ts
 *
 * The ExternalExceptinFilter is not exported, so we reimplement this filter here.
 */
class SentryGlobalGraphQLFilter {
  private static readonly _logger = new Logger('ExceptionsHandler');
  public readonly __SENTRY_INTERNAL__: boolean;

  public constructor() {
    this.__SENTRY_INTERNAL__ = true;
  }

  /**
   * Catches exceptions and reports them to Sentry unless they are HttpExceptions.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public catch(exception: unknown, host: ArgumentsHost): void {
    // neither report nor log HttpExceptions
    if (exception instanceof HttpException) {
      throw exception;
    }
    if (exception instanceof Error) {
      SentryGlobalGraphQLFilter._logger.error(exception.message, exception.stack);
    }
    captureException(exception);
    throw exception;
  }
}
Catch()(SentryGlobalGraphQLFilter);
export { SentryGlobalGraphQLFilter };

/**
 * Set up a root module that can be injected in nest applications.
 */
class SentryModule {
  /**
   * Configures the module as the root module in a Nest.js application.
   */
  public static forRoot(): DynamicModule {
    return {
      module: SentryModule,
      providers: [
        {
          provide: APP_INTERCEPTOR,
          useClass: SentryTracingInterceptor,
        },
      ],
    };
  }
}
Global()(SentryModule);
Module({
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: SentryTracingInterceptor,
    },
  ],
})(SentryModule);
export { SentryModule };

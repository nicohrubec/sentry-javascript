import { captureCheckIn, runWithAsyncContext } from '@sentry/core';
import type { NextApiRequest } from 'next';

import type { VercelCronsConfig } from './types';

/**
 * Wraps a function with Sentry crons instrumentation by automaticaly sending check-ins for the given Vercel crons config.
 */
export function wrapApiHandlerWithSentryVercelCrons<F extends (...args: any[]) => any>(
  handler: F,
  vercelCronsConfig: VercelCronsConfig,
): F {
  return new Proxy(handler, {
    apply: (originalFunction, thisArg, args: [NextApiRequest | undefined] | undefined) => {
      return runWithAsyncContext(() => {
        if (!args || !args[0]) {
          return originalFunction.apply(thisArg, args);
        }
        const [req] = args;

        let maybePromiseResult;
        const cronsKey = req.url;

        if (
          !vercelCronsConfig || // do nothing if vercel crons config is missing
          !req.headers['user-agent']?.includes('vercel-cron') // do nothing if endpoint is not called from vercel crons
        ) {
          return originalFunction.apply(thisArg, args);
        }

        const vercelCron = vercelCronsConfig.find(vercelCron => vercelCron.path === cronsKey);

        if (!vercelCron || !vercelCron.path || !vercelCron.schedule) {
          return originalFunction.apply(thisArg, args);
        }

        const monitorSlug = vercelCron.path;

        const checkInId = captureCheckIn(
          {
            monitorSlug,
            status: 'in_progress',
          },
          {
            checkinMargin: 2, // two minutes - in case Vercel has a blip
            maxRuntime: 60 * 12, // (minutes) so 12 hours - just a very high arbitrary number since we don't know the actual duration of the users cron job
            schedule: {
              type: 'crontab',
              value: vercelCron.schedule,
            },
          },
        );

        const startTime = Date.now() / 1000;

        const handleErrorCase = (): void => {
          captureCheckIn({
            checkInId,
            monitorSlug,
            status: 'error',
            duration: Date.now() / 1000 - startTime,
          });
        };

        try {
          maybePromiseResult = originalFunction.apply(thisArg, args);
        } catch (e) {
          handleErrorCase();
          throw e;
        }

        if (typeof maybePromiseResult === 'object' && maybePromiseResult !== null && 'then' in maybePromiseResult) {
          Promise.resolve(maybePromiseResult).then(
            () => {
              captureCheckIn({
                checkInId,
                monitorSlug,
                status: 'ok',
                duration: Date.now() / 1000 - startTime,
              });
            },
            () => {
              handleErrorCase();
            },
          );

          // It is very important that we return the original promise here, because Next.js attaches various properties
          // to that promise and will throw if they are not on the returned value.
          return maybePromiseResult;
        } else {
          captureCheckIn({
            checkInId,
            monitorSlug,
            status: 'ok',
            duration: Date.now() / 1000 - startTime,
          });
          return maybePromiseResult;
        }
      });
    },
  });
}
import type { ConsoleSession } from '../platform/operator-identity/index.console.ts';
import { listReleases } from './registry/release.query.ts';

export function releaseConsoleRoutes(session: ConsoleSession) {
    return {
        listReleases: session.operatorProcedure
            .route({ method: 'GET', path: '/api/v1/releases' })
            .handler(async ({ context }) => ({
                releases: await listReleases(context.db),
            })),
    };
}

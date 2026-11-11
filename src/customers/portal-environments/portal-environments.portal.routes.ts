import type { PortalSession } from '../portal-access/portal-session.portal.ts';
import { listPortalEnvironments } from './portal-environments.service.ts';

export function portalEnvironmentRoutes(session: PortalSession) {
    return {
        listEnvironments: session.clientProcedure
            .route({ method: 'GET', path: '/api/v1/environments' })
            .handler(async ({ context }) => ({
                customers: await listPortalEnvironments(
                    context.db,
                    context.identity,
                ),
            })),
    };
}

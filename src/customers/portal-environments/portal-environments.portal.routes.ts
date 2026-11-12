import type { Config } from '../../platform/config/index.ts';
import type { PortalSession } from '../portal-access/portal-session.portal.ts';
import { listPortalEnvironments } from './portal-environments.service.ts';

export function portalEnvironmentRoutes(
    config: Config,
    session: PortalSession,
) {
    return {
        listEnvironments: session.clientProcedure
            .route({ method: 'GET', path: '/api/v1/environments' })
            .handler(async ({ context }) => ({
                tenant: await listPortalEnvironments(
                    context.db,
                    context.tenant.tenant_id,
                    config.OPERATIONS_URL,
                ),
            })),
    };
}

import { z } from 'zod';
import type { ConsoleSession } from '../../platform/operator-identity/index.console.ts';
import { listRuntimeHosts, revokeRuntimeHost } from './runtime-host.service.ts';

// Host baru tetap didaftarkan lewat `bun dist/cli.js add-runtime-host`, karena kunci privatnya dibuat di host itu.
export function runtimeHostConsoleRoutes(session: ConsoleSession) {
    const { operatorProcedure } = session;
    return {
        listRuntimeHosts: operatorProcedure
            .route({ method: 'GET', path: '/api/v1/runtime-hosts' })
            .handler(async ({ context }) => ({
                runtime_hosts: await listRuntimeHosts(context.db),
            })),
        revokeRuntimeHost: operatorProcedure
            .route({
                method: 'POST',
                path: '/api/v1/runtime-hosts/{host}/revoke',
                inputStructure: 'detailed',
                successStatus: 204,
            })
            .input(z.object({ params: z.object({ host: z.uuid() }) }))
            .handler(async ({ context, input }) => {
                await revokeRuntimeHost(
                    context.db,
                    {
                        operatorId: context.operator.id,
                        ipAddress: context.clientAddress,
                    },
                    input.params.host,
                );
            }),
    };
}

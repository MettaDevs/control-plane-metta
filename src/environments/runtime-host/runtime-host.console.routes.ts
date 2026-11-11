import { z } from 'zod';
import type { ConsoleSession } from '../../platform/operator-identity/index.console.ts';
import { HttpFailure } from '../../platform/http/index.ts';
import {
    listRuntimeHosts,
    revokeRuntimeHost,
    runtimeHostSettingsSchema,
    updateRuntimeHostSettings,
} from './runtime-host.service.ts';

// Host baru tetap didaftarkan lewat `bun dist/cli.js add-runtime-host`, karena kunci privatnya dibuat di host itu.
export function runtimeHostConsoleRoutes(session: ConsoleSession) {
    const { operatorProcedure } = session;
    return {
        listRuntimeHosts: operatorProcedure
            .route({ method: 'GET', path: '/api/v1/runtime-hosts' })
            .handler(async ({ context }) => ({
                runtime_hosts: await listRuntimeHosts(context.db),
            })),
        // Body diperiksa handler supaya isian yang salah dijawab 422 dengan pesan per field.
        updateRuntimeHostSettings: operatorProcedure
            .route({
                method: 'PUT',
                path: '/api/v1/runtime-hosts/{host}/settings',
                inputStructure: 'detailed',
                successStatus: 204,
            })
            .input(
                z.object({
                    params: z.object({ host: z.uuid() }),
                    body: z.custom<z.input<typeof runtimeHostSettingsSchema>>(),
                }),
            )
            .handler(async ({ context, input }) => {
                const settings = runtimeHostSettingsSchema.safeParse(
                    input.body,
                );
                if (!settings.success)
                    throw new HttpFailure(422, {
                        message: 'Periksa pengaturan host runtime.',
                        errors: Object.fromEntries(
                            settings.error.issues.map((issue) => [
                                issue.path.join('.') || '_form',
                                [issue.message],
                            ]),
                        ),
                    });
                await updateRuntimeHostSettings(
                    context.db,
                    {
                        operatorId: context.operator.id,
                        ipAddress: context.clientAddress,
                    },
                    input.params.host,
                    settings.data,
                );
            }),
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

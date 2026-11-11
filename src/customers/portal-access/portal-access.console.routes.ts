import { z } from 'zod';
import type { Config } from '../../platform/config/index.ts';
import { HttpFailure } from '../../platform/http/index.ts';
import type { ConsoleSession } from '../../platform/operator-identity/index.console.ts';
import {
    cancelPortalInvitation,
    invitationInputErrors,
    invitationInputSchema,
    inviteToPortal,
    listPortalAccess,
    resendPortalInvitation,
    revokePortalUser,
} from './portal-access.service.ts';

export function portalAccessConsoleRoutes(
    config: Config,
    session: ConsoleSession,
) {
    const { operatorProcedure } = session;
    return {
        listPortalAccess: operatorProcedure
            .route({
                method: 'GET',
                path: '/api/v1/customers/{client}/portal-access',
                inputStructure: 'detailed',
            })
            .input(z.object({ params: z.object({ client: z.uuid() }) }))
            .handler(async ({ context, input }) => ({
                configured: config.portal !== null,
                access: await listPortalAccess(context.db, input.params.client),
            })),
        // Body diperiksa handler supaya isian yang salah dijawab 422 dengan pesan per field.
        inviteToPortal: operatorProcedure
            .route({
                method: 'POST',
                path: '/api/v1/customers/{client}/portal-invitations',
                inputStructure: 'detailed',
                successStatus: 201,
            })
            .input(
                z.object({
                    params: z.object({ client: z.uuid() }),
                    body: z.custom<z.input<typeof invitationInputSchema>>(),
                }),
            )
            .handler(async ({ context, input }) => {
                const body = invitationInputSchema.safeParse(input.body);
                if (!body.success)
                    throw new HttpFailure(422, {
                        message: 'Periksa isian undangan.',
                        errors: invitationInputErrors(body.error),
                    });
                return inviteToPortal(
                    context.db,
                    config,
                    {
                        operatorId: context.operator.id,
                        ipAddress: context.clientAddress,
                    },
                    input.params.client,
                    body.data,
                );
            }),
        resendPortalInvitation: operatorProcedure
            .route({
                method: 'POST',
                path: '/api/v1/portal-invitations/{invitation}/resend',
                inputStructure: 'detailed',
            })
            .input(z.object({ params: z.object({ invitation: z.uuid() }) }))
            .handler(async ({ context, input }) =>
                resendPortalInvitation(
                    context.db,
                    config,
                    {
                        operatorId: context.operator.id,
                        ipAddress: context.clientAddress,
                    },
                    input.params.invitation,
                ),
            ),
        cancelPortalInvitation: operatorProcedure
            .route({
                method: 'DELETE',
                path: '/api/v1/portal-invitations/{invitation}',
                inputStructure: 'detailed',
                successStatus: 204,
            })
            .input(z.object({ params: z.object({ invitation: z.uuid() }) }))
            .handler(async ({ context, input }) => {
                await cancelPortalInvitation(
                    context.db,
                    {
                        operatorId: context.operator.id,
                        ipAddress: context.clientAddress,
                    },
                    input.params.invitation,
                );
            }),
        revokePortalUser: operatorProcedure
            .route({
                method: 'DELETE',
                path: '/api/v1/portal-users/{user}',
                inputStructure: 'detailed',
                successStatus: 204,
            })
            .input(z.object({ params: z.object({ user: z.uuid() }) }))
            .handler(async ({ context, input }) => {
                await revokePortalUser(
                    context.db,
                    {
                        operatorId: context.operator.id,
                        ipAddress: context.clientAddress,
                    },
                    input.params.user,
                );
            }),
    };
}

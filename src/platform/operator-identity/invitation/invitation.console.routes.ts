import { z } from 'zod';
import type { Config } from '../../config/index.ts';
import { HttpFailure } from '../../http/index.ts';
import {
    invitationInputErrors,
    invitationInputSchema,
} from '../../oidc/index.ts';
import type { ConsoleSession } from '../session.console.ts';
import {
    cancelOperatorInvitation,
    findOperatorInvitation,
    inviteOperator,
    listOperators,
    resendOperatorInvitation,
} from './invitation.service.ts';

// Setiap operator memegang akses yang sama, jadi setiap operator yang login boleh mengundang.
export function operatorInvitationRoutes(
    config: Config,
    session: ConsoleSession,
) {
    const { consoleBase, operatorProcedure } = session;
    const actor = (context: {
        operator: { id: string };
        clientAddress: string;
    }) => ({
        operatorId: context.operator.id,
        ipAddress: context.clientAddress,
    });
    return {
        listOperators: operatorProcedure
            .route({ method: 'GET', path: '/api/v1/operators' })
            .handler(async ({ context }) => ({
                sso_configured: config.sso !== null,
                rows: await listOperators(
                    context.db,
                    config.sso?.issuer ?? null,
                ),
            })),
        // Body diperiksa handler supaya isian yang salah dijawab 422 dengan pesan per field.
        inviteOperator: operatorProcedure
            .route({
                method: 'POST',
                path: '/api/v1/operator-invitations',
                inputStructure: 'detailed',
                successStatus: 201,
            })
            .input(
                z.object({
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
                return inviteOperator(
                    context.db,
                    config,
                    actor(context),
                    body.data,
                );
            }),
        resendOperatorInvitation: operatorProcedure
            .route({
                method: 'POST',
                path: '/api/v1/operator-invitations/{invitation}/resend',
                inputStructure: 'detailed',
            })
            .input(z.object({ params: z.object({ invitation: z.uuid() }) }))
            .handler(async ({ context, input }) =>
                resendOperatorInvitation(
                    context.db,
                    config,
                    actor(context),
                    input.params.invitation,
                ),
            ),
        cancelOperatorInvitation: operatorProcedure
            .route({
                method: 'DELETE',
                path: '/api/v1/operator-invitations/{invitation}',
                inputStructure: 'detailed',
                successStatus: 204,
            })
            .input(z.object({ params: z.object({ invitation: z.uuid() }) }))
            .handler(async ({ context, input }) => {
                await cancelOperatorInvitation(
                    context.db,
                    actor(context),
                    input.params.invitation,
                );
            }),
        // Dibaca halaman undangan sebelum login: hanya siapa yang mengundang dan apakah tautannya masih bisa dipakai.
        showOperatorInvitation: consoleBase
            .route({
                method: 'GET',
                path: '/api/v1/invitation',
                inputStructure: 'detailed',
            })
            .input(z.object({ query: z.object({ token: z.string() }) }))
            .handler(async ({ context, input }) => {
                const invitation = await findOperatorInvitation(
                    context.db,
                    input.query.token,
                );
                if (!invitation)
                    throw new HttpFailure(404, {
                        error: 'invitation_not_found',
                        message: 'Undangan ini tidak dikenal.',
                    });
                return invitation;
            }),
    };
}

import { z } from 'zod';
import type { Config } from '../../platform/config/index.ts';
import { HttpFailure } from '../../platform/http/index.ts';
import {
    invitationInputErrors,
    invitationInputSchema,
} from '../../platform/oidc/index.ts';
import type { TenantAccess } from '../portal-access/portal-identity.service.ts';
import {
    cancelPortalInvitation,
    type Inviter,
    inviteToPortal,
    listTenantMembers,
    resendPortalInvitation,
} from '../portal-access/portal-access.service.ts';
import type { PortalSession } from '../portal-access/portal-session.portal.ts';

// Hanya admin tenant aktif yang mengundang, mengirim ulang, dan membatalkan. Undangan dari portal selalu undangan
// member ke tenant aktif, dan hanya menyentuh undangan tenant itu.
function adminOf(
    tenant: TenantAccess,
    ipAddress: string,
): Extract<Inviter, { portalUser: unknown }> {
    if (!tenant.is_admin)
        throw new HttpFailure(403, {
            error: 'not_tenant_admin',
            message: 'Hanya admin klinik ini yang bisa mengundang anggota.',
        });
    return {
        portalUser: {
            id: tenant.portal_user_id,
            tenantId: tenant.tenant_id,
            name: tenant.name_at_link,
            email: tenant.email_at_link,
        },
        ipAddress,
    };
}

export function portalMemberRoutes(config: Config, session: PortalSession) {
    const { clientProcedure } = session;
    return {
        listMembers: clientProcedure
            .route({ method: 'GET', path: '/api/v1/members' })
            .handler(async ({ context }) => ({
                can_invite: context.tenant.is_admin,
                members: await listTenantMembers(
                    context.db,
                    context.tenant.tenant_id,
                ),
            })),
        // Body diperiksa handler supaya isian yang salah dijawab 422 dengan pesan per field.
        inviteMember: clientProcedure
            .route({
                method: 'POST',
                path: '/api/v1/members/invitations',
                inputStructure: 'detailed',
                successStatus: 201,
            })
            .input(
                z.object({
                    body: z.custom<z.input<typeof invitationInputSchema>>(),
                }),
            )
            .handler(async ({ context, input }) => {
                const inviter = adminOf(context.tenant, context.clientAddress);
                const body = invitationInputSchema.safeParse(input.body);
                if (!body.success)
                    throw new HttpFailure(422, {
                        message: 'Periksa isian undangan.',
                        errors: invitationInputErrors(body.error),
                    });
                return inviteToPortal(
                    context.db,
                    config,
                    inviter,
                    {
                        clientId: context.tenant.client_id,
                        tenantId: context.tenant.tenant_id,
                        kind: 'member',
                    },
                    body.data,
                );
            }),
        resendMemberInvitation: clientProcedure
            .route({
                method: 'POST',
                path: '/api/v1/members/invitations/{invitation}/resend',
                inputStructure: 'detailed',
            })
            .input(z.object({ params: z.object({ invitation: z.uuid() }) }))
            .handler(async ({ context, input }) =>
                resendPortalInvitation(
                    context.db,
                    config,
                    adminOf(context.tenant, context.clientAddress),
                    input.params.invitation,
                ),
            ),
        cancelMemberInvitation: clientProcedure
            .route({
                method: 'DELETE',
                path: '/api/v1/members/invitations/{invitation}',
                inputStructure: 'detailed',
                successStatus: 204,
            })
            .input(z.object({ params: z.object({ invitation: z.uuid() }) }))
            .handler(async ({ context, input }) => {
                await cancelPortalInvitation(
                    context.db,
                    adminOf(context.tenant, context.clientAddress),
                    input.params.invitation,
                );
            }),
    };
}

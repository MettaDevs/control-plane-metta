import { z } from 'zod';
import { HttpFailure, jsonBase } from '../../platform/http/index.ts';
import {
    findInvitation,
    portalAccount,
    revokePortalSessions,
} from './portal-identity.service.ts';
import type { PortalSession } from './portal-session.portal.ts';

export function portalAccountRoutes(session: PortalSession) {
    const { clientProcedure } = session;
    return {
        // Dibaca halaman undangan sebelum login: hanya nama customer dan apakah tautannya masih bisa dipakai.
        showInvitation: jsonBase
            .route({
                method: 'GET',
                path: '/api/v1/invitation',
                inputStructure: 'detailed',
            })
            .input(z.object({ query: z.object({ token: z.string() }) }))
            .handler(async ({ context, input }) => {
                const invitation = await findInvitation(
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
        me: clientProcedure
            .route({ method: 'GET', path: '/api/v1/me' })
            .handler(({ context }) =>
                portalAccount(context.db, context.identity),
            ),
        // Logout mengakhiri semua sesi portal identitas ini, termasuk di perangkat lain, sama dengan konsol.
        logout: clientProcedure
            .route({ method: 'POST', path: '/logout', successStatus: 204 })
            .handler(async ({ context }) => {
                await revokePortalSessions(
                    context.db,
                    context.identity,
                    Date.now(),
                );
                context.setCookies.length = 0;
                session.clear(context);
            }),
    };
}

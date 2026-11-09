import { z } from 'zod';
import {
    agentError,
    parseJson,
    signedProcedure,
} from '../signature/agent-request.agent.ts';
import { validSitePublicKey } from '../site-key.ts';

// Rotasi kunci: ditandatangani kunci lama, dan sesudah jawaban 200 hanya kunci baru yang diterima. Tidak ada masa
// tumpang tindih; agen yang tidak menerima jawaban menyimpan kunci barunya sebagai kunci tertunda dan mencobanya
// sekali bila kunci lama ditolak.
export const siteKeyAgentRoutes = () => ({
    rotateSiteKey: signedProcedure
        .route({
            method: 'POST',
            path: '/api/agent/v1/key',
            outputStructure: 'detailed',
        })
        .handler(async ({ context }) => {
            const input = z
                .strictObject({ public_key: z.string() })
                .safeParse(parseJson(context.body));
            if (!input.success) throw agentError(422, 'invalid_request');
            const publicKey = validSitePublicKey(input.data.public_key);
            if (!publicKey) throw agentError(422, 'public_key_invalid');
            await context.db.execute(
                `update sites set public_key = $2, updated_at = now() at time zone 'utc' where id = $1`,
                [context.site.id, publicKey],
            );
            return { status: 200, headers: {}, body: undefined };
        }),
});

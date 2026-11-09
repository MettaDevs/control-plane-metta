import { z } from 'zod';
import { toAgentId } from '../agent-id.ts';
import {
    agentError,
    enrollProcedure,
    parseJson,
} from '../signature/agent-request.agent.ts';
import { validSitePublicKey } from '../site-key.ts';
import { redeemEnrollmentToken } from './enrollment.service.ts';

const enrollSchema = z.strictObject({
    token: z.string().min(32),
    public_key: z.string(),
    agent_version: z.string().max(40),
});

// Jarak antarlaporan yang diminta dari agen, dalam detik. Sama dengan konsol CoreERP.
export const reportIntervalSeconds = 60;

export const enrollmentAgentRoutes = () => ({
    enrollSite: enrollProcedure
        .route({
            method: 'POST',
            path: '/api/agent/v1/enroll',
            successStatus: 201,
        })
        .handler(async ({ context }) => {
            const input = enrollSchema.safeParse(
                parseJson(await context.rawBody()),
            );
            if (!input.success) throw agentError(422, 'invalid_request');
            // Kunci yang tidak sah ditolak sebelum token disentuh, jadi tokennya tidak terpakai.
            const publicKey = validSitePublicKey(input.data.public_key);
            if (!publicKey) throw agentError(422, 'public_key_invalid');
            const site = await redeemEnrollmentToken(
                context.db,
                input.data.token,
                publicKey,
            );
            if (!site) throw agentError(401, 'enrollment_rejected');
            return {
                site_id: toAgentId(site.site_id),
                tenant_id: toAgentId(site.tenant_id),
                tenant_name: site.tenant_name,
                interval_seconds: reportIntervalSeconds,
                update_window:
                    site.window_start && site.window_end
                        ? {
                              start: site.window_start,
                              end: site.window_end,
                              timezone: site.timezone,
                          }
                        : null,
                // Kunci lisensi belum dipindah ke repo ini; agen hanya menyimpannya bila berupa string.
                license_public_key: null,
            };
        }),
});

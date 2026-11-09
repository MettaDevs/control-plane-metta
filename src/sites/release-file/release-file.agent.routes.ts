import { z } from 'zod';
import { findRelease, releaseFile } from '../../releases/index.ts';
import {
    agentError,
    signedProcedure,
} from '../signature/agent-request.agent.ts';

// Agen mengunduh lima berkas rilis untuk edisi situsnya sendiri, lalu memeriksa sendiri tanda tangan SHA256SUMS dan
// checksum setiap berkas sebelum memakainya. Edisi lain, rilis yang tidak terdaftar, dan berkas lain dijawab 404.
export const releaseFileAgentRoutes = () => ({
    downloadReleaseFile: signedProcedure
        .route({
            method: 'GET',
            path: '/api/agent/v1/releases/{edition}/{release}/files/{file}',
            inputStructure: 'detailed',
            outputStructure: 'detailed',
        })
        .input(
            z.object({
                params: z.object({
                    edition: z.string(),
                    release: z.string(),
                    file: z.string(),
                }),
            }),
        )
        .handler(async ({ context, input }) => {
            const { edition, release, file } = input.params;
            const stored =
                edition === context.site.edition && /^[A-Za-z0-9.]+$/.test(file)
                    ? await findRelease(context.db, edition, release)
                    : null;
            const bytes = stored ? releaseFile(stored, file) : null;
            if (!bytes) throw agentError(404, 'not_found');
            return {
                status: 200,
                headers: {
                    'content-type': 'application/octet-stream',
                    'cache-control': 'no-store',
                },
                body: new Blob([bytes], { type: 'application/octet-stream' }),
            };
        }),
});

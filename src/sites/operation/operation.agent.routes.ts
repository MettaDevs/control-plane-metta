import { z } from 'zod';
import type { Config } from '../../platform/config/index.ts';
import { releaseClosedRobots } from '../registry-credential/registry-credential.service.ts';
import { fromAgentId, toAgentId } from '../agent-id.ts';
import {
    agentError,
    parseJson,
    signedProcedure,
} from '../signature/agent-request.agent.ts';
import { claimOperation, recordStep, stepSchema } from './operation.service.ts';

export const operationAgentRoutes = (config: Config) => ({
    // Isi request wajib objek kosong. Tidak ada operasi yang boleh diambil dijawab 204 tanpa isi.
    claimOperation: signedProcedure
        .route({
            method: 'POST',
            path: '/api/agent/v1/operations/claim',
            outputStructure: 'detailed',
        })
        .handler(async ({ context }) => {
            if (!z.strictObject({}).safeParse(parseJson(context.body)).success)
                throw agentError(422, 'invalid_request');
            const claimed = await claimOperation(context.db, context.site.id);
            // Robot registry milik operasi yang baru ditutup tenggatnya dihapus di sini, tanpa penjadwal.
            await releaseClosedRobots(
                context.db,
                config,
                context.site.id,
                context.clientAddress,
            );
            if (!claimed) return { status: 204, headers: {}, body: undefined };
            return {
                status: 200,
                headers: {},
                body: { ...claimed, id: toAgentId(claimed.id) },
            };
        }),
    reportOperationStep: signedProcedure
        .route({
            method: 'POST',
            path: '/api/agent/v1/operations/{operation}/steps',
            inputStructure: 'detailed',
        })
        .input(z.object({ params: z.object({ operation: z.string() }) }))
        .handler(async ({ context, input }) => {
            const step = stepSchema.safeParse(parseJson(context.body));
            if (!step.success) throw agentError(422, 'invalid_request');
            const operationId = fromAgentId(input.params.operation);
            const recorded = operationId
                ? await recordStep(
                      context.db,
                      context.site.id,
                      operationId,
                      step.data,
                  )
                : null;
            if (!recorded) throw agentError(409, 'operation_not_held');
            if (step.data.status !== 'running')
                await releaseClosedRobots(
                    context.db,
                    config,
                    context.site.id,
                    context.clientAddress,
                );
            return recorded;
        }),
});

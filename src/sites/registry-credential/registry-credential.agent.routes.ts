import { z } from 'zod';
import type { Config } from '../../platform/config/index.ts';
import { RegistryUnavailable } from '../../releases/index.ts';
import { fromAgentId } from '../agent-id.ts';
import {
    agentError,
    parseJson,
    signedProcedure,
} from '../signature/agent-request.agent.ts';
import { issueRegistryCredential } from './registry-credential.service.ts';

export const registryCredentialAgentRoutes = (config: Config) => ({
    issueRegistryCredential: signedProcedure
        .route({
            method: 'POST',
            path: '/api/agent/v1/registry-credential',
            outputStructure: 'detailed',
        })
        .handler(async ({ context }) => {
            const input = z
                .strictObject({ operation_id: z.string().min(1).max(36) })
                .safeParse(parseJson(context.body));
            if (!input.success) throw agentError(422, 'invalid_request');
            const operationId = fromAgentId(input.data.operation_id);
            if (!operationId) throw agentError(409, 'operation_not_held');
            try {
                return {
                    status: 200,
                    headers: { 'cache-control': 'no-store' },
                    body: await issueRegistryCredential(
                        context.db,
                        config,
                        context.site.id,
                        operationId,
                        context.clientAddress,
                    ),
                };
            } catch (error) {
                if (!(error instanceof RegistryUnavailable)) throw error;
                process.stderr.write(
                    JSON.stringify({
                        event: 'registry-unavailable',
                        site_id: context.site.id,
                        message: error.message,
                    }) + '\n',
                );
                throw agentError(503, 'registry_unavailable');
            }
        }),
});

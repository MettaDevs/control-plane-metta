import { z } from 'zod';
import type { ConsoleSession } from '../../platform/operator-identity/index.console.ts';
import { requestMigration } from './environment-operation.service.ts';

export function environmentOperationConsoleRoutes(session: ConsoleSession) {
    return {
        requestEnvironmentOperation: session.operatorProcedure
            .route({
                method: 'POST',
                path: '/api/v1/environments/{environment}/operations',
                inputStructure: 'detailed',
                successStatus: 201,
            })
            .input(
                z.object({
                    params: z.object({ environment: z.uuid() }),
                    body: z.object({ operation: z.enum(['migrate']) }),
                }),
            )
            .handler(({ context, input }) =>
                requestMigration(
                    context.db,
                    {
                        operatorId: context.operator.id,
                        ipAddress: context.clientAddress,
                    },
                    input.params.environment,
                ),
            ),
    };
}

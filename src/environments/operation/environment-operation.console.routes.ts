import { z } from 'zod';
import type { ConsoleSession } from '../../platform/operator-identity/index.console.ts';
import {
    requestConversion,
    requestMigration,
} from './environment-operation.service.ts';

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
                    body: z.object({
                        operation: z.enum(['migrate', 'convert']),
                    }),
                }),
            )
            .handler(({ context, input }) => {
                const actor = {
                    operatorId: context.operator.id,
                    ipAddress: context.clientAddress,
                };
                const { environment } = input.params;
                switch (input.body.operation) {
                    case 'migrate':
                        return requestMigration(context.db, actor, environment);
                    case 'convert':
                        return requestConversion(
                            context.db,
                            actor,
                            environment,
                        );
                    default: {
                        const unknown: never = input.body.operation;
                        throw new Error(
                            `Operasi tidak dikenal: ${String(unknown)}`,
                        );
                    }
                }
            }),
    };
}

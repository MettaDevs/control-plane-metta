import { z } from 'zod';
import type { ConsoleSession } from '../../platform/operator-identity/index.console.ts';
import {
    requestConversion,
    requestCopy,
    requestMigration,
    requestRestore,
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
                        operation: z.enum([
                            'migrate',
                            'convert',
                            'restore',
                            'copy',
                        ]),
                        // Tanggal berakhir baru, wajib saat memulihkan demo.
                        expires_at: z.iso.date().optional(),
                        // Nama sandbox baru, saat menyalin produksi.
                        name: z.string().trim().min(1).max(100).optional(),
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
                    case 'restore':
                        return requestRestore(
                            context.db,
                            actor,
                            environment,
                            input.body.expires_at,
                        );
                    case 'copy':
                        return requestCopy(
                            context.db,
                            actor,
                            environment,
                            input.body.name ?? 'Sandbox',
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

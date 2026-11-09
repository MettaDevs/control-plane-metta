import { z } from 'zod';
import { HttpFailure } from '../../platform/http/index.ts';
import type { ConsoleSession } from '../../platform/operator-identity/index.console.ts';
import {
    cancelOperation,
    manualOperations,
    requestOperation,
    revokeSite,
} from '../operation/operation.service.ts';
import {
    findSite,
    issueSiteEnrollmentToken,
    listSites,
} from './site.service.ts';

const siteParams = z.object({ params: z.object({ site: z.uuid() }) });

export function siteConsoleRoutes(session: ConsoleSession) {
    const { operatorProcedure } = session;
    const actor = (context: {
        operator: { id: string };
        clientAddress: string;
    }) => ({
        operatorId: context.operator.id,
        ipAddress: context.clientAddress,
    });

    return {
        listSites: operatorProcedure
            .route({ method: 'GET', path: '/api/v1/sites' })
            .handler(async ({ context }) => ({
                sites: await listSites(context.db),
            })),
        showSite: operatorProcedure
            .route({
                method: 'GET',
                path: '/api/v1/sites/{site}',
                inputStructure: 'detailed',
            })
            .input(siteParams)
            .handler(async ({ context, input }) => ({
                site: await findSite(context.db, input.params.site),
            })),
        // Token baru membatalkan token lama yang belum dipakai. Server klien memakainya sekali dalam 60 menit:
        // coreerp-agent enroll --admin-url <alamat agen> --token <token>.
        issueEnrollmentToken: operatorProcedure
            .route({
                method: 'POST',
                path: '/api/v1/sites/{site}/enrollment-tokens',
                inputStructure: 'detailed',
                successStatus: 201,
            })
            .input(siteParams)
            .handler(async ({ context, input }) => ({
                ...(await issueSiteEnrollmentToken(
                    context.db,
                    actor(context),
                    input.params.site,
                )),
                expires_in_minutes: 60,
            })),
        requestOperation: operatorProcedure
            .route({
                method: 'POST',
                path: '/api/v1/sites/{site}/operations',
                inputStructure: 'detailed',
                successStatus: 201,
            })
            .input(
                siteParams.extend({
                    body: z.object({ operation: z.string() }),
                }),
            )
            .handler(async ({ context, input }) => {
                const operation = z
                    .enum(manualOperations)
                    .safeParse(input.body.operation);
                // Pembaruan rilis dan lisensi belum dipindah ke konsol ini; install dibuat dari halaman lingkungan.
                if (!operation.success)
                    throw new HttpFailure(422, {
                        error: 'operation_unavailable',
                        message:
                            'Operasi ini belum bisa diminta dari konsol ini.',
                    });
                return requestOperation(
                    context.db,
                    actor(context),
                    input.params.site,
                    operation.data,
                );
            }),
        cancelOperation: operatorProcedure
            .route({
                method: 'POST',
                path: '/api/v1/sites/{site}/operations/{operation}/cancel',
                inputStructure: 'detailed',
                successStatus: 204,
            })
            .input(
                z.object({
                    params: z.object({ site: z.uuid(), operation: z.uuid() }),
                }),
            )
            .handler(async ({ context, input }) => {
                await cancelOperation(
                    context.db,
                    actor(context),
                    input.params.site,
                    input.params.operation,
                );
            }),
        revokeSite: operatorProcedure
            .route({
                method: 'POST',
                path: '/api/v1/sites/{site}/revoke',
                inputStructure: 'detailed',
                successStatus: 204,
            })
            .input(siteParams)
            .handler(async ({ context, input }) => {
                await revokeSite(context.db, actor(context), input.params.site);
            }),
    };
}

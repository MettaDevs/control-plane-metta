import { z } from 'zod';
import { HttpFailure } from '../../platform/http/index.ts';
import type { ConsoleSession } from '../../platform/operator-identity/index.console.ts';
import {
    changeEntitlement,
    entitlementChangeSchema,
    entitlementInputErrors,
    entitlementInputSchema,
    grantEntitlement,
    listCatalog,
    revokeEntitlement,
} from './entitlement.service.ts';

// Body diperiksa handler supaya isian yang salah dijawab 422 dengan pesan per field.
function parseBody<S extends z.ZodType>(schema: S, body: unknown): z.output<S> {
    const parsed = schema.safeParse(body);
    if (!parsed.success)
        throw new HttpFailure(422, {
            message: 'Periksa isian module.',
            errors: entitlementInputErrors(parsed.error),
        });
    return parsed.data;
}

export function entitlementConsoleRoutes(session: ConsoleSession) {
    const { operatorProcedure } = session;
    return {
        listModuleCatalog: operatorProcedure
            .route({ method: 'GET', path: '/api/v1/catalog/modules' })
            .handler(async ({ context }) => ({
                modules: await listCatalog(context.db),
            })),
        grantEntitlement: operatorProcedure
            .route({
                method: 'POST',
                path: '/api/v1/tenants/{tenant}/entitlements',
                inputStructure: 'detailed',
                successStatus: 201,
            })
            .input(
                z.object({
                    params: z.object({ tenant: z.uuid() }),
                    body: z.custom<z.input<typeof entitlementInputSchema>>(),
                }),
            )
            .handler(async ({ context, input }) =>
                grantEntitlement(
                    context.db,
                    {
                        operatorId: context.operator.id,
                        ipAddress: context.clientAddress,
                    },
                    input.params.tenant,
                    parseBody(entitlementInputSchema, input.body),
                ),
            ),
        changeEntitlement: operatorProcedure
            .route({
                method: 'PUT',
                path: '/api/v1/entitlements/{entitlement}',
                inputStructure: 'detailed',
                successStatus: 204,
            })
            .input(
                z.object({
                    params: z.object({ entitlement: z.uuid() }),
                    body: z.custom<z.input<typeof entitlementChangeSchema>>(),
                }),
            )
            .handler(async ({ context, input }) => {
                await changeEntitlement(
                    context.db,
                    {
                        operatorId: context.operator.id,
                        ipAddress: context.clientAddress,
                    },
                    input.params.entitlement,
                    parseBody(entitlementChangeSchema, input.body),
                );
            }),
        revokeEntitlement: operatorProcedure
            .route({
                method: 'POST',
                path: '/api/v1/entitlements/{entitlement}/revoke',
                inputStructure: 'detailed',
                successStatus: 204,
            })
            .input(z.object({ params: z.object({ entitlement: z.uuid() }) }))
            .handler(async ({ context, input }) => {
                await revokeEntitlement(
                    context.db,
                    {
                        operatorId: context.operator.id,
                        ipAddress: context.clientAddress,
                    },
                    input.params.entitlement,
                );
            }),
    };
}

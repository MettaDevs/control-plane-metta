import { z } from 'zod';
import { HttpFailure } from '../../platform/http/index.ts';
import type { ConsoleSession } from '../../platform/operator-identity/index.console.ts';
import {
    createPackage,
    deletePackage,
    grantPackage,
    listPackages,
    packageGrantSchema,
    packageInputErrors,
    packageInputSchema,
    updatePackage,
} from './package.service.ts';

// Body diperiksa handler supaya isian yang salah dijawab 422 dengan pesan per field.
function parseBody<S extends z.ZodType>(schema: S, body: unknown): z.output<S> {
    const parsed = schema.safeParse(body);
    if (!parsed.success)
        throw new HttpFailure(422, {
            message: 'Periksa isian susunan module.',
            errors: packageInputErrors(parsed.error),
        });
    return parsed.data;
}

export function packageConsoleRoutes(session: ConsoleSession) {
    const { operatorProcedure } = session;
    return {
        listPackages: operatorProcedure
            .route({ method: 'GET', path: '/api/v1/catalog/packages' })
            .handler(async ({ context }) => ({
                packages: await listPackages(context.db),
            })),
        createPackage: operatorProcedure
            .route({
                method: 'POST',
                path: '/api/v1/catalog/packages',
                inputStructure: 'detailed',
                successStatus: 201,
            })
            .input(
                z.object({
                    body: z.custom<z.input<typeof packageInputSchema>>(),
                }),
            )
            .handler(async ({ context, input }) =>
                createPackage(
                    context.db,
                    {
                        operatorId: context.operator.id,
                        ipAddress: context.clientAddress,
                    },
                    parseBody(packageInputSchema, input.body),
                ),
            ),
        updatePackage: operatorProcedure
            .route({
                method: 'PUT',
                path: '/api/v1/catalog/packages/{package}',
                inputStructure: 'detailed',
                successStatus: 204,
            })
            .input(
                z.object({
                    params: z.object({ package: z.uuid() }),
                    body: z.custom<z.input<typeof packageInputSchema>>(),
                }),
            )
            .handler(async ({ context, input }) => {
                await updatePackage(
                    context.db,
                    {
                        operatorId: context.operator.id,
                        ipAddress: context.clientAddress,
                    },
                    input.params.package,
                    parseBody(packageInputSchema, input.body),
                );
            }),
        deletePackage: operatorProcedure
            .route({
                method: 'DELETE',
                path: '/api/v1/catalog/packages/{package}',
                inputStructure: 'detailed',
                successStatus: 204,
            })
            .input(z.object({ params: z.object({ package: z.uuid() }) }))
            .handler(async ({ context, input }) => {
                await deletePackage(
                    context.db,
                    {
                        operatorId: context.operator.id,
                        ipAddress: context.clientAddress,
                    },
                    input.params.package,
                );
            }),
        grantPackage: operatorProcedure
            .route({
                method: 'POST',
                path: '/api/v1/tenants/{tenant}/packages',
                inputStructure: 'detailed',
                successStatus: 201,
            })
            .input(
                z.object({
                    params: z.object({ tenant: z.uuid() }),
                    body: z.custom<z.input<typeof packageGrantSchema>>(),
                }),
            )
            .handler(async ({ context, input }) =>
                grantPackage(
                    context.db,
                    {
                        operatorId: context.operator.id,
                        ipAddress: context.clientAddress,
                    },
                    input.params.tenant,
                    parseBody(packageGrantSchema, input.body),
                ),
            ),
    };
}

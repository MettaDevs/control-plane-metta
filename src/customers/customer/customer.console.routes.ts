import { z } from 'zod';
import type { Config } from '../../platform/config/index.ts';
import { HttpFailure } from '../../platform/http/index.ts';
import type { ConsoleSession } from '../../platform/operator-identity/index.console.ts';
import {
    createCustomer,
    customerInputErrors,
    customerInputSchema,
    findCustomer,
    listCustomers,
} from './customer.service.ts';
import { inviteToPortal } from '../portal-access/portal-access.service.ts';

// Body dan header diperiksa handler, bukan oRPC, supaya isian yang salah dijawab 422 dengan pesan per field. Tipe di
// sini hanya untuk pemanggil di layar.
const createCustomerInput = z.object({
    headers: z.custom<{ 'idempotency-key': string }>(),
    body: z.custom<z.input<typeof customerInputSchema>>(),
});

export function customerConsoleRoutes(config: Config, session: ConsoleSession) {
    const { operatorProcedure } = session;
    return {
        listCustomers: operatorProcedure
            .route({ method: 'GET', path: '/api/v1/customers' })
            .handler(async ({ context }) => ({
                customers: await listCustomers(context.db),
            })),
        showCustomer: operatorProcedure
            .route({
                method: 'GET',
                path: '/api/v1/customers/{client}',
                inputStructure: 'detailed',
            })
            .input(z.object({ params: z.object({ client: z.uuid() }) }))
            .handler(async ({ context, input }) => ({
                customer: await findCustomer(context.db, input.params.client),
            })),
        // Header Idempotency-Key wajib: konsol yang mengulang permintaan karena jawaban hilang tidak membuat customer
        // kedua, dan password sementara hanya tampil di jawaban pertama.
        createCustomer: operatorProcedure
            .route({
                method: 'POST',
                path: '/api/v1/customers',
                inputStructure: 'detailed',
                successStatus: 201,
            })
            .input(createCustomerInput)
            .handler(async ({ context, input }) => {
                const key = z
                    .uuid()
                    .safeParse(context.request.headers.get('idempotency-key'));
                if (!key.success)
                    throw new HttpFailure(422, {
                        error: 'idempotency_key_required',
                        message:
                            'Kirim header Idempotency-Key berisi UUID untuk setiap customer baru.',
                    });
                const body = customerInputSchema.safeParse(input.body);
                if (!body.success)
                    throw new HttpFailure(422, {
                        message: 'Periksa isian customer baru.',
                        errors: customerInputErrors(body.error),
                    });
                const actor = {
                    operatorId: context.operator.id,
                    ipAddress: context.clientAddress,
                };
                const created = await createCustomer(
                    context.db,
                    actor,
                    key.data,
                    body.data,
                );
                // Admin pertama langsung diundang ke portal klien bila portal disetel. Hanya pada jawaban pertama:
                // permintaan ulang dengan kunci yang sama (password sementara null) tidak mengirim email kedua.
                const portalInvitation =
                    config.portal && created.temporary_password !== null
                        ? await inviteToPortal(
                              context.db,
                              config,
                              actor,
                              created.client_id,
                              {
                                  recipient_email: body.data.admin.email,
                                  recipient_name: body.data.admin.name,
                              },
                          )
                        : null;
                return { ...created, portal_invitation: portalInvitation };
            }),
    };
}

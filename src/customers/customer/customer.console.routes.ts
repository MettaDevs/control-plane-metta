import { z } from 'zod';
import { HttpFailure } from '../../platform/http/index.ts';
import type { ConsoleSession } from '../../platform/operator-identity/index.console.ts';
import {
    createCustomer,
    customerInputErrors,
    customerInputSchema,
    listCustomers,
} from './customer.service.ts';

// Body dan header diperiksa handler, bukan oRPC, supaya isian yang salah dijawab 422 dengan pesan per field. Tipe di
// sini hanya untuk pemanggil di layar.
const createCustomerInput = z.object({
    headers: z.custom<{ 'idempotency-key': string }>(),
    body: z.custom<z.input<typeof customerInputSchema>>(),
});

export function customerConsoleRoutes(session: ConsoleSession) {
    const { operatorProcedure } = session;
    return {
        listCustomers: operatorProcedure
            .route({ method: 'GET', path: '/api/v1/customers' })
            .handler(async ({ context }) => ({
                customers: await listCustomers(context.db),
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
                return createCustomer(
                    context.db,
                    {
                        operatorId: context.operator.id,
                        ipAddress: context.clientAddress,
                    },
                    key.data,
                    body.data,
                );
            }),
    };
}

import { createORPCClient } from '@orpc/client';
import type { AnyContractRouter } from '@orpc/contract';
import type { JsonifiedClient } from '@orpc/openapi-client';
import type { RouterClient } from '@orpc/server';
import { createTanstackQueryUtils } from '@orpc/tanstack-query';
import type { ConsoleRouter } from '../../console.ts';
import { apiLink } from './api-client.ts';
import contract from './api-contract.generated.json';

// Klien bertipe dari router konsol di src/console.ts: input dan output setiap procedure datang dari sana, tidak ditulis
// ulang di layar.
export const api: JsonifiedClient<RouterClient<ConsoleRouter>> =
    createORPCClient(apiLink(contract as AnyContractRouter));
export const orpc = createTanstackQueryUtils(api);

// Jawaban sebuah procedure, untuk tipe data di layar.
export type ApiOutput<K extends keyof typeof api> = Awaited<
    ReturnType<(typeof api)[K]>
>;

export type Operator = ApiOutput<'me'>['operator'];

// Operator yang sedang login, untuk bingkai layar. Tanpa sesi jawabannya 401.
export const meQuery = orpc.me.queryOptions({ staleTime: 60_000 });

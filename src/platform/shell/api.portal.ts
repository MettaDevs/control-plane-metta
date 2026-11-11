import { createORPCClient } from '@orpc/client';
import type { AnyContractRouter } from '@orpc/contract';
import type { JsonifiedClient } from '@orpc/openapi-client';
import type { RouterClient } from '@orpc/server';
import { createTanstackQueryUtils } from '@orpc/tanstack-query';
import type { PortalRouter } from '../../portal.ts';
import { apiLink } from './api-client.ts';
import contract from './api-contract.portal.generated.json';

// Klien bertipe dari router portal di src/portal.ts. Bundle portal tidak membawa bentuk route konsol.
export const api: JsonifiedClient<RouterClient<PortalRouter>> =
    createORPCClient(apiLink(contract as AnyContractRouter));
export const orpc = createTanstackQueryUtils(api);

export type ApiOutput<K extends keyof typeof api> = Awaited<
    ReturnType<(typeof api)[K]>
>;

// Pengguna portal yang sedang login dan customer yang bisa dibukanya. Tanpa sesi jawabannya 401.
export const meQuery = orpc.me.queryOptions({ staleTime: 60_000 });

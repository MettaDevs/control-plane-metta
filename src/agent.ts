// Proses API agen dan pipeline rilis. Di-deploy di host publik; rute konsol dan portal tidak dimuat di sini.
import { loadConfig } from './platform/config/index.ts';
import { healthRoutes, serve } from './platform/http/index.ts';

export const agentRouter = {
    ...healthRoutes(),
};

if (import.meta.main) serve('agent', loadConfig(), agentRouter);

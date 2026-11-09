// Proses konsol operator. Di-deploy di host internal; rute untuk agen dan portal tidak dimuat di sini.
import { loadConfig } from './platform/config/index.ts';
import { healthRoutes, serve } from './platform/http/index.ts';

export const consoleRouter = {
    ...healthRoutes(),
};

if (import.meta.main) serve('console', loadConfig(), consoleRouter);

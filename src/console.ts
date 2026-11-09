// Proses konsol operator. Di-deploy di host internal; rute untuk agen dan portal tidak dimuat di sini.
import { type Config, loadConfig } from './platform/config/index.ts';
import { healthRoutes, serve } from './platform/http/index.ts';
import { operatorIdentityRoutes } from './platform/operator-identity/index.console.ts';

export function consoleRouter(config: Config) {
    return {
        ...healthRoutes(),
        ...operatorIdentityRoutes(config),
    };
}

if (import.meta.main) {
    const config = loadConfig();
    serve('console', config, consoleRouter(config));
}

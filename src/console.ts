// Proses konsol operator. Di-deploy di host internal; rute untuk agen dan portal tidak dimuat di sini.
import { type Config, loadConfig } from './platform/config/index.ts';
import { healthRoutes, serve } from './platform/http/index.ts';
import {
    consoleSession,
    operatorIdentityRoutes,
} from './platform/operator-identity/index.console.ts';
import { releaseConsoleRoutes } from './releases/index.console.ts';
import { siteConsoleRoutes } from './sites/index.console.ts';

export function consoleRouter(config: Config) {
    const session = consoleSession(config);
    return {
        ...healthRoutes(),
        ...operatorIdentityRoutes(config, session),
        ...siteConsoleRoutes(config, session),
        ...releaseConsoleRoutes(session),
    };
}

if (import.meta.main) {
    const config = loadConfig();
    serve('console', config, consoleRouter(config));
}

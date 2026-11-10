// Proses konsol operator. Di-deploy di host internal; rute untuk agen dan portal tidak dimuat di sini.
import { customerConsoleRoutes } from './customers/index.console.ts';
import { runtimeHostConsoleRoutes } from './environments/index.console.ts';
import { type Config, loadConfig } from './platform/config/index.ts';
import { clientBuild, healthRoutes, serve } from './platform/http/index.ts';
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
        ...customerConsoleRoutes(session),
        ...runtimeHostConsoleRoutes(session),
    };
}

// Bentuk router konsol, untuk klien bertipe di layar (`src/platform/shell/api.ts`).
export type ConsoleRouter = ReturnType<typeof consoleRouter>;

// Layar konsol hanya disajikan proses ini; proses agen tidak membawa build peramban.
if (import.meta.main) {
    const config = loadConfig();
    serve(
        'console',
        config,
        consoleRouter(config),
        clientBuild(config.CLIENT_DIR),
    );
}

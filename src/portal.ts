// Proses portal klien. Di-deploy di host sendiri untuk pemilik dan admin klinik; rute konsol dan agen tidak dimuat di
// sini.
import {
    portalAccountRoutes,
    portalEnvironmentRoutes,
    portalSession,
    portalSsoRoutes,
} from './customers/index.portal.ts';
import {
    type Config,
    loadConfig,
    type PortalSettings,
} from './platform/config/index.ts';
import { clientBuild, healthRoutes, serve } from './platform/http/index.ts';

export function portalRouter(config: Config, portal: PortalSettings) {
    const session = portalSession(config);
    return {
        ...healthRoutes(),
        ...portalSsoRoutes(config, portal, session),
        ...portalAccountRoutes(session),
        ...portalEnvironmentRoutes(config, session),
    };
}

// Bentuk router portal, untuk klien bertipe di layar portal (`src/platform/shell/api.portal.ts`).
export type PortalRouter = ReturnType<typeof portalRouter>;

if (import.meta.main) {
    const config = loadConfig();
    if (!config.portal) {
        process.stderr.write(
            'Portal klien belum disetel: isi PORTAL_URL, PORTAL_SSO_ISSUER, PORTAL_SSO_CLIENT_ID, dan PORTAL_SSO_CLIENT_SECRET.\n',
        );
        process.exit(1);
    }
    serve(
        'portal',
        config,
        portalRouter(config, config.portal),
        clientBuild(config.PORTAL_CLIENT_DIR),
    );
}

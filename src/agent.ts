// Proses API agen dan pipeline rilis. Di-deploy di host publik; rute konsol dan portal tidak dimuat di sini.
import { environmentOperationAgentRoutes } from './environments/index.agent.ts';
import { type Config, loadConfig } from './platform/config/index.ts';
import { healthRoutes, serve } from './platform/http/index.ts';
import { releaseAgentRoutes } from './releases/index.agent.ts';
import { siteAgentRoutes } from './sites/index.agent.ts';

export function agentRouter(config: Config) {
    return {
        ...healthRoutes(),
        ...siteAgentRoutes(config),
        ...releaseAgentRoutes(config),
        ...environmentOperationAgentRoutes(),
    };
}

if (import.meta.main) {
    const config = loadConfig();
    serve('agent', config, agentRouter(config));
}

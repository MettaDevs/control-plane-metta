// Dibuat `bun scripts/generate-client.ts` dari setiap berkas `.page.tsx`; jangan disunting tangan. `bun run build`
// dan `bun run dev` menulis ulang berkas ini, dan CI menolak berkas yang tidak mutakhir.
import { createRoute, createRouter } from '@tanstack/react-router';
import { page as customersCustomerCustomerPage } from './customers/customer/customer.console.page.tsx';
import { page as customersCustomerCustomersPage } from './customers/customer/customers.console.page.tsx';
import { page as customersCustomerNewCustomerPage } from './customers/customer/new-customer.console.page.tsx';
import { page as customersPackageCatalogPage } from './customers/package/catalog.console.page.tsx';
import { page as environmentsRuntimeHostRuntimeHostsPage } from './environments/runtime-host/runtime-hosts.console.page.tsx';
import { page as platformShellLoginPage } from './platform/shell/login.console.page.tsx';
import { page as releasesReleasesPage } from './releases/releases.console.page.tsx';
import { page as sitesSiteSitePage } from './sites/site/site.console.page.tsx';
import { page as sitesSiteSitesPage } from './sites/site/sites.console.page.tsx';
import {
    appLayoutRoute,
    authLayoutRoute,
    indexRoute,
    rootRoute,
    routerOptions,
    startClient,
} from './platform/shell/index.ts';

const customersCustomerCustomerRoute = createRoute({
    getParentRoute: () => appLayoutRoute,
    path: customersCustomerCustomerPage.path,
    component: customersCustomerCustomerPage.component,
    staticData: { title: customersCustomerCustomerPage.title },
});

const customersCustomerCustomersRoute = createRoute({
    getParentRoute: () => appLayoutRoute,
    path: customersCustomerCustomersPage.path,
    component: customersCustomerCustomersPage.component,
    staticData: { title: customersCustomerCustomersPage.title },
});

const customersCustomerNewCustomerRoute = createRoute({
    getParentRoute: () => appLayoutRoute,
    path: customersCustomerNewCustomerPage.path,
    component: customersCustomerNewCustomerPage.component,
    staticData: { title: customersCustomerNewCustomerPage.title },
});

const customersPackageCatalogRoute = createRoute({
    getParentRoute: () => appLayoutRoute,
    path: customersPackageCatalogPage.path,
    component: customersPackageCatalogPage.component,
    staticData: { title: customersPackageCatalogPage.title },
});

const environmentsRuntimeHostRuntimeHostsRoute = createRoute({
    getParentRoute: () => appLayoutRoute,
    path: environmentsRuntimeHostRuntimeHostsPage.path,
    component: environmentsRuntimeHostRuntimeHostsPage.component,
    staticData: { title: environmentsRuntimeHostRuntimeHostsPage.title },
});

const platformShellLoginRoute = createRoute({
    getParentRoute: () => authLayoutRoute,
    path: platformShellLoginPage.path,
    component: platformShellLoginPage.component,
    validateSearch: platformShellLoginPage.validateSearch,
    staticData: { title: platformShellLoginPage.title },
});

const releasesReleasesRoute = createRoute({
    getParentRoute: () => appLayoutRoute,
    path: releasesReleasesPage.path,
    component: releasesReleasesPage.component,
    staticData: { title: releasesReleasesPage.title },
});

const sitesSiteSiteRoute = createRoute({
    getParentRoute: () => appLayoutRoute,
    path: sitesSiteSitePage.path,
    component: sitesSiteSitePage.component,
    staticData: { title: sitesSiteSitePage.title },
});

const sitesSiteSitesRoute = createRoute({
    getParentRoute: () => appLayoutRoute,
    path: sitesSiteSitesPage.path,
    component: sitesSiteSitesPage.component,
    staticData: { title: sitesSiteSitesPage.title },
});

const routeTree = rootRoute.addChildren([
    indexRoute,
    appLayoutRoute.addChildren([
        customersCustomerCustomerRoute,
        customersCustomerCustomersRoute,
        customersCustomerNewCustomerRoute,
        customersPackageCatalogRoute,
        environmentsRuntimeHostRuntimeHostsRoute,
        releasesReleasesRoute,
        sitesSiteSiteRoute,
        sitesSiteSitesRoute,
    ]),
    authLayoutRoute.addChildren([platformShellLoginRoute]),
]);

const router = createRouter({ ...routerOptions, routeTree });

declare module '@tanstack/react-router' {
    interface Register {
        router: typeof router;
    }
}

startClient(router);

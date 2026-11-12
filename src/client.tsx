// Dibuat `bun scripts/generate-client.ts` dari setiap berkas `.console.page.tsx`; jangan disunting tangan.
// `bun run build` dan `bun run dev` menulis ulang berkas ini, dan CI menolak berkas yang tidak mutakhir.
import { createRoute, createRouter } from '@tanstack/react-router';
import { page as customersCustomerCustomerPage } from './customers/customer/customer.console.page.tsx';
import { page as customersCustomerCustomersPage } from './customers/customer/customers.console.page.tsx';
import { page as customersEntitlementModulesPage } from './customers/entitlement/modules.console.page.tsx';
import { page as customersPackageModuleGroupsPage } from './customers/package/module-groups.console.page.tsx';
import { page as environmentsRuntimeHostRuntimeHostsPage } from './environments/runtime-host/runtime-hosts.console.page.tsx';
import { page as platformOperatorIdentityInvitationInvitationPage } from './platform/operator-identity/invitation/invitation.console.page.tsx';
import { page as platformOperatorIdentityInvitationOperatorsPage } from './platform/operator-identity/invitation/operators.console.page.tsx';
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

const customersEntitlementModulesRoute = createRoute({
    getParentRoute: () => appLayoutRoute,
    path: customersEntitlementModulesPage.path,
    component: customersEntitlementModulesPage.component,
    staticData: { title: customersEntitlementModulesPage.title },
});

const customersPackageModuleGroupsRoute = createRoute({
    getParentRoute: () => appLayoutRoute,
    path: customersPackageModuleGroupsPage.path,
    component: customersPackageModuleGroupsPage.component,
    staticData: { title: customersPackageModuleGroupsPage.title },
});

const environmentsRuntimeHostRuntimeHostsRoute = createRoute({
    getParentRoute: () => appLayoutRoute,
    path: environmentsRuntimeHostRuntimeHostsPage.path,
    component: environmentsRuntimeHostRuntimeHostsPage.component,
    staticData: { title: environmentsRuntimeHostRuntimeHostsPage.title },
});

const platformOperatorIdentityInvitationInvitationRoute = createRoute({
    getParentRoute: () => authLayoutRoute,
    path: platformOperatorIdentityInvitationInvitationPage.path,
    component: platformOperatorIdentityInvitationInvitationPage.component,
    validateSearch:
        platformOperatorIdentityInvitationInvitationPage.validateSearch,
    staticData: {
        title: platformOperatorIdentityInvitationInvitationPage.title,
    },
});

const platformOperatorIdentityInvitationOperatorsRoute = createRoute({
    getParentRoute: () => appLayoutRoute,
    path: platformOperatorIdentityInvitationOperatorsPage.path,
    component: platformOperatorIdentityInvitationOperatorsPage.component,
    staticData: {
        title: platformOperatorIdentityInvitationOperatorsPage.title,
    },
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
        customersEntitlementModulesRoute,
        customersPackageModuleGroupsRoute,
        environmentsRuntimeHostRuntimeHostsRoute,
        platformOperatorIdentityInvitationOperatorsRoute,
        releasesReleasesRoute,
        sitesSiteSiteRoute,
        sitesSiteSitesRoute,
    ]),
    authLayoutRoute.addChildren([
        platformOperatorIdentityInvitationInvitationRoute,
        platformShellLoginRoute,
    ]),
]);

const router = createRouter({ ...routerOptions, routeTree });

declare module '@tanstack/react-router' {
    interface Register {
        router: typeof router;
    }
}

startClient(router);

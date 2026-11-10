// Dibuat `bun scripts/generate-client.ts` dari setiap berkas `.page.tsx`; jangan disunting tangan. `bun run build`
// dan `bun run dev` menulis ulang berkas ini, dan CI menolak berkas yang tidak mutakhir.
import { createRoute, createRouter } from '@tanstack/react-router';
import { page as customersCustomerCustomersPage } from './customers/customer/customers.console.page.tsx';
import { page as customersCustomerNewCustomerPage } from './customers/customer/new-customer.console.page.tsx';
import { page as platformShellLoginPage } from './platform/shell/login.console.page.tsx';
import {
    appLayoutRoute,
    authLayoutRoute,
    indexRoute,
    rootRoute,
    routerOptions,
    startClient,
} from './platform/shell/index.ts';

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

const platformShellLoginRoute = createRoute({
    getParentRoute: () => authLayoutRoute,
    path: platformShellLoginPage.path,
    component: platformShellLoginPage.component,
    validateSearch: platformShellLoginPage.validateSearch,
    staticData: { title: platformShellLoginPage.title },
});

const routeTree = rootRoute.addChildren([
    indexRoute,
    appLayoutRoute.addChildren([
        customersCustomerCustomersRoute,
        customersCustomerNewCustomerRoute,
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

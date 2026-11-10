import * as React from 'react';

export const TableScrollContext = React.createContext<'inline' | 'viewport'>(
    'inline',
);

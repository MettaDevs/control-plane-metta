import * as React from 'react';

export type DocumentLinePortal =
    | HTMLElement
    | ShadowRoot
    | null
    | React.RefObject<HTMLElement | ShadowRoot | null>;

export type DocumentLineCell = {
    compact?: boolean;
    errorId?: string;
    label: string;
    rowNumber: number;
    portalContainer?: DocumentLinePortal;
};

export const DocumentLineCellContext =
    React.createContext<DocumentLineCell | null>(null);

export function useDocumentLineCell() {
    return React.useContext(DocumentLineCellContext);
}

export function documentLineLabel(
    cell: DocumentLineCell | null,
    label?: string,
) {
    return cell ? `${label ?? cell.label}, baris ${cell.rowNumber}` : label;
}

export function documentLinePortal(cell: DocumentLineCell | null) {
    const container = cell?.portalContainer;

    return container && 'current' in container ? container.current : container;
}

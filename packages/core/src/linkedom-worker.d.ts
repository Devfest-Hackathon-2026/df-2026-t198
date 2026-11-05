/** Limit worker types to the inert tree API; do not add browser DOM globals to core. */
declare module 'linkedom/worker' {
  export interface TreeElement {
    textContent: string | null;
    querySelectorAll(selector: string): ArrayLike<TreeElement> & Iterable<TreeElement>;
    querySelector(selector: string): TreeElement | null;
    closest(selector: string): TreeElement | null;
    getAttribute(name: string): string | null;
  }
  export function parseHTML(html: string): { document: TreeElement };
}

import { URL } from 'node:url';

// Keep the host URL implementation outside core's DOM/Node-free TypeScript.
export const parseUrl = (value, base) => new URL(value, base);

import { startKyotoContent } from './kulms-content.js';
import { collectKulasisObservation } from './kulasis-collection.js';
import { isKulasisOrigin } from '../../core/src/kulasis-reader.js';

if (typeof window !== 'undefined' && isKulasisOrigin(window.location.origin)) startKyotoContent(document, window, 'kulasis', window.location.origin, options =>
  collectKulasisObservation({ ...options, pageUrl: window.location.href, normalizeHtml: html => {
    const template = document.createElement('template');
    template.innerHTML = html;
    return template.innerHTML;
  }, resolveSite: async code => {
    const reply = await chrome.runtime.sendMessage({ type: 'kulasis-resolve-site', code }) as { siteId?: string };
    return reply?.siteId;
  } }));

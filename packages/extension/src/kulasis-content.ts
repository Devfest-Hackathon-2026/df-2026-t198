import { startKyotoContent } from './kulms-content.js';
import { collectKulasisObservation } from './kulasis-collection.js';
import { KULASIS_ORIGIN } from '../../core/src/kulasis-reader.js';

if (typeof window !== 'undefined') startKyotoContent(document, window, 'kulasis', KULASIS_ORIGIN, options =>
  collectKulasisObservation({ ...options, pageUrl: window.location.href, resolveSite: async code => {
    const reply = await chrome.runtime.sendMessage({ type: 'kulasis-resolve-site', code }) as { siteId?: string };
    return reply?.siteId;
  } }));

/* The extension API: Firefox's promise-based "browser" namespace, or "chrome" in Chrome, Edge, Brave… */
self.ext = (typeof browser !== 'undefined' && browser.runtime && browser.runtime.id ? browser : chrome);

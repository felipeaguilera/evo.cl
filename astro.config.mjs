import { defineConfig } from 'astro/config';
import funkoLookupHandler from './netlify/functions/funko-lookup.mts';

function netlifyFunctionsDev() {
  return {
    name: 'netlify-functions-dev',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const pathname = req.url?.split('?')[0];
        if (pathname === '/.netlify/functions/funko-lookup' || pathname === '/api/funko-lookup') {
          try {
            let body = '';
            if (req.method === 'POST') {
              body = await new Promise((resolve) => {
                if (typeof req.body === 'string') return resolve(req.body);
                if (req.body && typeof req.body === 'object') return resolve(JSON.stringify(req.body));
                if (req.complete) return resolve('');

                let data = '';
                req.on('data', (chunk) => { data += chunk; });
                req.on('end', () => resolve(data));
                req.on('error', () => resolve(''));

                // Safety timeout in case stream never fires end
                setTimeout(() => resolve(data), 2500);
              });
            }

            const url = `http://${req.headers.host || 'localhost:4321'}${req.url}`;
            const headers = new Headers();
            for (const [k, v] of Object.entries(req.headers)) {
              if (v) headers.set(k, Array.isArray(v) ? v.join(',') : v);
            }

            const webReq = new Request(url, {
              method: req.method,
              headers,
              body: body ? body : undefined,
            });

            const webRes = await funkoLookupHandler(webReq, {});
            res.statusCode = webRes.status;
            webRes.headers.forEach((val, key) => {
              res.setHeader(key, val);
            });
            const arrayBuffer = await webRes.arrayBuffer();
            res.end(Buffer.from(arrayBuffer));
            return;
          } catch (e) {
            console.error('Dev function middleware error:', e);
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: false, error: String(e) }));
            return;
          }
        }
        next();
      });
    },
  };
}

export default defineConfig({
  site: 'https://evo.cl',
  vite: {
    plugins: [netlifyFunctionsDev()],
  },
});

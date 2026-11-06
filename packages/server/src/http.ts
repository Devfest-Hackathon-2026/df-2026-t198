import { createServer } from 'node:http';

export function createHttpServer() {
  return createServer((request, response) => {
    const path = request.url?.split('?')[0];
    if (request.method === 'GET' && (path === '/healthz' || path === '/api/healthz')) {
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ status: 'ok' }));
      return;
    }
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not Found\n');
  });
}

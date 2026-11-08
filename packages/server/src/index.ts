import { createHttpServer } from './http.js';
import { closeFirebaseDependencies, firebaseDependencies } from './firebase.js';
import { serverPort, startServer } from './runtime/server.js';

const port = serverPort(process.env['PORT']);
const dependencies = firebaseDependencies();
startServer(createHttpServer(dependencies), () => closeFirebaseDependencies(dependencies), port);

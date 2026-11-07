// Cloud Run uploads only top-level server sources (.gcloudignore). Importing core's index
// compiles its HTML reader, which needs core's DOM-free linkedom declaration.
import '../../core/src/linkedom-worker.js';

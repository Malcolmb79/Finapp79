import "../server/src/loadEnv.js";
import app from "../server/src/app.js";

// Vercel's Node.js runtime accepts an Express app as the default export of
// a file under /api directly — it's callable as (req, res), same shape
// Vercel's own request handler expects, so no adapter is needed here.
export default app;

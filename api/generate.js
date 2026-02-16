const app = require('../server');

// Vercel serverless function entrypoint.
// Reuse the existing Express app and its /api/generate route.
//
// Frontend calls: fetch('/api/generate', ...) and Vercel maps this file to that path.
module.exports = (req, res) => {
  return app(req, res);
};


require('dotenv').config();
const formModule = require('formidable');
const formidable = formModule.default || formModule.formidable;
const fs = require('fs').promises;
const {
  getProductFromImage,
  uploadImageToSupabase,
  toShopifyRow,
  SHOPIFY_CSV_HEADER,
} = require('../server');

// Max 50 images, 10MB each
const MAX_FILES = 50;
const MAX_FILE_SIZE = 10 * 1024 * 1024;

/**
 * Vercel serverless handler.
 * Parses multipart with formidable (multer doesn't work on Vercel's request stream),
 * then runs the same generate logic as server.js.
 */
module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Method', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed. Use POST.' });
    return;
  }

  try {
    const form = formidable({
      maxFiles: MAX_FILES,
      maxFileSize: MAX_FILE_SIZE,
      filter: (part) => {
        if (part.mimetype) {
          const allowed = /^image\/(jpeg|jpg|png|gif|webp)$/i;
          return allowed.test(part.mimetype);
        }
        return false;
      },
    });

    const [fields, files] = await form.parse(req);
    // Same field name as frontend: formData.append('images', f)
    let fileList = files.images;
    if (!fileList) fileList = [];
    if (!Array.isArray(fileList)) fileList = [fileList];

    if (fileList.length === 0) {
      res.status(400).json({ error: 'No images uploaded. Please upload at least one image.' });
      return;
    }

    const products = [];
    const errors = [];

    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      if (!file?.filepath) continue;
      let buffer;
      try {
        buffer = await fs.readFile(file.filepath);
      } catch (readErr) {
        errors.push({ file: file.originalFilename || 'image', message: 'Could not read file.' });
        continue;
      }
      const mimetype = file.mimetype || 'image/jpeg';
      const originalname = file.originalFilename || `image-${i}.jpg`;

      try {
        const product = await getProductFromImage(buffer, mimetype, originalname);
        try {
          const imageUrl = await uploadImageToSupabase(buffer, mimetype, originalname, i);
          if (imageUrl) product.imageSrc = imageUrl;
        } catch (uploadErr) {
          errors.push({ file: originalname, message: `Image upload failed: ${uploadErr.message}` });
        }
        products.push(product);
      } catch (err) {
        errors.push({ file: originalname, message: err.message });
      }
    }

    if (products.length === 0) {
      res.status(400).json({
        error: 'No products could be generated.',
        details: errors,
      });
      return;
    }

    const csvRows = [SHOPIFY_CSV_HEADER, ...products.map((p, i) => toShopifyRow(p, i))];
    const csv = '\uFEFF' + csvRows.join('\r\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="shopify-products-${Date.now()}.csv"`);
    res.status(200).send(csv);
  } catch (err) {
    console.error('[/api/generate]', err);
    res.status(500).json({
      error: err.message || 'Internal server error',
      code: 'FUNCTION_INVOCATION_FAILED',
    });
  }
};

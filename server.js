require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3001;

// Supabase configuration (used to store images and generate public URLs for CSV)
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET || 'product-images';

const supabase =
  SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    : null;

// Ensure local uploads directory exists only when not on Vercel (read-only fs)
const uploadsDir = path.join(__dirname, 'uploads');
if (!process.env.VERCEL && !fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Multer config: store in memory for base64 (no disk write needed for API)
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowed = /^image\/(jpeg|jpg|png|gif|webp)$/i;
    if (allowed.test(file.mimetype)) cb(null, true);
    else cb(new Error('Only images (JPEG, PNG, GIF, WebP) are allowed.'));
  },
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Generate slug/handle from title
function slugify(text) {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w\-]+/g, '')
    .replace(/\-\-+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');
}

// Upload image buffer to Supabase Storage and return a public URL
async function uploadImageToSupabase(buffer, mimeType, originalname, index) {
  if (!supabase) {
    // Supabase not configured; leave imageSrc empty and let CSV still generate
    return '';
  }

  const extFromName = path.extname(originalname || '');
  let ext = extFromName;
  if (!ext) {
    switch ((mimeType || '').toLowerCase()) {
      case 'image/png':
        ext = '.png';
        break;
      case 'image/gif':
        ext = '.gif';
        break;
      case 'image/webp':
        ext = '.webp';
        break;
      default:
        ext = '.jpg';
        break;
    }
  }

  const base = path.basename(originalname || 'image', ext);
  const safeBase = slugify(base || 'image');
  const uniqueSuffix = `${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`;
  const filename = `${uniqueSuffix}-${safeBase}${ext}`;
  const storagePath = filename; // flat path in bucket

  // Optional: write to local uploads dir only when not on Vercel (serverless has read-only fs)
  if (!process.env.VERCEL) {
    try {
      const localPath = path.join(uploadsDir, filename);
      fs.writeFileSync(localPath, buffer);
    } catch {
      // Ignore local write errors, Supabase upload is what matters
    }
  }

  const { error } = await supabase.storage
    .from(SUPABASE_BUCKET)
    .upload(storagePath, buffer, {
      contentType: mimeType || 'image/jpeg',
      upsert: false,
    });

  if (error) {
    throw new Error(`Supabase upload failed: ${error.message}`);
  }

  const { data } = supabase.storage.from(SUPABASE_BUCKET).getPublicUrl(storagePath);
  return data?.publicUrl || '';
}

// Escape CSV field (wrap in quotes if contains comma, quote, or newline)
function escapeCsvField(value) {
  if (value == null) return '';
  const s = String(value).replace(/"/g, '""');
  if (/[,"\n\r]/.test(s)) return `"${s}"`;
  return s;
}

// Build one row of Shopify product CSV (minimal required columns)
function toShopifyRow(product, index) {
  const handle = product.handle || `product-${index + 1}`;
  return [
    escapeCsvField(handle),
    escapeCsvField(product.title),
    escapeCsvField(product.bodyHtml),
    escapeCsvField(product.vendor || ''),
    escapeCsvField(product.type || ''),
    escapeCsvField(product.tags || ''),
    escapeCsvField('true'), // Published
    escapeCsvField(''), // Option1 Name
    escapeCsvField('Default Title'), // Option1 Value
    escapeCsvField(''), // Option2 Name
    escapeCsvField(''),
    escapeCsvField(''), // Option3 Name
    escapeCsvField(''),
    escapeCsvField(product.sku || ''),
    escapeCsvField(''),
    escapeCsvField(''),
    escapeCsvField('0'),
    escapeCsvField('deny'),
    escapeCsvField('manual'),
    escapeCsvField(product.price || '0.00'),
    escapeCsvField(''),
    escapeCsvField('true'),
    escapeCsvField('true'),
    escapeCsvField(product.barcode || ''),
    escapeCsvField(product.imageSrc || ''),
    escapeCsvField(product.imageAlt || product.title || ''),
  ].join(',');
}

// Shopify product CSV header (standard columns)
const SHOPIFY_CSV_HEADER = [
  'Handle',
  'Title',
  'Body (HTML)',
  'Vendor',
  'Type',
  'Tags',
  'Published',
  'Option1 Name',
  'Option1 Value',
  'Option2 Name',
  'Option2 Value',
  'Option3 Name',
  'Option3 Value',
  'Variant SKU',
  'Variant Grams',
  'Variant Inventory Tracker',
  'Variant Inventory Qty',
  'Variant Inventory Policy',
  'Variant Fulfillment Service',
  'Variant Price',
  'Variant Compare-at Price',
  'Variant Requires Shipping',
  'Variant Taxable',
  'Variant Barcode',
  'Image Src',
  'Image Alt Text',
].join(',');

async function getProductFromImage(buffer, mimeType, filename) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY is not set in .env');
  }

  const base64 = buffer.toString('base64');
  const dataUrl = `data:${mimeType};base64,${base64}`;

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'HTTP-Referer': process.env.APP_URL || 'http://localhost:3001',
    },
    body: JSON.stringify({
      model: process.env.OPENROUTER_MODEL || 'qwen/qwen3-vl-30b-a3b-thinking',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `You are an e-commerce product copywriter. Look at this product image and respond with a JSON object only (no markdown, no code block). Use exactly these keys:
- "title": A short, SEO-friendly product title (max 70 characters).
- "body_html": An engaging HTML description. Structure it as: one short intro paragraph (<p>...</p>) followed by a bullet list of 3–6 key benefits or features using <ul><li>...</li></ul>. Focus on what the product is, who it's for, materials, sizing, and key use cases. No placeholder text, no boilerplate like "lorem ipsum".
- "vendor": Brand or vendor name if visible, otherwise empty string.
- "type": Product type/category (e.g. "Apparel", "Accessories"). One or two words.
- "tags": Comma-separated tags (e.g. "summer, cotton, blue").
- "price": Suggested price as string (e.g. "19.99") if visible, otherwise "0.00".

Output only valid JSON.`,
            },
            {
              type: 'image_url',
              image_url: { url: dataUrl },
            },
          ],
        },
      ],
      max_tokens: 600,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenRouter API error (${response.status}): ${errText}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error('No response from OpenRouter');

  // Parse JSON (handle optional markdown code block)
  let jsonStr = content;
  const codeMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeMatch) jsonStr = codeMatch[1].trim();

  let parsed;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (e) {
    throw new Error(`Invalid JSON from AI: ${content.slice(0, 200)}`);
  }

  const title = parsed.title || 'Untitled Product';
  const handle = slugify(title) || `product-${filename}`;

  return {
    handle,
    title,
    bodyHtml: parsed.body_html || parsed.bodyHtml || '',
    vendor: parsed.vendor || '',
    type: parsed.type || '',
    tags: parsed.tags || '',
    price: parsed.price || '0.00',
    sku: '',
    barcode: '',
    imageSrc: '', // User can add image URLs in Shopify after import
    imageAlt: title,
  };
}

// Single endpoint: upload images, get back CSV
app.post('/api/generate', upload.array('images', 50), async (req, res) => {
  if (!req.files?.length) {
    return res.status(400).json({ error: 'No images uploaded. Please upload at least one image.' });
  }

  const products = [];
  const errors = [];

  for (let i = 0; i < req.files.length; i++) {
    const file = req.files[i];
    try {
      const product = await getProductFromImage(file.buffer, file.mimetype, file.originalname);

      // Try to upload image to Supabase Storage so CSV has a real, public Image Src URL
      try {
        const imageUrl = await uploadImageToSupabase(file.buffer, file.mimetype, file.originalname, i);
        if (imageUrl) {
          product.imageSrc = imageUrl;
        }
      } catch (uploadErr) {
        // Record upload error but still return the product row (with empty imageSrc)
        errors.push({ file: file.originalname, message: `Image upload failed: ${uploadErr.message}` });
      }

      products.push(product);
    } catch (err) {
      errors.push({ file: file.originalname, message: err.message });
    }
  }

  if (products.length === 0) {
    return res.status(400).json({
      error: 'No products could be generated.',
      details: errors,
    });
  }

  const csvRows = [SHOPIFY_CSV_HEADER, ...products.map((p, i) => toShopifyRow(p, i))];
  const csv = '\uFEFF' + csvRows.join('\r\n'); // BOM for Excel/UTF-8

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="shopify-products-${Date.now()}.csv"`);
  res.send(csv);
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ ok: true, hasApiKey: !!process.env.OPENROUTER_API_KEY });
});

// In local/dev mode we run a normal Express server.
// On Vercel, the app is consumed by a serverless function (see api/generate.js),
// so we don't call app.listen there.
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`Shopify Product Generator running at http://localhost:${PORT}`);
    if (!process.env.OPENROUTER_API_KEY) {
      console.warn('Warning: OPENROUTER_API_KEY not set. Add it to .env to use the generator.');
    }
  });
}

module.exports = app;
module.exports.getProductFromImage = getProductFromImage;
module.exports.uploadImageToSupabase = uploadImageToSupabase;
module.exports.toShopifyRow = toShopifyRow;
module.exports.SHOPIFY_CSV_HEADER = SHOPIFY_CSV_HEADER;

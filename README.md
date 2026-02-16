# Shopify Product Generator

Upload product images and get a **Shopify-ready CSV** with AI-generated titles and descriptions using the OpenRouter API.

## Setup

1. **Install dependencies**
   ```bash
   cd shopify-product-generator
   npm install
   ```

2. **Add your OpenRouter API key**
   - Copy `.env.example` to `.env`
   - Get a key at [OpenRouter](https://openrouter.ai/keys)
   - Set `OPENROUTER_API_KEY=sk-or-v1-your-key` in `.env`

3. **Run the app**
   ```bash
   npm start
   ```
   Open [http://localhost:3001](http://localhost:3001).

## Usage

1. **Upload images** — Drag & drop or click to select product photos (JPEG, PNG, GIF, WebP). Up to 50 at a time.
2. **Generate CSV** — Click “Generate CSV”. The app sends each image to OpenRouter’s vision model and gets a title and HTML description.
3. **Download** — A CSV file downloads automatically.
4. **Import in Shopify** — In Shopify admin go to **Products → Import**, upload the CSV. Shopify will create the products with the generated titles and descriptions.

## Shopify import

- The CSV uses Shopify’s standard product columns (Handle, Title, Body (HTML), Vendor, Type, Tags, etc.).
- **Images:** The CSV does not include image URLs (Shopify needs public URLs). After importing, add product images in Shopify, or add a column “Image Src” with image URLs and re-export a template from Shopify to see the exact format.
- If the import fails, check [Shopify’s CSV import guide](https://help.shopify.com/en/manual/products/import-export/import-products).

## Optional env vars

| Variable | Description |
|----------|-------------|
| `OPENROUTER_API_KEY` | Required. Your OpenRouter API key. |
| `OPENROUTER_MODEL` | Vision model (default: `qwen/qwen3-vl-30b-a3b-thinking`). Use any [vision-capable model](https://openrouter.ai/models) on OpenRouter. |
| `PORT` | Server port (default: `3001`). |

# SETU Landing Page

Smart Automation for Plan–Field Integration.

This is the public-facing landing page for the SETU prototype, built for SIH 2026.

## Technologies Used

- React (Vite)
- TypeScript
- Tailwind CSS
- Lucide React

## Environment Variables

Create a `.env` file in `landing/` with the following variables:

```env
VITE_PROTOTYPE_URL=""
VITE_DEMO_VIDEO_URL=""
VITE_GITHUB_URL="https://github.com/dinamsingh/Setu"
```

## Local Development

To run the landing page locally:

1. Install dependencies:
   ```bash
   cd landing
   npm install
   ```

2. Start the development server:
   ```bash
   npm run dev
   ```

## Build

To build the landing page for production:

```bash
npm run build
```

This will generate static files in the `dist` directory.

## Cloudflare Pages Deployment

This project is optimized for deployment on Cloudflare Pages:

1. **Framework Preset**: None (or Vite)
2. **Root directory**: `landing`
3. **Build command**: `npm run build`
4. **Build output directory**: `dist`
5. **Environment variables**:
   - `VITE_GITHUB_URL`: `https://github.com/dinamsingh/Setu`
   - `VITE_PROTOTYPE_URL`: (optional URL to hosted prototype)
   - `VITE_DEMO_VIDEO_URL`: (optional URL to demo video)

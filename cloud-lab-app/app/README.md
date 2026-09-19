# Attack Range Frontend

A modern web interface for managing Attack Range deployments, built with Astro.

## Features

- **Templates Page**: Browse and build attack range templates from AWS, Azure, and GCP
- **Running Attack Ranges**: Monitor and manage active attack range deployments
- **Real-time Status**: Auto-refreshing status updates for running operations
- **VPN Configuration**: View and download WireGuard configurations for VPN connections

## Getting Started

### Prerequisites

- Node.js 18+ and npm
- Flask API running on `http://localhost:4000` (or configure `PUBLIC_API_URL`)

### Installation

```bash
npm install
```

### Development

Start the development server:

```bash
npm run dev
```

The frontend will be available at `http://localhost:4321` (default Astro port).

### Configuration

Create a `.env` file in the `app` directory to configure the API URL:

```env
PUBLIC_API_URL=http://localhost:4000
```

### Build

Build for production:

```bash
npm run build
```

Preview the production build:

```bash
npm run preview
```

## Color Scheme

The interface uses a dark theme with:
- **Black** (#000000) - Background
- **White** (#ffffff) - Text and UI elements
- **Orange** (RGB: 228, 117, 50 / #e47532) - Accent color for highlights and actions

## Project Structure

```
app/
├── src/
│   ├── layouts/
│   │   └── BaseLayout.astro    # Base layout with navigation
│   ├── pages/
│   │   ├── index.astro          # Templates page
│   │   └── attack-ranges.astro  # Running attack ranges page
│   └── utils/
│       └── api.ts               # API client utilities
├── public/                      # Static assets
└── package.json
```

## API Integration

The frontend communicates with the Flask API backend. Ensure the API is running and accessible at the configured URL.

### Endpoints Used

- `GET /templates` - List all available templates
- `GET /templates/{provider}/{name}` - Get template content
- `GET /attack-range/list` - List all running attack ranges
- `GET /attack-range/status/{id}` - Get attack range status
- `POST /attack-range/build` - Build a new attack range
- `POST /attack-range/destroy` - Destroy an attack range

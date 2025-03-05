# RSS Service

A lightweight, scalable RSS feed service built with Hono.js and Upstash Redis. This service allows you to create and manage RSS feeds programmatically through a simple REST API. It's designed to work seamlessly with the `@curatedotfun/rss` plugin in the curate.fun ecosystem.

## Features

- **Multiple Feed Formats**: Generate RSS 2.0, Atom, and JSON Feed formats
- **Standard-Compliant URLs**: Access feeds via standard paths (`/rss.xml`, `/atom.xml`, `/feed.json`)
- **Raw Data Option**: Get content without HTML via `/raw.json` for frontend customization
- **HTML Sanitization**: Secure content handling with sanitize-html
- **Simple Authentication**: API secret-based authentication for feed management
- **Configurable CORS**: Cross-origin request support
- **Flexible Deployment**: Deploy to various platforms ([Vercel](https://vercel.com), [Netlify](https://netlify.com), [Heroku](https://heroku.com), [Railway](https://railway.app), [Cloudflare](https://workers.cloudflare.com))
- **Redis Storage**: Efficient storage with Upstash Redis (production) or Redis mock (development)
- **Docker Support**: Easy local development with Docker and Docker Compose

## API Endpoints

| Endpoint | Method | Description | Authentication | Response Format |
|----------|--------|-------------|----------------|-----------------|
| `/` | GET | Health check and redirect to preferred format | No | Redirect |
| `/rss.xml` | GET | Get feed as RSS 2.0 XML | No | `application/rss+xml` |
| `/atom.xml` | GET | Get feed as Atom XML | No | `application/atom+xml` |
| `/feed.json` | GET | Get feed as JSON Feed (with HTML content) | No | `application/json` |
| `/raw.json` | GET | Get feed as JSON Feed (without HTML content) | No | `application/json` |
| `/api/items` | GET | Get all items as JSON | No | `application/json` |
| `/api/items?format=html` | GET | Get all items with HTML preserved | No | `application/json` |
| `/api/items` | POST | Add an item to the feed | Yes | `application/json` |

## Authentication

The RSS service uses a simple API secret for authentication. Protected endpoints (like POST operations) require the API secret in the Authorization header:

```txt
Authorization: Bearer <your-api-secret>
```

Public endpoints (health check and feed retrieval) do not require authentication, making it easy for RSS readers to access your feed.

The API secret is configured through the `API_SECRET` environment variable and should be kept secure.

## Environment Variables

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `UPSTASH_REDIS_REST_URL` | Upstash Redis REST URL | Yes (for production) | - |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis REST token | Yes (for production) | - |
| `API_SECRET` | Secret key for API authentication | Yes | - |
| `ALLOWED_ORIGINS` | Comma-separated list of allowed origins for CORS | No | `*` |
| `PORT` | Port to run the server on | No | `4001` |
| `USE_REDIS_MOCK` | Set to 'true' to use Redis mock for local development | No | `false` |
| `NODE_ENV` | Environment mode (development/production) | No | `development` |

## Feed Configuration

The RSS service can be configured using a `feed-config.json` file in the project root:

```json
{
  "feed": {
    "title": "My RSS Feed",
    "description": "A feed of curated content",
    "siteUrl": "https://example.com",
    "language": "en",
    "copyright": "© 2025",
    "favicon": "https://example.com/favicon.ico",
    "author": {
      "name": "Feed Author",
      "email": "author@example.com",
      "link": "https://author.example.com"
    },
    "preferredFormat": "rss",
    "maxItems": 100
  },
  "customization": {
    "categories": ["Technology", "News"],
    "image": "https://example.com/logo.png"
  }
}
```

This configuration file allows you to customize the feed metadata, including title, description, site URL, language, copyright information, and author details. The `maxItems` setting controls how many items are kept in the feed (oldest items are automatically removed when this limit is reached).

## Deployment Options

### Docker

The easiest way to run the RSS service locally is using Docker with the provided Dockerfile and docker-compose.yml:

1. Make sure you have Docker and Docker Compose installed on your system
   - For macOS users, we recommend using [OrbStack](https://orbstack.dev) instead of [Docker Desktop](https://www.docker.com/products/docker-desktop) for better performance and resource usage
2. Navigate to the service directory
3. Run the service with Docker Compose:

   ```cmd
   docker compose up
   ```

4. The RSS service will be available at <http://localhost:4001>

This setup includes:

- A Redis container for data storage
- The RSS service container configured to use the Redis container
- Persistent volume for Redis data

### Local Development (Without Docker)

For local development without Docker, you can use the Redis mock:

1. Navigate to the service directory
2. Install dependencies:

   ```cmd
   npm install
   ```

3. Create a `.env` file with the following content:

   ```cmd
   API_SECRET=your-secure-random-string
   USE_REDIS_MOCK=true
   PORT=4001
   ```

4. Start the development server:

   ```cmd
   npm run dev
   ```

5. The RSS service will be available at <http://localhost:4001>

### Production with Upstash Redis

For production deployments, this service uses Upstash Redis for storing and retrieving RSS feed items. Follow these steps to set up Upstash Redis:

1. Create an account at [Upstash](https://upstash.com) if you don't have one
2. Create a new Redis database:
   - Go to the Upstash Console
   - Click "Create Database"
   - Choose a name for your database
   - Select the region closest to your deployment
   - Choose the appropriate plan (Free tier works for most use cases)
   - Click "Create"
3. Get your REST API credentials:
   - In your database dashboard, click on the "REST API" tab
   - Copy the `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`
   - You'll need these values for your environment variables

## Cloud Deployment Options

### Vercel (Recommended with Upstash)

[Vercel](https://vercel.com) and [Upstash](https://upstash.com) have a seamless integration, making this the recommended deployment option:

1. Create a `vercel.json` file in the project root:

   ```json
   {
     "version": 2,
     "builds": [
       {
         "src": "dist/index.js",
         "use": "@vercel/node"
       }
     ],
     "routes": [
       {
         "src": "/(.*)",
         "dest": "dist/index.js"
       }
     ]
   }
   ```

   This configuration tells Vercel to:
   - Use Node.js to run your application
   - Point to the compiled index.js file
   - Route all requests to your application

2. Create a new project in Vercel
3. Link your repository
4. Configure the build settings:
   - Build Command: `npm run build`
   - Output Directory: `dist`
   - Install Command: `npm install`
5. Add the required environment variables:
   - `UPSTASH_REDIS_REST_URL`: Your Upstash Redis REST URL
   - `UPSTASH_REDIS_REST_TOKEN`: Your Upstash Redis REST token
   - `API_SECRET`: A secure random string for API authentication
6. Optional: Use the Vercel Upstash Integration
   - In your Vercel project, go to "Integrations"
   - Find and add the Upstash integration
   - This will automatically set up the Redis connection
7. Deploy your project

### Heroku

1. Create a `Procfile` in the project root:

   ```cmd
   web: npm start
   ```

2. Add Node.js engine specification to your `package.json`:

   ```json
   "engines": {
     "node": ">=18.0.0"
   }
   ```

3. Create a new [Heroku](https://heroku.com) app:

   ```cmd
   heroku create your-rss-service
   ```

4. Set the required environment variables:

   ```cmd
   heroku config:set UPSTASH_REDIS_REST_URL=your-upstash-redis-rest-url
   heroku config:set UPSTASH_REDIS_REST_TOKEN=your-upstash-redis-rest-token
   heroku config:set API_SECRET=your-api-secret
   ```

5. Deploy to Heroku:

   ```cmd
   git push heroku main
   ```

### Netlify

1. Create a new site in [Netlify](https://netlify.com)
2. Link your repository
3. Configure the build settings:
   - Build Command: `npm run build`
   - Publish Directory: `dist`
4. Add the required environment variables in the Netlify dashboard:
   - `UPSTASH_REDIS_REST_URL`: Your Upstash Redis REST URL
   - `UPSTASH_REDIS_REST_TOKEN`: Your Upstash Redis REST token
   - `API_SECRET`: A secure random string for API authentication
5. Deploy your project

### Railway (Docker Deployment)

[Railway](https://railway.app) provides an easy way to deploy Docker containers with minimal configuration:

1. Create an account on [Railway](https://railway.app/) if you don't have one
2. Install the Railway CLI:

   ```cmd
   npm i -g @railway/cli
   ```

3. Login to Railway:

   ```cmd
   railway login
   ```

4. Initialize a new project:

   ```cmd
   railway init
   ```

5. Deploy the service using the existing Docker configuration:

   ```cmd
   railway up
   ```

6. Set up the required environment variables in the Railway dashboard:
   - `UPSTASH_REDIS_REST_URL`: Your Upstash Redis REST URL
   - `UPSTASH_REDIS_REST_TOKEN`: Your Upstash Redis REST token
   - `API_SECRET`: A secure random string for API authentication

7. Optionally, you can connect your GitHub repository for automatic deployments

Railway will automatically detect and use your docker-compose.yml file, making it easy to deploy both the RSS service and Redis in a single environment.

### Cloudflare Workers

[Cloudflare Workers](https://workers.cloudflare.com) can be used with Upstash Redis's REST API:

1. Install Cloudflare Workers CLI:

   ```cmd
   npm install -g wrangler
   ```

2. Create a `wrangler.toml` file in the project root:

   ```toml
   name = "rss-service"
   type = "javascript"
   account_id = "your-account-id"
   workers_dev = true
   compatibility_date = "2023-01-01"

   [build]
   command = "npm run build"
   [build.upload]
   format = "service-worker"

   [vars]
   ALLOWED_ORIGINS = "*"
   ```

3. Add your secrets:

   ```cmd
   wrangler secret put UPSTASH_REDIS_REST_URL
   wrangler secret put UPSTASH_REDIS_REST_TOKEN
   wrangler secret put API_SECRET
   ```

4. Deploy to Cloudflare Workers:

   ```cmd
   wrangler publish
   ```

### Self-hosted

You can also deploy the RSS service on your own server:

1. Clone the repository
2. Install dependencies:

   ```cmd
   npm install
   ```

3. Create a `.env` file with the required environment variables:

   ```cmd
   UPSTASH_REDIS_REST_URL=your-upstash-redis-rest-url
   UPSTASH_REDIS_REST_TOKEN=your-upstash-redis-rest-token
   API_SECRET=your-api-secret
   PORT=4001 # Optional, defaults to 4001
   ALLOWED_ORIGINS=https://example.com,https://app.example.com # Optional
   ```

4. Build the project:

   ```cmd
   npm run build
   ```

5. Start the server:

   ```cmd
   npm start
   ```

## Integration with RSS Plugin

The RSS service is designed to work seamlessly with the `@curatedotfun/rss` plugin in the curate.fun ecosystem. To connect the plugin to the service:

1. Initialize the plugin with the service URL and API secret:

```typescript
import RssPlugin from '@curatedotfun/rss';

const rssPlugin = new RssPlugin();
await rssPlugin.initialize({
  serviceUrl: 'https://your-rss-service-url.com',
  apiSecret: 'your-api-secret'
});
```

2. Distribute content through the plugin:

```typescript
await rssPlugin.distribute({
  input: {
    title: "My RSS Item",
    content: "<p>Content with HTML formatting</p>",
    link: "https://example.com/article",
    publishedAt: new Date().toISOString(),
    author: {
      name: "John Doe",
      email: "john@example.com"
    },
    categories: ["Technology", "News"]
  }
});
```

The plugin handles validation, formatting, and authentication with the RSS service, making it easy to publish content to your RSS feed.

See the [RSS Plugin README](../README.md) for more details on the plugin's capabilities and configuration options.

## Development

### Local Development

1. Clone the repository
2. Navigate to the service directory
3. Install dependencies:

   ```bash
   npm install
   ```

4. Create a `.env` file with the required environment variables:

   ```txt
   API_SECRET=your-secure-random-string
   USE_REDIS_MOCK=true
   PORT=4001
   ```

5. Start the development server:

   ```bash
   npm run dev
   ```

6. The RSS service will be available at <http://localhost:4001>

### Testing Your Feed

Once the service is running, you can test your feed by:

1. Accessing the feed in your browser:
   - <http://localhost:4001/rss.xml> (RSS 2.0 format)
   - <http://localhost:4001/atom.xml> (Atom format)
   - <http://localhost:4001/feed.json> (JSON Feed format)
   - <http://localhost:4001/raw.json> (Raw JSON format)

2. Adding items to the feed using the API:

   ```bash
   curl -X POST http://localhost:4001/api/items \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer your-api-secret" \
     -d '{"title":"Test Item","content":"<p>Test content</p>","link":"https://example.com/test"}'
   ```

3. Retrieving items from the feed:

   ```bash
   curl http://localhost:4001/api/items
   ```

## License

MIT

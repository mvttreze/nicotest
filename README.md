# Nico AI

## Supabase and Render setup

1. Create a Supabase project and enable Email authentication.
2. Create the developer account in Supabase Auth using the email that will be
   assigned to `ADMIN_EMAIL`.
3. In the developer user's metadata, add `role: developer`. The backend also
   enforces the configured admin email.
4. Run `auth-migration.sql` in the Supabase SQL editor.
5. Run `patches-migration.sql` in the Supabase SQL editor to enable persistent
   developer source snapshots. Do not create a client-side policy for this table.
6. Configure these Render environment variables:

```text
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your-publishable-or-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
GROQ_API_KEY=your-groq-key
GEMINI_API_KEY=your-gemini-key
ADMIN_LOGIN=admin
ADMIN_EMAIL=your-real-supabase-email@example.com
ADMIN_PASSWORD=replace-with-a-unique-secret
ALLOW_DEMO_AUTH=false
ALLOWED_ORIGINS=https://your-frontend.onrender.com,https://your-custom-domain.example
```

`admin` remains the username entered in Nico. The backend maps it to
`ADMIN_EMAIL` and authenticates through Supabase, returning a persistent
Supabase session. The local fallback is intended only for development and
tests. Keep `ALLOW_DEMO_AUTH=false` in production and configure all admin and
provider secrets in Render.

In the static frontend, set the `nico-api-url`, Supabase URL, and publishable
key values in `index.html` to the deployed backend/project values. Configure
the Supabase Auth site URL and redirect URL to the deployed frontend URL.

After deployment, verify `/health`, sign in as `admin`, and confirm the
developer dashboard appears. Never expose the service-role key in frontend
HTML or client-side JavaScript.

## React UI island

Nico remains a static HTML/CSS/JavaScript app. React and Glisse are being
introduced incrementally in `nico-react/`; the welcome prompt buttons are the
first React island, with static buttons retained as a fallback.

For local development, install and build the island once:

```text
npm --prefix nico-react ci
npm --prefix nico-react run build
```

On Windows, `.\developer_nico_test.ps1` builds the React island, starts the
local FastAPI backend and static frontend, checks both services, and opens the
app in a browser. It enables demo auth only for the launched backend process
and does not edit `.env`.

Render builds the bundle as part of the static-site build. For Capacitor,
`npm run sync:web` in `nico-mobile/` builds the island and copies it with the
rest of the web app.

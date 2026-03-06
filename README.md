# frontend-auto-cms

Turn any frontend into an editable mini-CMS with one import and a dashboard route.

- Repository: [https://github.com/Gabo-Tech/frontend-auto-cms](https://github.com/Gabo-Tech/frontend-auto-cms)

## Quick Start

```bash
npm i frontend-auto-cms@latest
npx frontend-auto-cms setup
```

Then add this in your app entry file:

```ts
import "frontend-auto-cms";
```

Open your dashboard route (default: `/dashboard`) and start editing.

## Install

```bash
npm i frontend-auto-cms@latest
```

## Setup

Run setup in your app project:

```bash
npx frontend-auto-cms setup
```

Setup will:
- ask for CMS passcode
- configure dashboard route
- detect editable pages/files
- generate runtime config files
- configure hosting and publish provider (GitHub/GitLab)
- generate `public/cms-route-map.json` for route-to-source mapping

## Real setup example

```bash
anonymous@anonymous:~/Documents/Programming/testlanding$ npm i frontend-auto-cms@latest

changed 1 package, and audited 198 packages in 970ms

38 packages are looking for funding
  run `npm fund` for details

found 0 vulnerabilities
anonymous@anonymous:~/Documents/Programming/testlanding$ npx frontend-auto-cms setup
✔ Choose your CMS passcode: **********
✔ Dashboard route path (for editors): /dashboard
✔ Enable automatic translation via third-party API? Yes
✔ Where is your app deployed (for dashboard routing)? Vercel (auto-add 
dashboard rewrites)
✔ Where is your code hosted for Save & Publish? GitHub
✔ Repository slug (owner/repo or group/project): Gabo-Tech/testlanding
✔ Branch to publish to: main

frontend-auto-cms initialized successfully.
- Config: .cms-config.json
- Content: cms-content.json
- Assets directory: public/cms-assets
- Runtime auth: public/cms-runtime-auth.json
- Hosting config: .cms-hosting.json
- Runtime hosting: public/cms-hosting.json
- Runtime settings: public/cms-settings.json
- Runtime locales: public/cms-locales.json
- Hosting routing: vercel.json rewrites: unchanged
- Automation: GitHub auto-apply workflow: unchanged
- Detected pages: /, /about, /careers, /contact, /faq, /home, /notfound, /services

Next steps:
1) Add `import "frontend-auto-cms";` to your frontend entry file.
2) Open /dashboard to edit your site.
3) After edits, click Save + Publish (or export patch and run apply).
```

## Use In Your App

Add this to your frontend entry file:

```ts
import "frontend-auto-cms";
```

Then open your dashboard route (default: `/dashboard`).

## Save + Publish behavior

- Applies edits in the dashboard preview immediately.
- Builds source patch operations from editable nodes.
- Resolves route mappings using `public/cms-route-map.json`.
- Publishes content/locales/patch files.
- Updates real repository source files via GitHub/GitLab APIs when configured.

## Commands

- `npx frontend-auto-cms setup` - regenerate config, pages, and route map.
- `npx frontend-auto-cms apply` - apply `cms-export.patch.json` locally.
- `npx frontend-auto-cms doctor` - quick installation check.

## Security note

The runtime passcode gate is lightweight and intended for editor access control in frontend environments. Enter provider token manually during publish; it is not persisted in config files. Prefer short-lived, repo-scoped tokens.

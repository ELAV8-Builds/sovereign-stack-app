---
name: web-app-build
category: web-app-build
version: "1.0"
target_type: web_app
required_capabilities:
  - typescript
  - react
  - web_app_build
default_config:
  frontend: nextjs
  styling: tailwind
  orm: prisma
  language: typescript
  min_iterations: 2
  max_iterations: 5
cleanup_profile: Web App Cleanup
---

# Web App Build Skill

Build a production-ready web application from a user prompt.

## Level 1 — Quick Brief

You are building a web application. Follow these rules:
1. Use Next.js with TypeScript and Tailwind CSS
2. Keep every file under 300 lines
3. Use real API calls through server routes — never call external APIs from client components
4. Every async action needs loading states, error toasts, and disabled buttons
5. No mock data — use empty states with helpful messages
6. Run `tsc --noEmit && npm run build` after every change

## Level 2 — Detailed Instructions

### Project Setup
1. Initialize with `npx create-next-app@latest` using TypeScript, Tailwind, App Router
2. Set up project structure:
   ```
   src/
   ├── app/           # Next.js App Router pages
   ├── components/    # Reusable UI components
   ├── lib/           # Utilities, API clients, helpers
   ├── types/         # Shared TypeScript interfaces
   └── styles/        # Global styles
   ```
3. Install dependencies as needed (never pre-install everything)
4. Create `.env.example` with all required environment variables

### Implementation Rules
- **Components:** Max 300 lines. If larger, split into sub-components
- **Types:** Centralize shared interfaces in `src/types/`
- **API Calls:** All external API calls go through Next.js API routes (`app/api/`)
- **Error Handling:** Every `try/catch` must show user feedback (toast, banner, inline error)
- **Loading States:** Every async operation gets a spinner/skeleton
- **Forms:** Use controlled components with validation
- **Navigation:** Use Next.js `<Link>` and `useRouter`

### Database (if needed)
- Prisma ORM with PostgreSQL
- Create `prisma/schema.prisma` with all models
- Run `npx prisma generate` after schema changes
- Use Prisma Client in server-side code only

### Styling
- Tailwind CSS utility classes (no custom CSS files unless absolutely needed)
- Dark mode support via `dark:` prefix
- Responsive design: mobile-first with `sm:`, `md:`, `lg:` breakpoints

## Level 3 — Exhaustive Reference

### Build Pipeline
1. `tsc --noEmit` — Zero type errors
2. `npm run build` — Production build must pass
3. `npm run lint` — ESLint must pass (if configured)
4. Visual inspection of all routes in browser

### Quality Gates (Cleanup Profile)
- No files over 500 lines
- No `as any` casts
- No empty catch blocks
- No hardcoded URLs (use environment variables)
- No `console.log` in production code
- No unused exports
- Build must pass with zero warnings

### Common Patterns
- **Auth:** NextAuth.js or Clerk
- **State Management:** React Context for simple state, Zustand for complex
- **Data Fetching:** Server Components for static, `useEffect` + fetch for dynamic
- **Deployment:** Vercel (auto-deploy from git)

### Environment Variables
- `NEXT_PUBLIC_*` — Client-side (embedded in JS bundles, never secrets)
- All other env vars — Server-side only
- Always validate env vars exist before using them

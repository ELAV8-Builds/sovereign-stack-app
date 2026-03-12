---
name: website-build
category: website-build
version: "1.0"
target_type: website
required_capabilities:
  - html
  - css
  - website_build
default_config:
  framework: nextjs
  styling: tailwind
  target: website
  min_iterations: 1
  max_iterations: 3
cleanup_profile: Website Cleanup
---

# Website Build Skill

Build a marketing website or landing page with modern design and SEO optimization.

## Level 1 — Quick Brief

You are building a marketing website/landing page. Follow these rules:
1. Use Next.js with TypeScript and Tailwind CSS (or static HTML if simpler)
2. Mobile-first responsive design
3. SEO tags on every page (title, meta description, og tags)
4. Fast load times (optimize images, lazy load below-the-fold content)
5. Accessibility basics (alt text, semantic HTML, keyboard nav)
6. Run build and verify zero errors

## Level 2 — Detailed Instructions

### Project Structure
```
src/
├── app/
│   ├── page.tsx           # Homepage / landing page
│   ├── layout.tsx         # Root layout with SEO defaults
│   ├── about/page.tsx     # About page
│   ├── pricing/page.tsx   # Pricing page (if needed)
│   └── contact/page.tsx   # Contact page
├── components/
│   ├── Hero.tsx
│   ├── Features.tsx
│   ├── Testimonials.tsx
│   ├── CTA.tsx
│   ├── Footer.tsx
│   └── Header.tsx
└── lib/
    └── metadata.ts        # SEO helpers
```

### SEO Requirements
Every page must have:
- `<title>` tag (unique per page, under 60 chars)
- `<meta name="description">` (unique, under 160 chars)
- Open Graph tags: `og:title`, `og:description`, `og:image`
- Twitter card meta tags
- Canonical URL
- Proper heading hierarchy (single H1, logical H2-H6)

### Performance
- Images: Use Next.js `<Image>` component with proper sizing
- Fonts: Use `next/font` for self-hosted Google Fonts
- Above-the-fold: No layout shift (set explicit dimensions)
- Below-the-fold: Lazy load with `loading="lazy"`

### Accessibility
- All images have descriptive `alt` text
- Interactive elements are keyboard-accessible
- Color contrast meets WCAG 2.1 AA (4.5:1 for text)
- Skip navigation link
- Semantic HTML (`<nav>`, `<main>`, `<article>`, `<footer>`)

## Level 3 — Exhaustive Reference

### Quality Gates
- Lighthouse score: Performance > 90, Accessibility > 90, SEO > 90
- No broken links
- No unused CSS
- No orphan assets (images/fonts referenced but not used)
- All forms have proper validation and error states
- SSL/HTTPS configured in deployment

# Server A Website Template

Server: A (Stremio addon)
Website URL: https://add-jipi.vercel.app/

## Ordered sections

1. Landing Page
   - Blueprint reference: `.planning/templates/sections/SECTION-LANDING-PAGE.md`
   - Status: ✅ Functional

2. Health Notification
   - Blueprint reference: `.planning/templates/sections/SECTION-HEALTH-NOTIFICATION.md`
   - Status: 🚧 Non-functional (stub)
   - Activation note: Enable STUB-D-01 in A stream error path so users see a system health notice when dependencies are down.

## Change checklist (template-first rule)

When adding, removing, or changing a website section for this server:

1. update the section blueprint in `.planning/templates/sections/` (or create a new blueprint first).
2. update this file so the ordered section list, blueprint reference, and status markers match the intended website contract.
3. rebuild the server website page so runtime output matches this template exactly.

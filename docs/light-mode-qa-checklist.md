# Light And Dark Mode QA Checklist

Use this checklist before shipping UI changes that touch color, layout, or shared components.

## Setup
- Clear `localStorage.zeroone-theme` and confirm the app follows the system theme.
- Toggle theme from the app header and refresh the page.
- Confirm the chosen theme persists after refresh and navigation.
- Confirm there is no flash of the wrong theme on first load.

## Global Component Checks
- Text has readable contrast in headings, body text, helper text, placeholders, disabled text, and links.
- Buttons show clear default, hover, focus, disabled, and selected states.
- Inputs, selects, textareas, checkboxes, and range controls have visible borders and focus rings.
- Cards, modals, dropdowns, popovers, tables, sidebars, and mobile nav use themed surfaces.
- Badges for success, warning, error, info, priority, status, risk, blocked, and overdue are readable.
- Tables and list rows have visible hover and selected states.
- Kanban columns, calendar cells, and task cards are distinct from the page background.
- Charts/progress bars remain visible against both backgrounds.
- Toasts and notifications are readable and not clipped.

## Page Checklist
- Login, signup, forgot password, reset password, and set password.
- Organization onboarding, organization switcher, settings, invites, roles, and member removal.
- Projects dashboard, project cards, filters, health badges, empty/loading/error states.
- Create Project flow, templates, advanced options, AI generation, and AI plan preview.
- Project overview, task list, Kanban board, filters, drag feedback, and task status changes.
- Task detail panel, comments, attachments, activity history, dependencies, GitHub, calendar sync, and task AI chat.
- Board/calendar day, week, month, and year views.
- Team & Capacity cards, modals, skill gaps, unassigned tasks, CV upload, workload bars.
- Profile header, AI technical profile, skills, completed tasks, level, achievements, links, privacy, streak.
- Reports, exports, migration, weekly report, client share view, and roadmap.
- Notifications panel, preferences, read/unread state, profile menu, and header controls.
- Microsoft Teams meeting modal and integration settings.
- Error pages, blocked states, permission-denied states, and empty states.

## Manual Test Path
1. Open the app with no saved theme and verify the system preference is used.
2. Toggle to light mode, refresh, then visit every page above.
3. Toggle to dark mode from the same page and confirm layout and controls remain stable.
4. Test selected states: nav item, project filters, calendar mode, list/Kanban toggle, tabs, saved filters, checkboxes.
5. Open every modal/dropdown: profile, notifications, create/edit forms, export menus, task details, invites.
6. Check mobile width for sidebar drawer, bottom nav, task panel, forms, cards, and modals.
7. Run `npm run build` from `frontend`.

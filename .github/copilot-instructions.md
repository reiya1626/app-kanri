# AI Coding Guidelines for Object-Class Converter

## Project Overview
This is a Next.js 15 web application for learning object-oriented design through interactive PlantUML diagrams. It converts problem texts into class diagrams and object diagrams, with wizards for editing classes, attributes, and relationships.

## Architecture
- **Frontend**: Next.js App Router with React 19, TypeScript, Tailwind CSS, Radix UI components
- **Diagrams**: PlantUML for SVG generation (encoded URLs via `plantuml-encoder`)
- **Data Flow**: Client-side state management with API routes for scenario persistence (in-memory store for dev)
- **Key Components**:
  - `components/InteractiveClassDiagram.tsx`: Clickable SVG diagrams with event handlers
  - `lib/puml.ts`: PlantUML parsing to objects/attributes
  - `lib/level1-parse.ts`: Natural language parsing for objects/slots/relations
  - `app/api/scenarioStore.ts`: In-memory scenario management

## Development Workflow
- **Start dev server**: `npm run dev` (uses Turbopack)
- **Build**: `npm run build`
- **Lint**: `npm run lint`
- **Debug**: Use VS Code debugger with Next.js launch config; breakpoints in API routes work with `runtime: "nodejs"`

## Code Patterns
- **Component Structure**: Client components with `"use client"`; use hooks for state (e.g., `useState` for diagram data)
- **Type Safety**: Strict TypeScript; import types from `types.ts` (e.g., `Scenario`, `Obj`, `ClassAttr`)
- **PlantUML Integration**: Use `utils/plantuml.ts` for URL generation; parse with `lib/puml.ts`
- **Event Logging**: Use `lib/logger.ts` for NDJSON logs; events like `"puml.import"`, `"object.add"`
- **UI Components**: Radix UI primitives in `components/ui/`; drag-and-drop via `@dnd-kit`
- **API Routes**: Export `runtime = "nodejs"` and `dynamic = "force-dynamic"` for server-side logic

## Key Conventions
- **File Naming**: Kebab-case for routes (e.g., `scenarios`), PascalCase for components
- **Imports**: Absolute paths with `@/` alias (e.g., `@/types`, `@/components`)
- **State Updates**: Immutable updates for arrays/objects; use `Object.assign` for patches in stores
- **Error Handling**: Minimal; rely on TypeScript for type safety; async operations use try/catch sparingly
- **Testing**: No formal tests; validate manually via experiment pages (`app/experiment/`)

## Common Tasks
- **Add new wizard**: Create component in `components/` with Radix dialogs; integrate via `useState` in parent
- **Parse new format**: Extend `lib/level1-parse.ts` regex for new annotation types
- **Add API endpoint**: Create `route.ts` in `app/api/`; use `NextResponse.json()` for responses
- **Update diagrams**: Modify PlantUML strings, re-encode URLs, update SVG fetches in components

## Dependencies
- **Core**: Next.js, React, TypeScript
- **UI**: Tailwind, Radix UI, Lucide icons, DND Kit
- **Diagrams**: PlantUML encoder, Pako (compression)
- **Data**: PostgreSQL (configured but in-memory for dev), UUID generation</content>
<parameter name="filePath">c:\Users\reiya\Documents\app\.github\copilot-instructions.md
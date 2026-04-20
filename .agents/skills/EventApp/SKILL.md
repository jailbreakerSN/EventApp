```markdown
# EventApp Development Patterns

> Auto-generated skill from repository analysis

## Overview
This skill teaches the development conventions and workflows used in the EventApp repository, a TypeScript project built with the Next.js framework. You'll learn about file naming, import/export styles, commit message patterns, and how to write and organize tests within this codebase.

## Coding Conventions

### File Naming
- Use **camelCase** for all file names.
  - Example:  
    ```
    eventList.ts
    userProfile.tsx
    ```

### Import Style
- Use **relative imports** for modules within the project.
  - Example:
    ```typescript
    import { getUser } from './userService';
    import { EventList } from '../components/eventList';
    ```

### Export Style
- Use **named exports** for all modules.
  - Example:
    ```typescript
    // userService.ts
    export function getUser(id: string) { ... }
    export const USER_ROLE = 'admin';
    ```

### Commit Messages
- Follow the **Conventional Commits** specification.
- Use the `fix` prefix for bug fixes.
- Keep commit messages concise (average 56 characters).
  - Example:
    ```
    fix: correct event date formatting on details page
    ```

## Workflows

### Commit Changes
**Trigger:** When making any code change  
**Command:** `/commit-changes`

1. Stage your changes with `git add`.
2. Write a commit message using the conventional commit format (e.g., `fix: ...`).
3. Keep the message concise and descriptive.
4. Commit your changes.

### Add a New Module
**Trigger:** When adding a new feature or utility  
**Command:** `/add-module`

1. Create a new file using camelCase naming.
2. Use named exports for all functions, constants, or components.
3. Use relative imports to include dependencies.
4. Add corresponding tests in a `.test.ts` or `.test.tsx` file.

### Write Tests
**Trigger:** When adding or updating functionality  
**Command:** `/write-tests`

1. Create a test file with the pattern `*.test.ts` or `*.test.tsx` in the same directory or a `__tests__` folder.
2. Write tests for all exported functions/components.
3. Use the project's preferred testing framework (framework not specified; check with team).

## Testing Patterns

- **Test File Naming:** Use the pattern `*.test.ts` or `*.test.tsx`.
  - Example:  
    ```
    eventList.test.ts
    userService.test.ts
    ```
- **Test Placement:** Place test files alongside the modules they test or in a dedicated `__tests__` directory.
- **Framework:** The specific testing framework is not specified; consult the team or project documentation.

## Commands
| Command          | Purpose                                      |
|------------------|----------------------------------------------|
| /commit-changes  | Guide for making and committing code changes |
| /add-module      | Steps for adding a new module                |
| /write-tests     | Instructions for writing and organizing tests|
```

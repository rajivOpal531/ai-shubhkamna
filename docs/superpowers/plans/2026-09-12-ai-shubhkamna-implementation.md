# AI Shubhkamna Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the AI Shubhkamna card-creation webview (landing → capture/upload → compositing → preview/wishes → post) per `docs/superpowers/specs/2026-09-12-ai-shubhkamna-design.md`.

**Architecture:** Vite + React + TypeScript SPA, no router (an internal `Step` enum drives which screen renders). JWT is read once from `?jwt=` on mount and held in a React context. Two backend pieces (profile lookup, photo compositing) don't exist yet — both sit behind a swappable service interface with a mock implementation, so the full flow is demoable today. The Create Post APIs are fully specified in the integration doc and get wired for real against UAT.

**Tech Stack:** React 18, TypeScript 5, Vite 5, Vitest + @testing-library/react for tests, no CSS framework (hand-rolled mobile-first CSS).

---

## Reference: field/type names used throughout this plan

Defined once in Task 2, then used verbatim everywhere else — if a later task's code doesn't match these exactly, that's a bug, fix it:

```ts
type Profile = { username: string; email: string; mobileno: string; state: string; constituency: string; district: string };
type Template = { id: string; image: string };
type CompositeResult = { imageUrl?: string; imageBlob?: Blob };
type CreatePostResult = { ok: boolean; status: number };
type Step = 'landing' | 'tips' | 'capture' | 'processing' | 'preview';
```

Template IDs (11 total, gap at 7/12/13/14 is correct — matches the approved Dropbox set):
`card-1, card-2, card-3, card-4, card-5, card-6, card-8, card-9, card-10, card-11, card-15`

---

### Task 1: Project scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `tsconfig.node.json`
- Create: `vite.config.ts`
- Create: `index.html`
- Create: `.gitignore`
- Create: `src/main.tsx`
- Create: `src/App.tsx`
- Create: `src/test/setup.ts`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "ai-shubhkamna",
  "private": true,
  "version": "0.0.1",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.4.8",
    "@testing-library/react": "^16.0.0",
    "@types/react": "^18.3.3",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.1",
    "jsdom": "^25.0.0",
    "typescript": "^5.5.4",
    "vite": "^5.4.0",
    "vitest": "^2.0.5"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "types": ["vitest/globals", "@testing-library/jest-dom"]
  },
  "include": ["src"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

- [ ] **Step 3: Create `tsconfig.node.json`**

```json
{
  "compilerOptions": {
    "composite": true,
    "skipLibCheck": true,
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowSyntheticDefaultImports": true
  },
  "include": ["vite.config.ts"]
}
```

- [ ] **Step 4: Create `vite.config.ts`**

```ts
/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
  },
});
```

- [ ] **Step 5: Create `index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
    <title>AI Shubhkamna</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 6: Create `.gitignore`**

```
node_modules
dist
.env.local
*.local
```

- [ ] **Step 7: Create `src/App.tsx` (placeholder, wired up fully in Task 16)**

```tsx
export function App() {
  return <div>AI Shubhkamna</div>;
}
```

- [ ] **Step 8: Create `src/main.tsx`**

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element not found');
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

- [ ] **Step 9: Create `src/test/setup.ts` (global test stubs — canvas/Image APIs jsdom doesn't implement, needed by later tasks)**

```ts
import '@testing-library/jest-dom/vitest';

class FakeImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private _src = '';
  set src(value: string) {
    this._src = value;
    queueMicrotask(() => this.onload?.());
  }
  get src() {
    return this._src;
  }
}
// @ts-expect-error test stub, not a full Image implementation
global.Image = FakeImage;

HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
  drawImage: vi.fn(),
})) as unknown as HTMLCanvasElement['getContext'];

HTMLCanvasElement.prototype.toBlob = vi.fn(function toBlob(callback: BlobCallback) {
  callback(new Blob(['fake-image-bytes'], { type: 'image/jpeg' }));
}) as unknown as HTMLCanvasElement['toBlob'];

if (!URL.createObjectURL) {
  URL.createObjectURL = vi.fn(() => 'blob:fake-url');
}
```

- [ ] **Step 10: Install dependencies and verify the toolchain**

Run: `cd /d/ai-shubhkamna && npm install`
Expected: installs without error.

Run: `npm run build`
Expected: builds successfully (produces `dist/`).

Run: `npm test`
Expected: `No test files found` (no tests yet) — exits without crashing.

- [ ] **Step 11: Commit**

```bash
git add package.json tsconfig.json tsconfig.node.json vite.config.ts index.html .gitignore src/main.tsx src/App.tsx src/test/setup.ts
git commit -m "chore: scaffold Vite + React + TS project with Vitest"
```

---

### Task 2: Core types, config, and redirect utility

**Files:**
- Create: `src/types.ts`
- Create: `src/config.ts`
- Create: `src/utils/redirect.ts`
- Test: `src/utils/redirect.test.ts`
- Create: `.env.example`

- [ ] **Step 1: Create `src/types.ts`**

```ts
export type Profile = {
  username: string;
  email: string;
  mobileno: string;
  state: string;
  constituency: string;
  district: string;
};

export type Template = {
  id: string;
  image: string;
};

export type CompositeResult = {
  imageUrl?: string;
  imageBlob?: Blob;
};

export type CreatePostResult = {
  ok: boolean;
  status: number;
};

export type Step = 'landing' | 'tips' | 'capture' | 'processing' | 'preview';
```

- [ ] **Step 2: Create `src/config.ts`**

```ts
export const config = {
  homeUrl: import.meta.env.VITE_HOME_URL as string,
  mediaWallUrl: import.meta.env.VITE_MEDIA_WALL_URL as string,
  createPostByUrlEndpoint: import.meta.env.VITE_CREATE_POST_BY_URL as string,
  createPostFileEndpoint: import.meta.env.VITE_CREATE_POST_FILE_URL as string,
  profileUrl: (import.meta.env.VITE_PROFILE_URL as string) || '',
  compositeUrl: (import.meta.env.VITE_COMPOSITE_URL as string) || '',
  useMockProfile: import.meta.env.VITE_USE_MOCK_PROFILE !== 'false',
  useMockComposite: import.meta.env.VITE_USE_MOCK_COMPOSITE !== 'false',
};
```

- [ ] **Step 3: Write the failing test for the redirect utility**

```ts
// src/utils/redirect.test.ts
import { describe, expect, it, vi } from 'vitest';
import { buildRedirectUrl, redirectWithJwt } from './redirect';

describe('buildRedirectUrl', () => {
  it('appends jwt as a query param to a bare url', () => {
    expect(buildRedirectUrl('https://example.com/', 'abc.def-ghi')).toBe(
      'https://example.com/?jwt=abc.def-ghi',
    );
  });

  it('preserves existing query params on the base url', () => {
    expect(buildRedirectUrl('https://example.com/page?x=1', 'tok')).toBe(
      'https://example.com/page?x=1&jwt=tok',
    );
  });
});

describe('redirectWithJwt', () => {
  it('calls window.location.replace with the built url', () => {
    const replace = vi.fn();
    Object.defineProperty(window, 'location', {
      value: { ...window.location, replace },
      writable: true,
    });

    redirectWithJwt('https://example.com/', 'tok');

    expect(replace).toHaveBeenCalledWith('https://example.com/?jwt=tok');
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npm test -- redirect`
Expected: FAIL — `Cannot find module './redirect'` (file doesn't exist yet).

- [ ] **Step 5: Create `src/utils/redirect.ts`**

```ts
export function buildRedirectUrl(base: string, jwt: string): string {
  const url = new URL(base);
  url.searchParams.set('jwt', jwt);
  return url.toString();
}

export function redirectWithJwt(base: string, jwt: string): void {
  window.location.replace(buildRedirectUrl(base, jwt));
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm test -- redirect`
Expected: PASS (3 tests).

- [ ] **Step 7: Create `.env.example`**

```
# Where "back / exit" redirects to (jwt is appended automatically)
VITE_HOME_URL=https://birthday2025uat.narendramodi.in/

# Where a successful post redirects to (jwt is appended automatically)
VITE_MEDIA_WALL_URL=https://birthday2025uat.narendramodi.in/MediaWall/frontend/index.html

# Create Post APIs (see integration doc section 5)
VITE_CREATE_POST_BY_URL=https://sevauat-api.narendramodi.in/mediawall/bday2024/createPostByImageUrl
VITE_CREATE_POST_FILE_URL=https://sevauat-api.narendramodi.in/mediawall/bday2024/createPost

# Not available yet - leave blank, mocks are used instead (see docs/superpowers/specs/2026-09-12-ai-shubhkamna-design.md)
VITE_PROFILE_URL=
VITE_COMPOSITE_URL=
VITE_USE_MOCK_PROFILE=true
VITE_USE_MOCK_COMPOSITE=true
```

- [ ] **Step 8: Commit**

```bash
git add src/types.ts src/config.ts src/utils/redirect.ts src/utils/redirect.test.ts .env.example
git commit -m "feat: add core types, env config, and jwt redirect utility"
```

---

### Task 3: JWT context and missing-jwt fallback

**Files:**
- Create: `src/context/JwtContext.tsx`
- Test: `src/context/JwtContext.test.tsx`
- Create: `src/components/MissingJwt.tsx`
- Test: `src/components/MissingJwt.test.tsx`

- [ ] **Step 1: Write the failing test for JwtContext**

```tsx
// src/context/JwtContext.test.tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { JwtProvider, readJwtFromLocation, useJwt } from './JwtContext';

describe('readJwtFromLocation', () => {
  it('extracts jwt from a query string', () => {
    expect(readJwtFromLocation('?jwt=abc123')).toBe('abc123');
  });

  it('returns null when jwt is missing', () => {
    expect(readJwtFromLocation('?other=1')).toBeNull();
    expect(readJwtFromLocation('')).toBeNull();
  });
});

function Child() {
  const jwt = useJwt();
  return <div>token: {jwt}</div>;
}

describe('JwtProvider', () => {
  it('renders children when jwt is present', () => {
    render(
      <JwtProvider search="?jwt=abc123" missingJwtFallback={<div>missing</div>}>
        <Child />
      </JwtProvider>,
    );
    expect(screen.getByText('token: abc123')).toBeInTheDocument();
  });

  it('renders the fallback when jwt is missing', () => {
    render(
      <JwtProvider search="" missingJwtFallback={<div>missing</div>}>
        <Child />
      </JwtProvider>,
    );
    expect(screen.getByText('missing')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- JwtContext`
Expected: FAIL — `Cannot find module './JwtContext'`.

- [ ] **Step 3: Create `src/context/JwtContext.tsx`**

```tsx
import { createContext, useContext, useState, type ReactNode } from 'react';

const JwtContext = createContext<string | null>(null);

export function readJwtFromLocation(search: string): string | null {
  return new URLSearchParams(search).get('jwt');
}

type JwtProviderProps = {
  children: ReactNode;
  missingJwtFallback: ReactNode;
  search?: string;
};

export function JwtProvider({ children, missingJwtFallback, search = window.location.search }: JwtProviderProps) {
  const [jwt] = useState<string | null>(() => readJwtFromLocation(search));

  if (!jwt) {
    return <>{missingJwtFallback}</>;
  }

  return <JwtContext.Provider value={jwt}>{children}</JwtContext.Provider>;
}

export function useJwt(): string {
  const jwt = useContext(JwtContext);
  if (!jwt) {
    throw new Error('useJwt must be used within a JwtProvider that has a valid jwt');
  }
  return jwt;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- JwtContext`
Expected: PASS (4 tests).

- [ ] **Step 5: Write the failing test for MissingJwt**

```tsx
// src/components/MissingJwt.test.tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MissingJwt } from './MissingJwt';

describe('MissingJwt', () => {
  it('shows a message explaining the page cannot be opened directly', () => {
    render(<MissingJwt />);
    expect(screen.getByText(/can't be opened directly/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npm test -- MissingJwt`
Expected: FAIL — `Cannot find module './MissingJwt'`.

- [ ] **Step 7: Create `src/components/MissingJwt.tsx`**

```tsx
export function MissingJwt() {
  return (
    <div className="missing-jwt">
      <p>This page can&apos;t be opened directly. Please return to the app and try again.</p>
    </div>
  );
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npm test -- MissingJwt`
Expected: PASS (1 test).

- [ ] **Step 9: Commit**

```bash
git add src/context/JwtContext.tsx src/context/JwtContext.test.tsx src/components/MissingJwt.tsx src/components/MissingJwt.test.tsx
git commit -m "feat: add JWT context and missing-jwt fallback screen"
```

---

### Task 4: Template assets and data

**Files:**
- Create: `src/assets/templates/*.jpg` (already vendored on disk from the approved Dropbox set — this task just adds them to git)
- Create: `src/data/templates.ts`
- Test: `src/data/templates.test.ts`

- [ ] **Step 1: Verify the 11 template images are present**

Run: `ls src/assets/templates`
Expected:
```
pm-birthday-AI-Shubhkamna-card-1.jpg
pm-birthday-AI-Shubhkamna-card-10.jpg
pm-birthday-AI-Shubhkamna-card-11.jpg
pm-birthday-AI-Shubhkamna-card-15.jpg
pm-birthday-AI-Shubhkamna-card-2.jpg
pm-birthday-AI-Shubhkamna-card-3.jpg
pm-birthday-AI-Shubhkamna-card-4.jpg
pm-birthday-AI-Shubhkamna-card-5.jpg
pm-birthday-AI-Shubhkamna-card-6.jpg
pm-birthday-AI-Shubhkamna-card-8.jpg
pm-birthday-AI-Shubhkamna-card-9.jpg
```

If missing, they're the "With User Vector" set from the approved Dropbox folder shared for this project — download and place them here before continuing.

- [ ] **Step 2: Write the failing test for template data**

```ts
// src/data/templates.test.ts
import { describe, expect, it } from 'vitest';
import { templates } from './templates';

const EXPECTED_IDS = [
  'card-1', 'card-2', 'card-3', 'card-4', 'card-5', 'card-6',
  'card-8', 'card-9', 'card-10', 'card-11', 'card-15',
];

describe('templates', () => {
  it('has exactly the 11 approved templates, no duplicates', () => {
    expect(templates).toHaveLength(11);
    const ids = templates.map((template) => template.id);
    expect(new Set(ids).size).toBe(11);
    expect(ids.sort()).toEqual([...EXPECTED_IDS].sort());
  });

  it('every template has a non-empty image reference', () => {
    for (const template of templates) {
      expect(template.image.length).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- templates`
Expected: FAIL — `Cannot find module './templates'`.

- [ ] **Step 4: Create `src/data/templates.ts`**

```ts
import type { Template } from '../types';
import card1 from '../assets/templates/pm-birthday-AI-Shubhkamna-card-1.jpg';
import card2 from '../assets/templates/pm-birthday-AI-Shubhkamna-card-2.jpg';
import card3 from '../assets/templates/pm-birthday-AI-Shubhkamna-card-3.jpg';
import card4 from '../assets/templates/pm-birthday-AI-Shubhkamna-card-4.jpg';
import card5 from '../assets/templates/pm-birthday-AI-Shubhkamna-card-5.jpg';
import card6 from '../assets/templates/pm-birthday-AI-Shubhkamna-card-6.jpg';
import card8 from '../assets/templates/pm-birthday-AI-Shubhkamna-card-8.jpg';
import card9 from '../assets/templates/pm-birthday-AI-Shubhkamna-card-9.jpg';
import card10 from '../assets/templates/pm-birthday-AI-Shubhkamna-card-10.jpg';
import card11 from '../assets/templates/pm-birthday-AI-Shubhkamna-card-11.jpg';
import card15 from '../assets/templates/pm-birthday-AI-Shubhkamna-card-15.jpg';

export const templates: Template[] = [
  { id: 'card-1', image: card1 },
  { id: 'card-2', image: card2 },
  { id: 'card-3', image: card3 },
  { id: 'card-4', image: card4 },
  { id: 'card-5', image: card5 },
  { id: 'card-6', image: card6 },
  { id: 'card-8', image: card8 },
  { id: 'card-9', image: card9 },
  { id: 'card-10', image: card10 },
  { id: 'card-11', image: card11 },
  { id: 'card-15', image: card15 },
];
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- templates`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add src/assets/templates src/data/templates.ts src/data/templates.test.ts
git commit -m "feat: add approved template assets and template data"
```

---

### Task 5: TemplateCarousel component

**Files:**
- Create: `src/components/TemplateCarousel.tsx`
- Create: `src/components/TemplateCarousel.css`
- Test: `src/components/TemplateCarousel.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/TemplateCarousel.test.tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TemplateCarousel } from './TemplateCarousel';
import type { Template } from '../types';

const TEMPLATES: Template[] = [
  { id: 't1', image: 'data:image/png;base64,aaa' },
  { id: 't2', image: 'data:image/png;base64,bbb' },
  { id: 't3', image: 'data:image/png;base64,ccc' },
];

describe('TemplateCarousel', () => {
  it('renders one option per template and marks the selected one', () => {
    render(<TemplateCarousel templates={TEMPLATES} selectedId="t1" onSelect={vi.fn()} />);
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(3);
    expect(options[0]).toHaveAttribute('aria-selected', 'true');
    expect(options[1]).toHaveAttribute('aria-selected', 'false');
  });

  it('calls onSelect with the clicked template id', async () => {
    const onSelect = vi.fn();
    render(<TemplateCarousel templates={TEMPLATES} selectedId="t1" onSelect={onSelect} />);
    await userEvent.click(screen.getAllByRole('option')[1]);
    expect(onSelect).toHaveBeenCalledWith('t2');
  });
});
```

- [ ] **Step 2: Add `@testing-library/user-event` dependency**

Run: `npm install -D @testing-library/user-event@^14.5.2`
Expected: installs without error.

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- TemplateCarousel`
Expected: FAIL — `Cannot find module './TemplateCarousel'`.

- [ ] **Step 4: Create `src/components/TemplateCarousel.css`**

```css
.template-carousel {
  display: flex;
  gap: 12px;
  overflow-x: auto;
  padding: 8px 0 16px;
  scroll-snap-type: x mandatory;
}

.template-carousel__item {
  flex: 0 0 auto;
  width: 200px;
  aspect-ratio: 1080 / 1260;
  border-radius: 12px;
  border: 2px solid transparent;
  padding: 0;
  overflow: hidden;
  scroll-snap-align: start;
  background: none;
  cursor: pointer;
}

.template-carousel__item img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.template-carousel__item--selected {
  border-color: #4c3fbb;
}
```

- [ ] **Step 5: Create `src/components/TemplateCarousel.tsx`**

```tsx
import type { Template } from '../types';
import './TemplateCarousel.css';

type Props = {
  templates: Template[];
  selectedId: string;
  onSelect: (id: string) => void;
};

export function TemplateCarousel({ templates, selectedId, onSelect }: Props) {
  return (
    <div className="template-carousel" role="listbox" aria-label="Choose a frame">
      {templates.map((template) => {
        const selected = template.id === selectedId;
        return (
          <button
            key={template.id}
            type="button"
            role="option"
            aria-selected={selected}
            className={`template-carousel__item${selected ? ' template-carousel__item--selected' : ''}`}
            onClick={() => onSelect(template.id)}
          >
            <img src={template.image} alt={`Template ${template.id}`} />
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm test -- TemplateCarousel`
Expected: PASS (2 tests).

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/components/TemplateCarousel.tsx src/components/TemplateCarousel.css src/components/TemplateCarousel.test.tsx
git commit -m "feat: add template carousel component"
```

---

### Task 6: Landing screen

**Files:**
- Create: `src/steps/Landing.tsx`
- Create: `src/steps/Landing.css`
- Test: `src/steps/Landing.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/steps/Landing.test.tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Landing } from './Landing';
import { templates } from '../data/templates';

function renderLanding(overrides: Partial<React.ComponentProps<typeof Landing>> = {}) {
  const props = {
    name: '',
    onNameChange: vi.fn(),
    selectedTemplateId: templates[0].id,
    onSelectTemplate: vi.fn(),
    onCapture: vi.fn(),
    onFileSelected: vi.fn(),
    onBack: vi.fn(),
    ...overrides,
  };
  render(<Landing {...props} />);
  return props;
}

describe('Landing', () => {
  it('shows the headline copy', () => {
    renderLanding();
    expect(screen.getByText(/join the nation in wishing pm modi/i)).toBeInTheDocument();
  });

  it('calls onNameChange when the name field is edited', async () => {
    const props = renderLanding();
    await userEvent.type(screen.getByLabelText(/display name on the photo/i), 'A');
    expect(props.onNameChange).toHaveBeenCalledWith('A');
  });

  it('calls onCapture when Capture is clicked', async () => {
    const props = renderLanding();
    await userEvent.click(screen.getByRole('button', { name: /capture/i }));
    expect(props.onCapture).toHaveBeenCalled();
  });

  it('calls onFileSelected with the chosen file', async () => {
    const props = renderLanding();
    const file = new File(['bytes'], 'photo.jpg', { type: 'image/jpeg' });
    const input = screen.getByTestId('landing-file-input') as HTMLInputElement;
    await userEvent.upload(input, file);
    expect(props.onFileSelected).toHaveBeenCalledWith(file);
  });

  it('calls onBack when the back button is clicked', async () => {
    const props = renderLanding();
    await userEvent.click(screen.getByRole('button', { name: /back/i }));
    expect(props.onBack).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- Landing`
Expected: FAIL — `Cannot find module './Landing'`.

- [ ] **Step 3: Create `src/steps/Landing.css`**

```css
.landing {
  min-height: 100vh;
  background: #fbf5ee;
  padding: 16px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
}

.landing__header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}

.landing__header button {
  background: none;
  border: none;
  font-size: 20px;
  cursor: pointer;
}

.landing__title {
  font-size: 22px;
  text-align: center;
  margin: 0 0 8px;
}

.landing__subtitle {
  text-align: center;
  color: #555;
  margin: 0 0 16px;
}

.landing__section-label {
  color: #4c3fbb;
  text-transform: uppercase;
  font-size: 13px;
  letter-spacing: 0.04em;
}

.landing__name-label {
  display: block;
  margin: 16px 0 6px;
  font-weight: 600;
}

.landing__name-input {
  width: 100%;
  padding: 12px;
  border-radius: 8px;
  border: 1px solid #ddd;
  font-size: 16px;
  box-sizing: border-box;
}

.landing__actions {
  display: flex;
  gap: 12px;
  margin-top: 24px;
}

.landing__actions button {
  flex: 1;
  padding: 14px;
  border-radius: 24px;
  font-size: 16px;
  font-weight: 600;
  border: 2px solid #4c3fbb;
  cursor: pointer;
}

.landing__actions button:first-child {
  background: #4c3fbb;
  color: #fff;
}

.landing__actions button:last-child {
  background: #fff;
  color: #4c3fbb;
}
```

- [ ] **Step 4: Create `src/steps/Landing.tsx`**

```tsx
import { useRef } from 'react';
import { TemplateCarousel } from '../components/TemplateCarousel';
import { templates } from '../data/templates';
import './Landing.css';

type Props = {
  name: string;
  onNameChange: (value: string) => void;
  selectedTemplateId: string;
  onSelectTemplate: (id: string) => void;
  onCapture: () => void;
  onFileSelected: (file: File) => void;
  onBack: () => void;
};

export function Landing({
  name,
  onNameChange,
  selectedTemplateId,
  onSelectTemplate,
  onCapture,
  onFileSelected,
  onBack,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="landing">
      <header className="landing__header">
        <button type="button" aria-label="Back" onClick={onBack}>
          ←
        </button>
        <h1>AI Shubhkamna</h1>
      </header>

      <h2 className="landing__title">Join the nation in wishing PM Modi on his Birthday</h2>
      <p className="landing__subtitle">
        Craft your personalised card and make PM Modi&apos;s birthday a moment to remember!
      </p>

      <h3 className="landing__section-label">Choose a frame</h3>
      <TemplateCarousel templates={templates} selectedId={selectedTemplateId} onSelect={onSelectTemplate} />

      <label className="landing__name-label" htmlFor="display-name">
        Display name on the photo
      </label>
      <input
        id="display-name"
        className="landing__name-input"
        value={name}
        onChange={(event) => onNameChange(event.target.value)}
        placeholder="Your name"
      />

      <div className="landing__actions">
        <button type="button" onClick={() => fileInputRef.current?.click()}>
          Upload
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          hidden
          data-testid="landing-file-input"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) {
              onFileSelected(file);
            }
          }}
        />
        <button type="button" onClick={onCapture}>
          Capture
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- Landing`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add src/steps/Landing.tsx src/steps/Landing.css src/steps/Landing.test.tsx
git commit -m "feat: add Landing screen"
```

---

### Task 7: Tips screen

**Files:**
- Create: `src/steps/Tips.tsx`
- Create: `src/steps/Tips.css`
- Test: `src/steps/Tips.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/steps/Tips.test.tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Tips } from './Tips';

describe('Tips', () => {
  it('lists all six photo tips', () => {
    render(<Tips onProceed={vi.fn()} onBack={vi.fn()} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(6);
  });

  it('calls onProceed when Proceed is clicked', async () => {
    const onProceed = vi.fn();
    render(<Tips onProceed={onProceed} onBack={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /proceed/i }));
    expect(onProceed).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- Tips`
Expected: FAIL — `Cannot find module './Tips'`.

- [ ] **Step 3: Create `src/steps/Tips.css`**

```css
.tips {
  min-height: 100vh;
  background: #fbf5ee;
  padding: 16px;
}

.tips__header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}

.tips__header button {
  background: none;
  border: none;
  font-size: 20px;
  cursor: pointer;
}

.tips ol {
  background: #fff;
  border-radius: 12px;
  padding: 20px 20px 20px 40px;
  margin: 16px 0 24px;
}

.tips li {
  margin-bottom: 10px;
  font-weight: 600;
}

.tips button[type='button']:last-child {
  width: 100%;
  padding: 14px;
  border-radius: 24px;
  background: #4c3fbb;
  color: #fff;
  border: none;
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
}
```

- [ ] **Step 4: Create `src/steps/Tips.tsx`**

```tsx
import './Tips.css';

type Props = {
  onProceed: () => void;
  onBack: () => void;
};

const TIPS = [
  'Using back camera & avoid selfies',
  'From your head to waist',
  'In portrait orientation',
  'With a plain background',
  'With only you in the frame',
  'Without any objects, animals or filters',
];

export function Tips({ onProceed, onBack }: Props) {
  return (
    <div className="tips">
      <header className="tips__header">
        <button type="button" aria-label="Back" onClick={onBack}>
          ←
        </button>
        <h1>AI Shubhkamna</h1>
      </header>
      <h2>Tips for a perfect photo</h2>
      <p>For best experience, capture or upload your picture</p>
      <ol>
        {TIPS.map((tip) => (
          <li key={tip}>{tip}</li>
        ))}
      </ol>
      <button type="button" onClick={onProceed}>
        Proceed
      </button>
    </div>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- Tips`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add src/steps/Tips.tsx src/steps/Tips.css src/steps/Tips.test.tsx
git commit -m "feat: add Tips screen"
```

---

### Task 8: useCamera hook

**Files:**
- Create: `src/hooks/useCamera.ts`
- Test: `src/hooks/useCamera.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/hooks/useCamera.test.ts
import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useCamera } from './useCamera';

function fakeStream() {
  return { getTracks: () => [{ stop: vi.fn() }] } as unknown as MediaStream;
}

describe('useCamera', () => {
  it('sets the stream once getUserMedia resolves', async () => {
    const getUserMedia = vi.fn().mockResolvedValue(fakeStream());
    const { result } = renderHook(() => useCamera(getUserMedia));

    await waitFor(() => expect(result.current.stream).not.toBeNull());
    expect(result.current.error).toBeNull();
    expect(getUserMedia).toHaveBeenCalledWith({ video: { facingMode: 'environment' }, audio: false });
  });

  it('sets an error when getUserMedia rejects', async () => {
    const getUserMedia = vi.fn().mockRejectedValue(new Error('Permission denied'));
    const { result } = renderHook(() => useCamera(getUserMedia));

    await waitFor(() => expect(result.current.error).toBe('Permission denied'));
    expect(result.current.stream).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- useCamera`
Expected: FAIL — `Cannot find module './useCamera'`.

- [ ] **Step 3: Create `src/hooks/useCamera.ts`**

```ts
import { useEffect, useState } from 'react';

type CameraState = {
  stream: MediaStream | null;
  error: string | null;
};

type GetUserMedia = (constraints: MediaStreamConstraints) => Promise<MediaStream>;

export function useCamera(getUserMedia: GetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)) {
  const [state, setState] = useState<CameraState>({ stream: null, error: null });

  useEffect(() => {
    let cancelled = false;
    let activeStream: MediaStream | null = null;

    getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        activeStream = stream;
        setState({ stream, error: null });
      })
      .catch((error: Error) => {
        if (!cancelled) {
          setState({ stream: null, error: error.message || 'Camera unavailable' });
        }
      });

    return () => {
      cancelled = true;
      activeStream?.getTracks().forEach((track) => track.stop());
    };
  }, [getUserMedia]);

  return state;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- useCamera`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useCamera.ts src/hooks/useCamera.test.ts
git commit -m "feat: add useCamera hook"
```

---

### Task 9: Capture screen

**Files:**
- Create: `src/steps/Capture.tsx`
- Create: `src/steps/Capture.css`
- Test: `src/steps/Capture.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/steps/Capture.test.tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const useCameraMock = vi.fn();
vi.mock('../hooks/useCamera', () => ({ useCamera: () => useCameraMock() }));

import { Capture } from './Capture';

describe('Capture', () => {
  beforeEach(() => {
    useCameraMock.mockReset();
  });

  it('shows a fallback and lets the user switch to Upload when the camera errors', async () => {
    useCameraMock.mockReturnValue({ stream: null, error: 'Permission denied' });
    const onUseUploadInstead = vi.fn();
    render(<Capture onCaptured={vi.fn()} onBack={vi.fn()} onUseUploadInstead={onUseUploadInstead} />);

    expect(screen.getByText(/couldn't access your camera/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /upload instead/i }));
    expect(onUseUploadInstead).toHaveBeenCalled();
  });

  it('captures a photo from the video feed when the shutter is pressed', async () => {
    useCameraMock.mockReturnValue({ stream: {} as MediaStream, error: null });
    const onCaptured = vi.fn();
    render(<Capture onCaptured={onCaptured} onBack={vi.fn()} onUseUploadInstead={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: /shutter/i }));
    expect(onCaptured).toHaveBeenCalledWith(expect.any(Blob));
  });

  it('calls onBack when close is clicked', async () => {
    useCameraMock.mockReturnValue({ stream: {} as MediaStream, error: null });
    const onBack = vi.fn();
    render(<Capture onCaptured={vi.fn()} onBack={onBack} onUseUploadInstead={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(onBack).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- Capture`
Expected: FAIL — `Cannot find module './Capture'`.

- [ ] **Step 3: Create `src/steps/Capture.css`**

```css
.capture {
  position: relative;
  min-height: 100vh;
  background: #000;
  display: flex;
  flex-direction: column;
}

.capture video {
  flex: 1;
  width: 100%;
  object-fit: cover;
}

.capture > button[aria-label='Close'] {
  position: absolute;
  top: 16px;
  left: 16px;
  z-index: 1;
  background: rgba(0, 0, 0, 0.4);
  color: #fff;
  border: none;
  border-radius: 50%;
  width: 36px;
  height: 36px;
  font-size: 20px;
  cursor: pointer;
}

.capture > button[aria-label='Shutter'] {
  position: absolute;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  width: 64px;
  height: 64px;
  border-radius: 50%;
  border: 4px solid #fff;
  background: transparent;
  color: #fff;
  font-size: 24px;
  cursor: pointer;
}

.capture--error {
  align-items: center;
  justify-content: center;
  text-align: center;
  color: #fff;
  padding: 24px;
  gap: 12px;
}

.capture--error button {
  padding: 12px 24px;
  border-radius: 24px;
  border: none;
  background: #4c3fbb;
  color: #fff;
  font-weight: 600;
  cursor: pointer;
  margin-top: 8px;
}
```

- [ ] **Step 4: Create `src/steps/Capture.tsx`**

```tsx
import { useEffect, useRef } from 'react';
import { useCamera } from '../hooks/useCamera';
import './Capture.css';

type Props = {
  onCaptured: (photo: Blob) => void;
  onBack: () => void;
  onUseUploadInstead: () => void;
};

export function Capture({ onCaptured, onBack, onUseUploadInstead }: Props) {
  const { stream, error } = useCamera();
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  function handleShutter() {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 1080;
    canvas.height = video.videoHeight || 1260;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (blob) {
          onCaptured(blob);
        }
      },
      'image/jpeg',
      0.92,
    );
  }

  if (error) {
    return (
      <div className="capture capture--error">
        <p>We couldn&apos;t access your camera. Please upload a photo instead.</p>
        <button type="button" onClick={onUseUploadInstead}>
          Upload instead
        </button>
        <button type="button" onClick={onBack}>
          Back
        </button>
      </div>
    );
  }

  return (
    <div className="capture">
      <button type="button" aria-label="Close" onClick={onBack}>
        ×
      </button>
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <video ref={videoRef} autoPlay playsInline muted />
      <button type="button" aria-label="Shutter" onClick={handleShutter} />
    </div>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- Capture`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/steps/Capture.tsx src/steps/Capture.css src/steps/Capture.test.tsx
git commit -m "feat: add Capture screen"
```

---

### Task 10: Profile service (mock + real, swappable)

**Files:**
- Create: `src/services/profile.ts`
- Test: `src/services/profile.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/services/profile.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getProfile } from './profile';

const EMPTY_PROFILE = {
  username: '',
  email: '',
  mobileno: '',
  state: '',
  constituency: '',
  district: '',
};

describe('getProfile', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns an empty profile and does not call fetch when useMock is true', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const profile = await getProfile('jwt-token', true);

    expect(profile).toEqual(EMPTY_PROFILE);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('fetches and returns the decrypted profile when useMock is false', async () => {
    const body = { ...EMPTY_PROFILE, username: 'Rajiv Ranjan', state: 'Uttar Pradesh' };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => body }),
    );

    const profile = await getProfile('jwt-token', false);

    expect(profile).toEqual(body);
    expect(fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ headers: { Authorization: 'Bearer jwt-token' } }),
    );
  });

  it('throws when the profile endpoint responds with a non-ok status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));

    await expect(getProfile('jwt-token', false)).rejects.toThrow('Profile lookup failed with status 500');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- profile`
Expected: FAIL — `Cannot find module './profile'`.

- [ ] **Step 3: Create `src/services/profile.ts`**

```ts
import { config } from '../config';
import type { Profile } from '../types';

const EMPTY_PROFILE: Profile = {
  username: '',
  email: '',
  mobileno: '',
  state: '',
  constituency: '',
  district: '',
};

// Real endpoint is not available yet (docs/superpowers/specs/2026-09-12-ai-shubhkamna-design.md
// "Open integrations"). It must decrypt server-side - never ship the decrypt key to the browser.
export async function getProfile(jwt: string, useMock: boolean = config.useMockProfile): Promise<Profile> {
  if (useMock) {
    return EMPTY_PROFILE;
  }

  const response = await fetch(config.profileUrl, {
    headers: { Authorization: `Bearer ${jwt}` },
  });

  if (!response.ok) {
    throw new Error(`Profile lookup failed with status ${response.status}`);
  }

  return (await response.json()) as Profile;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- profile`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/services/profile.ts src/services/profile.test.ts
git commit -m "feat: add profile service with mock fallback"
```

---

### Task 11: Compositing service (mock + real, swappable)

**Files:**
- Create: `src/services/composite.ts`
- Test: `src/services/composite.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/services/composite.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { compositePhoto } from './composite';
import type { Profile } from '../types';

const PROFILE: Profile = {
  username: 'Rajiv Ranjan',
  email: '',
  mobileno: '',
  state: 'Uttar Pradesh',
  constituency: 'Gautam Buddha Nagar',
  district: 'Gautam Buddha Nagar',
};

const PARAMS = {
  photo: new Blob(['photo-bytes'], { type: 'image/jpeg' }),
  templateId: 'card-1',
  templateImageUrl: 'data:image/jpeg;base64,template',
  profile: PROFILE,
};

describe('compositePhoto', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns a composited image blob when useMock is true', async () => {
    const result = await compositePhoto(PARAMS, { useMock: true });
    expect(result.imageBlob).toBeInstanceOf(Blob);
    expect(result.imageUrl).toBeUndefined();
  });

  it('posts to the compositing endpoint and returns an image url when useMock is false', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ imageUrl: 'https://cdn.narendramodi.in/shubhkamna2026/card.jpg' }),
      }),
    );

    const result = await compositePhoto(PARAMS, { useMock: false });

    expect(result.imageUrl).toBe('https://cdn.narendramodi.in/shubhkamna2026/card.jpg');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('throws when the compositing endpoint responds with a non-ok status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 502 }));

    await expect(compositePhoto(PARAMS, { useMock: false })).rejects.toThrow(
      'Compositing failed with status 502',
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- composite`
Expected: FAIL — `Cannot find module './composite'`.

- [ ] **Step 3: Create `src/services/composite.ts`**

```ts
import { config } from '../config';
import type { CompositeResult, Profile } from '../types';

type CompositeParams = {
  photo: Blob;
  templateId: string;
  templateImageUrl: string;
  profile: Profile;
};

type Options = {
  useMock?: boolean;
};

// Real endpoint is not available yet (docs/superpowers/specs/2026-09-12-ai-shubhkamna-design.md
// "Open integrations"). Field names below (`template`, `photo`, response `imageUrl`) are
// provisional pending the real contract - confirm against the actual endpoint once provided.
export async function compositePhoto(
  params: CompositeParams,
  { useMock = config.useMockComposite }: Options = {},
): Promise<CompositeResult> {
  return useMock ? mockCompositePhoto(params) : realCompositePhoto(params);
}

async function realCompositePhoto({ photo, templateId }: CompositeParams): Promise<CompositeResult> {
  const form = new FormData();
  form.append('template', templateId);
  form.append('photo', photo, 'photo.jpg');

  const response = await fetch(config.compositeUrl, { method: 'POST', body: form });
  if (!response.ok) {
    throw new Error(`Compositing failed with status ${response.status}`);
  }
  const data = (await response.json()) as { imageUrl: string };
  return { imageUrl: data.imageUrl };
}

// Visual stand-in only: overlays the user's photo onto the chosen template so the flow is
// demoable before the real compositing endpoint exists. Placement is an approximation, not
// pixel-matched per template.
async function mockCompositePhoto({ photo, templateImageUrl }: CompositeParams): Promise<CompositeResult> {
  const canvas = document.createElement('canvas');
  canvas.width = 1080;
  canvas.height = 1260;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return { imageBlob: photo };
  }

  const [templateImg, photoImg] = await Promise.all([
    loadImage(templateImageUrl),
    loadImage(URL.createObjectURL(photo)),
  ]);

  ctx.drawImage(templateImg, 0, 0, canvas.width, canvas.height);
  ctx.drawImage(photoImg, canvas.width * 0.55, canvas.height * 0.45, canvas.width * 0.4, canvas.height * 0.5);

  return new Promise((resolve) => {
    canvas.toBlob(
      (blob) => resolve({ imageBlob: blob ?? photo }),
      'image/jpeg',
      0.92,
    );
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image: ${src}`));
    img.src = src;
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- composite`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/services/composite.ts src/services/composite.test.ts
git commit -m "feat: add compositing service with mock fallback"
```

---

### Task 12: Processing screen

**Files:**
- Create: `src/steps/Processing.tsx`
- Create: `src/steps/Processing.css`
- Test: `src/steps/Processing.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/steps/Processing.test.tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const compositePhotoMock = vi.fn();
vi.mock('../services/composite', () => ({ compositePhoto: (...args: unknown[]) => compositePhotoMock(...args) }));

import { Processing } from './Processing';
import type { Profile, Template } from '../types';

const TEMPLATE: Template = { id: 'card-1', image: 'data:image/jpeg;base64,x' };
const PROFILE: Profile = { username: '', email: '', mobileno: '', state: '', constituency: '', district: '' };
const PHOTO = new Blob(['bytes'], { type: 'image/jpeg' });

describe('Processing', () => {
  beforeEach(() => {
    compositePhotoMock.mockReset();
  });

  it('calls onComposited once compositing succeeds', async () => {
    compositePhotoMock.mockResolvedValue({ imageBlob: new Blob(['x']) });
    const onComposited = vi.fn();
    render(
      <Processing photo={PHOTO} template={TEMPLATE} profile={PROFILE} onComposited={onComposited} onError={vi.fn()} />,
    );

    await waitFor(() => expect(onComposited).toHaveBeenCalledWith({ imageBlob: expect.any(Blob) }));
  });

  it('shows a retry/retake option when compositing fails, and retry calls compositePhoto again', async () => {
    compositePhotoMock.mockRejectedValue(new Error('network error'));
    render(<Processing photo={PHOTO} template={TEMPLATE} profile={PROFILE} onComposited={vi.fn()} onError={vi.fn()} />);

    const retryButton = await screen.findByRole('button', { name: /retry/i });
    expect(compositePhotoMock).toHaveBeenCalledTimes(1);

    await userEvent.click(retryButton);
    await waitFor(() => expect(compositePhotoMock).toHaveBeenCalledTimes(2));
  });

  it('calls onError when Retake photo is clicked after a failure', async () => {
    compositePhotoMock.mockRejectedValue(new Error('network error'));
    const onError = vi.fn();
    render(<Processing photo={PHOTO} template={TEMPLATE} profile={PROFILE} onComposited={vi.fn()} onError={onError} />);

    await userEvent.click(await screen.findByRole('button', { name: /retake photo/i }));
    expect(onError).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- Processing`
Expected: FAIL — `Cannot find module './Processing'`.

- [ ] **Step 3: Create `src/steps/Processing.css`**

```css
.processing {
  min-height: 100vh;
  background: #000;
  color: #fff;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  gap: 8px;
  padding: 24px;
}

.processing--error button {
  padding: 12px 24px;
  border-radius: 24px;
  border: none;
  background: #4c3fbb;
  color: #fff;
  font-weight: 600;
  cursor: pointer;
  margin-top: 8px;
}
```

- [ ] **Step 4: Create `src/steps/Processing.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { compositePhoto } from '../services/composite';
import type { CompositeResult, Profile, Template } from '../types';
import './Processing.css';

type Props = {
  photo: Blob;
  template: Template;
  profile: Profile;
  onComposited: (result: CompositeResult) => void;
  onError: () => void;
};

export function Processing({ photo, template, profile, onComposited, onError }: Props) {
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);

    compositePhoto({ photo, templateId: template.id, templateImageUrl: template.image, profile })
      .then((result) => {
        if (!cancelled) onComposited(result);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [attempt, photo, template, profile, onComposited]);

  if (failed) {
    return (
      <div className="processing processing--error">
        <p>Something went wrong while creating your card.</p>
        <button type="button" onClick={() => setAttempt((value) => value + 1)}>
          Retry
        </button>
        <button type="button" onClick={onError}>
          Retake photo
        </button>
      </div>
    );
  }

  return (
    <div className="processing">
      <p>Uploading</p>
      <p>Processing</p>
      <p>Creating your perfect photo with PM Modi</p>
      <p>It is worth the wait!</p>
    </div>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- Processing`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/steps/Processing.tsx src/steps/Processing.css src/steps/Processing.test.tsx
git commit -m "feat: add Processing screen"
```

---

### Task 13: Create Post service

**Files:**
- Create: `src/services/createPost.ts`
- Test: `src/services/createPost.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/services/createPost.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPostByImageUrl, createPostWithFile } from './createPost';

describe('createPostByImageUrl', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('posts the expected form fields with the Bearer auth header', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchSpy);

    const result = await createPostByImageUrl({
      jwt: 'tok',
      text: 'Happy Birthday!',
      imageUrl: 'https://cdn.narendramodi.in/shubhkamna2026/card.jpg',
      templateId: 'card-1',
    });

    expect(result).toEqual({ ok: true, status: 200 });
    const [url, requestInit] = fetchSpy.mock.calls[0];
    expect(url).toEqual(expect.any(String));
    expect(requestInit.method).toBe('POST');
    expect(requestInit.headers).toEqual({ Authorization: 'Bearer tok' });

    const form = requestInit.body as FormData;
    expect(form.get('text')).toBe('Happy Birthday!');
    expect(form.get('image')).toBe('https://cdn.narendramodi.in/shubhkamna2026/card.jpg');
    expect(form.get('template')).toBe('card-1');
    expect(form.get('moduleType')).toBe('AI Shubh');
    expect(form.get('lang')).toBe('en');
  });

  it('returns ok:false without throwing on a non-200 response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 400 }));

    const result = await createPostByImageUrl({
      jwt: 'tok',
      text: 'x',
      imageUrl: 'https://cdn.narendramodi.in/shubhkamna2026/card.jpg',
      templateId: 'card-1',
    });

    expect(result).toEqual({ ok: false, status: 400 });
  });
});

describe('createPostWithFile', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('posts the image as a file field named "images"', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchSpy);
    const imageBlob = new Blob(['bytes'], { type: 'image/jpeg' });

    const result = await createPostWithFile({ jwt: 'tok', text: 'Happy Birthday!', imageBlob });

    expect(result).toEqual({ ok: true, status: 200 });
    const [, requestInit] = fetchSpy.mock.calls[0];
    const form = requestInit.body as FormData;
    expect(form.get('text')).toBe('Happy Birthday!');
    expect(form.get('moduleType')).toBe('AI Shubh');
    expect(form.get('images')).toBeInstanceOf(File);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- createPost`
Expected: FAIL — `Cannot find module './createPost'`.

- [ ] **Step 3: Create `src/services/createPost.ts`**

```ts
import { config } from '../config';
import type { CreatePostResult } from '../types';

type CreatePostByImageUrlParams = {
  jwt: string;
  text: string;
  imageUrl: string;
  templateId: string;
  lang?: string;
};

type CreatePostFileParams = {
  jwt: string;
  text: string;
  imageBlob: Blob;
};

export async function createPostByImageUrl({
  jwt,
  text,
  imageUrl,
  templateId,
  lang = 'en',
}: CreatePostByImageUrlParams): Promise<CreatePostResult> {
  const form = new FormData();
  form.append('text', text);
  form.append('image', imageUrl);
  form.append('template', templateId);
  form.append('moduleType', 'AI Shubh');
  form.append('lang', lang);

  const response = await fetch(config.createPostByUrlEndpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${jwt}` },
    body: form,
  });

  return { ok: response.ok, status: response.status };
}

export async function createPostWithFile({ jwt, text, imageBlob }: CreatePostFileParams): Promise<CreatePostResult> {
  const form = new FormData();
  form.append('text', text);
  form.append('moduleType', 'AI Shubh');
  form.append('images', imageBlob, 'card.jpg');

  const response = await fetch(config.createPostFileEndpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${jwt}` },
    body: form,
  });

  return { ok: response.ok, status: response.status };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- createPost`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/services/createPost.ts src/services/createPost.test.ts
git commit -m "feat: add Create Post API client (image-url and file variants)"
```

---

### Task 14: Preview / Wishes screen

**Files:**
- Create: `src/steps/Preview.tsx`
- Create: `src/steps/Preview.css`
- Test: `src/steps/Preview.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/steps/Preview.test.tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Preview } from './Preview';

function renderPreview(overrides: Partial<React.ComponentProps<typeof Preview>> = {}) {
  const props = {
    composited: { imageUrl: 'https://cdn.narendramodi.in/shubhkamna2026/card.jpg' },
    wish: '',
    onWishChange: vi.fn(),
    posting: false,
    postError: null,
    onRetake: vi.fn(),
    onPost: vi.fn(),
    ...overrides,
  };
  render(<Preview {...props} />);
  return props;
}

describe('Preview', () => {
  it('shows the composited image from imageUrl', () => {
    renderPreview();
    expect(screen.getByAltText(/your birthday card/i)).toHaveAttribute(
      'src',
      'https://cdn.narendramodi.in/shubhkamna2026/card.jpg',
    );
  });

  it('truncates wish text at 200 characters', async () => {
    const onWishChange = vi.fn();
    renderPreview({ onWishChange });
    const longText = 'a'.repeat(210);
    await userEvent.type(screen.getByPlaceholderText(/write your birthday wish/i), longText);
    const lastCall = onWishChange.mock.calls.at(-1)?.[0] as string;
    expect(lastCall.length).toBeLessThanOrEqual(200);
  });

  it('fills the wish field with a preset message when Inspire me is clicked', async () => {
    const onWishChange = vi.fn();
    renderPreview({ onWishChange });
    await userEvent.click(screen.getByRole('button', { name: /inspire me/i }));
    expect(onWishChange).toHaveBeenCalledWith(expect.stringMatching(/\w+/));
  });

  it('disables Post and Retake while posting, and shows a posting error', () => {
    renderPreview({ posting: true, postError: "We couldn't post your card. Please try again." });
    expect(screen.getByRole('button', { name: /posting/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /retake/i })).toBeDisabled();
    expect(screen.getByText(/couldn't post your card/i)).toBeInTheDocument();
  });

  it('calls onPost when Post is clicked', async () => {
    const onPost = vi.fn();
    renderPreview({ onPost });
    await userEvent.click(screen.getByRole('button', { name: /^post$/i }));
    expect(onPost).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- Preview`
Expected: FAIL — `Cannot find module './Preview'`.

- [ ] **Step 3: Create `src/steps/Preview.css`**

```css
.preview {
  min-height: 100vh;
  background: #fbf5ee;
  padding: 16px;
}

.preview__card {
  width: 100%;
  max-width: 320px;
  display: block;
  margin: 0 auto 16px;
  border-radius: 12px;
}

.preview textarea {
  width: 100%;
  min-height: 90px;
  padding: 12px;
  border-radius: 8px;
  border: 1px solid #ddd;
  font-size: 15px;
  box-sizing: border-box;
  resize: vertical;
}

.preview__error {
  color: #c0392b;
  font-weight: 600;
}

.preview__actions {
  display: flex;
  gap: 12px;
  margin-top: 16px;
}

.preview__actions button {
  flex: 1;
  padding: 14px;
  border-radius: 24px;
  font-size: 16px;
  font-weight: 600;
  border: 2px solid #4c3fbb;
  cursor: pointer;
}

.preview__actions button:first-child {
  background: #fff;
  color: #4c3fbb;
}

.preview__actions button:last-child {
  background: #4c3fbb;
  color: #fff;
}

.preview__actions button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
```

- [ ] **Step 4: Create `src/steps/Preview.tsx`**

```tsx
import { useState } from 'react';
import type { CompositeResult } from '../types';
import './Preview.css';

const INSPIRE_MESSAGES = [
  "Happy Birthday to PM Shri Narendra Modi! Your visionary leadership and dedication to our nation's growth and development continue to inspire us all. Wish you many more years of service to the country.",
  'Wishing our PM a very Happy Birthday! Thank you for your tireless service to the nation.',
  'Happy Birthday PM Modi Ji! May you continue to lead India towards new heights.',
];

const WISH_MAX_LENGTH = 200;

type Props = {
  composited: CompositeResult;
  wish: string;
  onWishChange: (value: string) => void;
  posting: boolean;
  postError: string | null;
  onRetake: () => void;
  onPost: () => void;
};

export function Preview({ composited, wish, onWishChange, posting, postError, onRetake, onPost }: Props) {
  const [inspireIndex, setInspireIndex] = useState(0);
  const previewSrc = composited.imageUrl ?? (composited.imageBlob ? URL.createObjectURL(composited.imageBlob) : '');

  function handleInspireMe() {
    const message = INSPIRE_MESSAGES[inspireIndex % INSPIRE_MESSAGES.length];
    setInspireIndex((value) => value + 1);
    onWishChange(message.slice(0, WISH_MAX_LENGTH));
  }

  return (
    <div className="preview">
      <img className="preview__card" src={previewSrc} alt="Your birthday card" />

      <h3>Wishes for PM Modi</h3>
      <textarea
        value={wish}
        onChange={(event) => onWishChange(event.target.value.slice(0, WISH_MAX_LENGTH))}
        placeholder="Write your birthday wish for PM Modi"
      />
      <p>
        #HappyBirthdayPMModi #HappyBirthdayModiJi{' '}
        <button type="button" onClick={handleInspireMe}>
          Inspire me
        </button>
      </p>
      <p>
        {wish.length}/{WISH_MAX_LENGTH}
      </p>

      {postError && <p className="preview__error">{postError}</p>}

      <div className="preview__actions">
        <button type="button" onClick={onRetake} disabled={posting}>
          Retake
        </button>
        <button type="button" onClick={onPost} disabled={posting}>
          {posting ? 'Posting…' : 'Post'}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- Preview`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add src/steps/Preview.tsx src/steps/Preview.css src/steps/Preview.test.tsx
git commit -m "feat: add Preview/Wishes screen"
```

---

### Task 15: Exit confirmation modal

**Files:**
- Create: `src/components/ExitConfirm.tsx`
- Create: `src/components/ExitConfirm.css`
- Test: `src/components/ExitConfirm.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/ExitConfirm.test.tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ExitConfirm } from './ExitConfirm';

describe('ExitConfirm', () => {
  it('calls onConfirm when Yes is clicked', async () => {
    const onConfirm = vi.fn();
    render(<ExitConfirm onConfirm={onConfirm} onCancel={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /yes/i }));
    expect(onConfirm).toHaveBeenCalled();
  });

  it('calls onCancel when No is clicked', async () => {
    const onCancel = vi.fn();
    render(<ExitConfirm onConfirm={vi.fn()} onCancel={onCancel} />);
    await userEvent.click(screen.getByRole('button', { name: /no/i }));
    expect(onCancel).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- ExitConfirm`
Expected: FAIL — `Cannot find module './ExitConfirm'`.

- [ ] **Step 3: Create `src/components/ExitConfirm.css`**

```css
.exit-confirm {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10;
}

.exit-confirm__panel {
  background: #fff;
  border-radius: 16px;
  padding: 24px;
  text-align: center;
  min-width: 240px;
}

.exit-confirm__panel p {
  font-weight: 600;
  margin: 0 0 16px;
}

.exit-confirm__panel div {
  display: flex;
  gap: 12px;
}

.exit-confirm__panel button {
  flex: 1;
  padding: 10px;
  border-radius: 24px;
  font-weight: 600;
  cursor: pointer;
}

.exit-confirm__panel button:first-child {
  background: #fff;
  border: 2px solid #4c3fbb;
  color: #4c3fbb;
}

.exit-confirm__panel button:last-child {
  background: #4c3fbb;
  border: 2px solid #4c3fbb;
  color: #fff;
}
```

- [ ] **Step 4: Create `src/components/ExitConfirm.tsx`**

```tsx
import './ExitConfirm.css';

type Props = {
  onConfirm: () => void;
  onCancel: () => void;
};

export function ExitConfirm({ onConfirm, onCancel }: Props) {
  return (
    <div className="exit-confirm" role="dialog" aria-label="Exit confirmation">
      <div className="exit-confirm__panel">
        <p>Are you sure you want to Exit?</p>
        <div>
          <button type="button" onClick={onCancel}>
            No
          </button>
          <button type="button" onClick={onConfirm}>
            Yes
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- ExitConfirm`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add src/components/ExitConfirm.tsx src/components/ExitConfirm.css src/components/ExitConfirm.test.tsx
git commit -m "feat: add exit confirmation modal"
```

---

### Task 16: Wire the full flow together in App.tsx

**Files:**
- Modify: `src/App.tsx`
- Test: `src/App.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/App.test.tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./services/profile', () => ({
  getProfile: vi.fn().mockResolvedValue({
    username: 'Rajiv Ranjan',
    email: '',
    mobileno: '',
    state: 'Uttar Pradesh',
    constituency: 'Gautam Buddha Nagar',
    district: 'Gautam Buddha Nagar',
  }),
}));
vi.mock('./services/composite', () => ({
  compositePhoto: vi.fn().mockResolvedValue({ imageUrl: 'https://cdn.narendramodi.in/shubhkamna2026/card.jpg' }),
}));
vi.mock('./services/createPost', () => ({
  createPostByImageUrl: vi.fn().mockResolvedValue({ ok: true, status: 200 }),
  createPostWithFile: vi.fn().mockResolvedValue({ ok: true, status: 200 }),
}));

import { App } from './App';
import { createPostByImageUrl } from './services/createPost';

function stubLocationReplace() {
  const replace = vi.fn();
  Object.defineProperty(window, 'location', { value: { ...window.location, replace }, writable: true });
  return replace;
}

describe('App', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the missing-jwt screen when no jwt is present', () => {
    render(<App search="" />);
    expect(screen.getByText(/can't be opened directly/i)).toBeInTheDocument();
  });

  it('runs the full upload -> preview -> post -> redirect flow', async () => {
    const replace = stubLocationReplace();
    render(<App search="?jwt=test-token" />);

    const file = new File(['bytes'], 'photo.jpg', { type: 'image/jpeg' });
    await userEvent.upload(screen.getByTestId('landing-file-input'), file);

    await screen.findByAltText(/your birthday card/i);
    await userEvent.type(screen.getByPlaceholderText(/write your birthday wish/i), 'Happy Birthday!');
    await userEvent.click(screen.getByRole('button', { name: /^post$/i }));

    await waitFor(() => expect(replace).toHaveBeenCalledWith(expect.stringContaining('jwt=test-token')));
    expect(createPostByImageUrl).toHaveBeenCalledWith(
      expect.objectContaining({ jwt: 'test-token', text: 'Happy Birthday!' }),
    );
  });

  it('redirects home when exit is confirmed', async () => {
    const replace = stubLocationReplace();
    render(<App search="?jwt=test-token" />);

    await userEvent.click(screen.getByRole('button', { name: /back/i }));
    await userEvent.click(screen.getByRole('button', { name: /yes/i }));

    expect(replace).toHaveBeenCalledWith(expect.stringContaining('jwt=test-token'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- App.test`
Expected: FAIL — `App` doesn't accept a `search` prop yet and doesn't render any of the flow (current `App.tsx` is still the Task 1 placeholder).

- [ ] **Step 3: Replace `src/App.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { JwtProvider, useJwt } from './context/JwtContext';
import { MissingJwt } from './components/MissingJwt';
import { ExitConfirm } from './components/ExitConfirm';
import { Landing } from './steps/Landing';
import { Tips } from './steps/Tips';
import { Capture } from './steps/Capture';
import { Processing } from './steps/Processing';
import { Preview } from './steps/Preview';
import { templates } from './data/templates';
import { getProfile } from './services/profile';
import { createPostByImageUrl, createPostWithFile } from './services/createPost';
import { redirectWithJwt } from './utils/redirect';
import { config } from './config';
import type { CompositeResult, Profile, Step } from './types';

const EMPTY_PROFILE: Profile = {
  username: '',
  email: '',
  mobileno: '',
  state: '',
  constituency: '',
  district: '',
};

function Flow() {
  const jwt = useJwt();
  const [step, setStep] = useState<Step>('landing');
  const [name, setName] = useState('');
  const [profile, setProfile] = useState<Profile>(EMPTY_PROFILE);
  const [templateId, setTemplateId] = useState(templates[0].id);
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [composited, setComposited] = useState<CompositeResult | null>(null);
  const [wish, setWish] = useState('');
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);
  const [showExitConfirm, setShowExitConfirm] = useState(false);

  useEffect(() => {
    getProfile(jwt).then((fetched) => {
      setProfile(fetched);
      if (fetched.username) {
        setName(fetched.username);
      }
    });
  }, [jwt]);

  const selectedTemplate = templates.find((template) => template.id === templateId) ?? templates[0];

  function handleFileSelected(file: File) {
    setPhoto(file);
    setStep('processing');
  }

  function handleCaptured(blob: Blob) {
    setPhoto(blob);
    setStep('processing');
  }

  async function handlePost() {
    if (!composited) return;
    setPosting(true);
    setPostError(null);

    const result = composited.imageUrl
      ? await createPostByImageUrl({ jwt, text: wish, imageUrl: composited.imageUrl, templateId })
      : await createPostWithFile({ jwt, text: wish, imageBlob: composited.imageBlob as Blob });

    setPosting(false);

    if (result.ok) {
      redirectWithJwt(config.mediaWallUrl, jwt);
    } else {
      setPostError("We couldn't post your card. Please try again.");
    }
  }

  return (
    <>
      {step === 'landing' && (
        <Landing
          name={name}
          onNameChange={setName}
          selectedTemplateId={templateId}
          onSelectTemplate={setTemplateId}
          onCapture={() => setStep('tips')}
          onFileSelected={handleFileSelected}
          onBack={() => setShowExitConfirm(true)}
        />
      )}
      {step === 'tips' && <Tips onProceed={() => setStep('capture')} onBack={() => setShowExitConfirm(true)} />}
      {step === 'capture' && (
        <Capture onCaptured={handleCaptured} onBack={() => setStep('landing')} onUseUploadInstead={() => setStep('landing')} />
      )}
      {step === 'processing' && photo && (
        <Processing
          photo={photo}
          template={selectedTemplate}
          profile={{ ...profile, username: name }}
          onComposited={(result) => {
            setComposited(result);
            setStep('preview');
          }}
          onError={() => setStep('landing')}
        />
      )}
      {step === 'preview' && composited && (
        <Preview
          composited={composited}
          wish={wish}
          onWishChange={setWish}
          posting={posting}
          postError={postError}
          onRetake={() => setStep('landing')}
          onPost={handlePost}
        />
      )}
      {showExitConfirm && (
        <ExitConfirm
          onConfirm={() => redirectWithJwt(config.homeUrl, jwt)}
          onCancel={() => setShowExitConfirm(false)}
        />
      )}
    </>
  );
}

type AppProps = {
  search?: string;
};

export function App({ search = window.location.search }: AppProps) {
  return (
    <JwtProvider search={search} missingJwtFallback={<MissingJwt />}>
      <Flow />
    </JwtProvider>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- App.test`
Expected: PASS (3 tests).

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: all test files PASS.

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx src/App.test.tsx
git commit -m "feat: wire the full card-creation flow together in App"
```

---

### Task 17: Global styles, env docs, and README

**Files:**
- Create: `src/styles/global.css`
- Modify: `src/main.tsx`
- Create: `README.md`

- [ ] **Step 1: Create `src/styles/global.css`**

```css
* {
  box-sizing: border-box;
}

html,
body,
#root {
  margin: 0;
  padding: 0;
  min-height: 100%;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  color: #2c2c2c;
}

button {
  font-family: inherit;
}
```

- [ ] **Step 2: Import it in `src/main.tsx`**

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/global.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element not found');
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

- [ ] **Step 3: Create `README.md`**

```markdown
# AI Shubhkamna

Card-creation webview for the NaMo app's Birthday engagement module. See
`docs/superpowers/specs/2026-09-12-ai-shubhkamna-design.md` for the full design.

## Setup

​```bash
npm install
cp .env.example .env.local
​```

Fill in `.env.local` with the UAT URLs from the integration doc. Leave
`VITE_PROFILE_URL` / `VITE_COMPOSITE_URL` blank and the mock flags `true` until those
backend endpoints exist — the app is fully demoable without them.

## Run locally

​```bash
npm run dev
​```

Then open `http://localhost:5173/?jwt=<sample-uat-jwt>` — the JWT must be on the URL,
exactly as the real app will append it. Do not put the JWT in any `.env` file; paste it
into the URL each time you test, and never commit it.

## Test

​```bash
npm test
​```

## Build

​```bash
npm run build
​```

Outputs to `dist/`, ready to deploy to the entry URL (`http://Shubhkamnauat.narendramodi.in`
for UAT).
```

- [ ] **Step 4: Verify the app runs**

Run: `npm run dev` (in one terminal), then open `http://localhost:5173/?jwt=test` in a browser.
Expected: Landing screen renders with the template carousel, name field, and Upload/Capture
buttons. Stop the dev server (Ctrl+C) once confirmed.

- [ ] **Step 5: Commit**

```bash
git add src/styles/global.css src/main.tsx README.md
git commit -m "docs: add README and global styles"
```

---

### Task 18: Final verification

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: every test file passes, no skipped/failing tests.

- [ ] **Step 2: Run a production build**

Run: `npm run build`
Expected: TypeScript compiles with no errors, Vite build succeeds, `dist/` is produced.

- [ ] **Step 3: Manually exercise the flow in a browser**

Run: `npm run dev`, open `http://localhost:5173/?jwt=<sample-uat-jwt-from-integration-doc>`
(use a real mobile viewport emulation — e.g. browser dev tools device toolbar). Walk through:
- Landing: select a different template, type a name, click Capture → Tips → Proceed → grant
  camera permission → shutter → Processing → Preview shows a composited placeholder image.
- Back to Landing, click Upload instead, pick a file → Processing → Preview.
- Type a wish, click "Inspire me", click Post → since `VITE_CREATE_POST_*` point at the real
  UAT endpoints, this performs a real POST — confirm in the network tab it sends the right
  fields and either redirects (200) or shows the inline error (non-200).
- Click the back arrow → confirm dialog → No dismisses, Yes redirects to the home URL.

Expected: no console errors, every transition matches the spec.

- [ ] **Step 4: Commit any final fixes found during manual verification**

If Step 3 surfaces a bug, fix it, add/adjust a test that would have caught it, re-run
`npm test`, then:

```bash
git add -A
git commit -m "fix: <describe the specific bug found during manual verification>"
```

If no issues are found, skip this step — there's nothing to commit.



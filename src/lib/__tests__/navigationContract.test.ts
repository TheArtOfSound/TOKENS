import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.join(__dirname, '..', '..', '..');
const app = readFileSync(path.join(root, 'src', 'App.tsx'), 'utf8');
const styles = readFileSync(path.join(root, 'src', 'styles.css'), 'utf8');
const html = readFileSync(path.join(root, 'index.html'), 'utf8');

describe('shared navigation contract', () => {
  it('routes primary and mobile navigation to the owned Ledger account surface', () => {
    expect(app.match(/href\(\{ name: 'account' \}\)/g)?.length).toBeGreaterThanOrEqual(2);
    expect(app).not.toContain('https://oortstack.com/auth/signin');
  });

  it('portals the mobile drawer outside the sticky header', () => {
    expect(app).toContain('createPortal(mobileMenu, document.body)');
    expect(styles).toContain('body.ledger-menu-open .mobile-nav');
    expect(styles).toContain('body.ledger-menu-open .menu-backdrop');
  });

  it('loads the Qira launcher from the source build', () => {
    expect(app).toContain("createElement('qira-product-launcher'");
    expect(html).toContain('/assets/qira-apps/qira-product-launcher.js');
  });
});

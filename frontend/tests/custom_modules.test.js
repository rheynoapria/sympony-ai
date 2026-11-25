import { describe, expect, test } from 'bun:test';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const Engine = require('../modules/custom.js');
const NotchKit = require('../notchkit.js');
const StyleLib = require('../stylelib.js');

describe('Custom Modules Declarative OLED Engine', () => {
  test('resolves paths, pipes, and prevents prototype pollution', () => {
    const ctx = {
      mkt: { btc: 92450.5, chg: 2.345, neg: -1.25, vol: 12450, ts: 1_000_000 },
      state: { water: 4 },
      config: { note: 'Hello OLED World' },
    };
    expect(Engine.resolveExpr('{{mkt.btc | currency:USD}}', ctx)).toBe('$92,451');
    expect(Engine.resolveExpr('{{mkt.chg | signedPercent:1}}', ctx)).toBe('+2.3%');
    expect(Engine.resolveExpr('{{mkt.neg | signedPercent:1}}', ctx)).toBe('-1.3%');
    expect(Engine.resolveExpr('{{mkt.vol | compact}}', ctx)).toBe('12.5K');
    expect(Engine.resolveExpr('{{mkt.missing | fallback:"—"}}', ctx)).toBe('—');
    expect(Engine.resolveExpr('{{config.note | truncate:10}}', ctx)).toBe('Hello OLE…');
    expect(Engine.resolveExpr('{{mkt.ts | timeago}}', ctx, 1_120_000)).toBe('2m');
    expect(Engine.resolveValue('{{state.water}}', ctx)).toBe(4);

    // Prototype pollution attempts must resolve cleanly to undefined / empty
    expect(Engine.evalPath(ctx, '__proto__.polluted')).toBeUndefined();
    expect(Engine.evalPath(ctx, 'mkt.constructor.prototype')).toBeUndefined();
    expect(Engine.resolveExpr('{{mkt.__proto__}}', ctx)).toBe('');
  });

  test('validates https:// URLs and builds sparkline polyline points', () => {
    expect(Engine.safeUrl('https://api.coingecko.com/en')).toBe('https://api.coingecko.com/en');
    expect(Engine.safeUrl('javascript:alert(1)')).toBe('');
    expect(Engine.safeUrl('http://localhost:8080')).toBe('');
    expect(Engine.safeUrl('file:///etc/passwd')).toBe('');

    const pts = Engine.buildSparklinePoints([10, 20, 15, 30], 140, 28);
    expect(pts.split(' ').length).toBe(4);
    expect(Engine.buildSparklinePoints([10], 140, 28)).toBe('');
  });

  test('packCards and StyleLib support custom:<slug> sizes cleanly', () => {
    const sizes = Object.assign(
      { 'custom:crypto-pulse': '2x1', 'custom:habits': '1x1' },
      StyleLib.gridSizesMap({ moduleStyles: { 'custom:habits': { gridSize: '2x2' } } }),
    );
    expect(sizes['custom:crypto-pulse']).toBe('2x1');
    expect(sizes['custom:habits']).toBe('2x2');
    const pages = NotchKit.packCards(['home', 'custom:crypto-pulse', 'custom:habits'], { sizes });
    const allCards = pages.flatMap((p) => p.cards);
    const crypto = allCards.find((c) => c.id === 'custom:crypto-pulse');
    const habits = allCards.find((c) => c.id === 'custom:habits');
    expect([crypto.w, crypto.h]).toEqual([2, 1]);
    expect([habits.w, habits.h]).toEqual([2, 2]);
  });

  test('renderMarkdown renders safe remote, raster data-uri, and local images while blocking XSS/SVG', () => {
    const remote = NotchKit.renderMarkdown('![Chart](https://example.com/chart.png "Revenue")');
    expect(remote).toContain('<img class="md-img" src="https://example.com/chart.png"');
    expect(remote).toContain('referrerpolicy="no-referrer"');
    expect(remote).toContain('<figcaption class="md-img-cap">Revenue</figcaption>');

    const dataUri = NotchKit.renderMarkdown('![Dot](data:image/png;base64,iVBORw0KGgo=)');
    expect(dataUri).toContain('<img class="md-img" src="data:image/png;base64,iVBORw0KGgo="');

    const local = NotchKit.renderMarkdown('![Plot](/Users/me/plot.png)');
    expect(local).toContain('data-local-img="/Users/me/plot.png"');

    // XSS & SVG data-URI & path traversal must be blocked
    const xssJs = NotchKit.renderMarkdown('![x](javascript:alert(1))');
    expect(xssJs).not.toContain('<img');
    const xssSvg = NotchKit.renderMarkdown('![x](data:image/svg+xml;base64,PHN2Zz4=)');
    expect(xssSvg).not.toContain('<img');
    const trav = NotchKit.renderMarkdown('![x](/Users/me/../secret.png)');
    expect(trav).not.toContain('data-local-img');
  });

  test('Phase 2: threshold pipe and local multi-step animated pet actions work deterministically', () => {
    const ctx = { state: { hunger: 82, low: 15, mid: 50 } };
    expect(Engine.resolveExpr('{{state.hunger | threshold:"0:hungry,35:idle,75:happy"}}', ctx)).toBe('happy');
    expect(Engine.resolveExpr('{{state.mid | threshold:"0:hungry,35:idle,75:happy"}}', ctx)).toBe('idle');
    expect(Engine.resolveExpr('{{state.low | threshold:"0:hungry,35:idle,75:happy"}}', ctx)).toBe('hungry');

    const petManifest = {
      initialState: { hunger: 50, happy: 60, speech: 'Hi' },
      actions: {
        feed: {
          kind: 'multi',
          effect: 'hearts',
          steps: [
            { kind: 'increment', stateKey: 'hunger', delta: 30, min: 0, max: 100 },
            { kind: 'increment', stateKey: 'happy', delta: 15, min: 0, max: 100 },
            { kind: 'setState', stateKey: 'speech', value: 'Yum! ♥' },
          ],
        },
      },
    };
    const res = Engine.applyActionLocal(petManifest, petManifest.initialState, 'feed', {});
    expect(res.effect).toBe('hearts');
    expect(res.state).toEqual({ hunger: 80, happy: 75, speech: 'Yum! ♥' });

    const tabRes = Engine.applyActionLocal(petManifest, res.state, '__tab:view', { value: 'stats' });
    expect(tabRes.state.view).toBe('stats');
  });
});

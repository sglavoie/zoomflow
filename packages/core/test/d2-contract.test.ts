import { D2, type CompileResponse, type Diagram } from '@d2lang/d2';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// This fixture pins compiler output, not Zoomflow's future href classification.
// Review these literals deliberately whenever @d2lang/d2 is upgraded.
const source = `Checkout: {link: layers.checkout}
Scenario: {link: scenarios.alternate}
Step: {link: steps.first}
Docs: {link: https://example.com/docs}
layers: {
  checkout: {
    Charge: {link: layers.charge}
    Back: {link: _}
    layers: {
      charge: {
        Receipt
        Back: {link: _}
      }
    }
  }
}
scenarios: {
  alternate: {Alternative}
}
steps: {
  first: {Started}
  second: {Finished}
}`;

const rootLinks = [
  'root.layers.checkout',
  'root.scenarios.alternate',
  'root.steps.first',
  'https://example.com/docs',
];

function anchorLinks(svg: string, attribute: 'href' | 'xlink:href'): string[] {
  // Restrict to anchors so image and SVG <use> references cannot hide drift.
  return [...svg.matchAll(/<a\b[^>]*>/g)].map(([anchor]) => {
    const match = anchor.match(new RegExp(`\\s${attribute}="([^"]*)"`));
    expect(match, `Missing ${attribute} on ${anchor}`).not.toBeNull();
    return match![1];
  });
}

function shapeIds(diagram: Diagram): string[] {
  return diagram.shapes.map((shape) => shape.id);
}

describe('D2 0.1.34 compiler and SVG contract', () => {
  let d2: D2;
  let compiled: CompileResponse;
  let rootSvg: string;
  let checkoutSvg: string;
  let chargeSvg: string;

  beforeAll(async () => {
    d2 = new D2();
    compiled = await d2.compile(source, { layout: 'elk' });
    rootSvg = await d2.render(compiled.diagram, compiled.renderOptions);
    checkoutSvg = await d2.render(compiled.diagram, {
      ...compiled.renderOptions,
      target: 'layers.checkout',
    });
    chargeSvg = await d2.render(compiled.diagram, {
      ...compiled.renderOptions,
      target: 'layers.checkout.layers.charge',
    });
  });

  afterAll(async () => {
    await d2?.dispose();
  });

  it('compiles a three-level board tree with independent layers', () => {
    const root = compiled.diagram;
    expect(root.name).toBe('');
    expect(shapeIds(root)).toEqual(['Checkout', 'Scenario', 'Step', 'Docs']);
    expect(root.layers).toHaveLength(1);
    const checkout = root.layers![0]!;
    expect(checkout.name).toBe('checkout');
    expect(shapeIds(checkout)).toEqual(['Charge', 'Back']);
    expect(checkout.layers).toHaveLength(1);
    const charge = checkout.layers![0]!;
    expect(charge.name).toBe('charge');
    expect(shapeIds(charge)).toEqual(['Receipt', 'Back']);
  });

  it('exposes scenario inheritance and successive step inheritance', () => {
    const root = compiled.diagram;
    expect(root.scenarios?.map((board) => board?.name)).toEqual(['alternate']);
    expect(shapeIds(root.scenarios![0]!)).toEqual([
      'Checkout', 'Scenario', 'Step', 'Docs', 'Alternative',
    ]);
    expect(root.steps?.map((board) => board?.name)).toEqual(['first', 'second']);
    expect(shapeIds(root.steps![0]!)).toEqual([
      'Checkout', 'Scenario', 'Step', 'Docs', 'Started',
    ]);
    expect(shapeIds(root.steps![1]!)).toEqual([
      'Checkout', 'Scenario', 'Step', 'Docs', 'Started', 'Finished',
    ]);
  });

  it('exposes resolved shape links and usable layout boxes', () => {
    expect(compiled.diagram.shapes.map((shape) => shape.link)).toEqual(rootLinks);
    const checkout = compiled.diagram.layers![0]!;
    expect(checkout.shapes.map((shape) => shape.link)).toEqual([
      'root.layers.checkout.layers.charge', 'root',
    ]);
    const charge = checkout.layers![0]!;
    expect(charge.shapes.map((shape) => shape.link)).toEqual(['', 'root.layers.checkout']);
    for (const board of [compiled.diagram, checkout, charge]) {
      for (const shape of board.shapes) {
        expect(Number.isFinite(shape.pos.x)).toBe(true);
        expect(Number.isFinite(shape.pos.y)).toBe(true);
        expect(shape.width).toBeGreaterThan(0);
        expect(shape.height).toBeGreaterThan(0);
      }
    }
  });

  it('renders exact layer, scenario, step, and external hrefs on root', () => {
    expect(rootSvg).toContain('<svg');
    expect(anchorLinks(rootSvg, 'href')).toEqual(rootLinks);
    expect(anchorLinks(rootSvg, 'xlink:href')).toEqual(rootLinks);
  });

  it('renders only the requested layer with a nested drill link and _ as root', () => {
    const expected = ['root.layers.checkout.layers.charge', 'root'];
    expect(anchorLinks(checkoutSvg, 'href')).toEqual(expected);
    expect(anchorLinks(checkoutSvg, 'xlink:href')).toEqual(expected);
    expect(checkoutSvg).toContain('<g class="Q2hhcmdl">');
    expect(checkoutSvg).not.toContain('<g class="Q2hlY2tvdXQ=">');
    expect(checkoutSvg).not.toContain('<g class="UmVjZWlwdA==">');
  });

  it('resolves _ in the grandchild to its immediate parent', () => {
    expect(anchorLinks(chargeSvg, 'href')).toEqual(['root.layers.checkout']);
    expect(anchorLinks(chargeSvg, 'xlink:href')).toEqual(['root.layers.checkout']);
    expect(chargeSvg).toContain('<g class="UmVjZWlwdA==">');
    expect(chargeSvg).not.toContain('<g class="Q2hhcmdl">');
  });

  it('rejects rendering all boards without an animation interval', async () => {
    await expect(d2.render(compiled.diagram, {
      ...compiled.renderOptions,
      target: '*',
    })).rejects.toThrow("target '*' only supported for animated SVGs");
  });

  it('exposes exact source ranges and shape wrappers for click-to-source', async () => {
    const result = await d2.compile('a -> b', { layout: 'elk' });
    // Upstream types currently declare graph objects as Object; match the real
    // runtime fields without introducing a production adapter in this session.
    expect(result.graph.objects).toMatchObject([
      { id: 'a', references: [{ key: { range: 'index,0:0:0-0:1:1' } }] },
      { id: 'b', references: [{ key: { range: 'index,0:5:5-0:6:6' } }] },
    ]);
    const svg = await d2.render(result.diagram, result.renderOptions);
    expect(svg).toContain('<g class="YQ==">');
    expect(svg).toContain('<g class="Yg==">');
  });
});

import { D2 } from '@d2lang/d2';
const d2 = new D2();
const r = await d2.compile('a -> b\nb.link: layers.x\nlayers: { x: { c } }');
const o = r.graph.objects.find(o=>o.id==='b') || r.graph.objects[1];
console.log(Object.keys(o));
console.log(JSON.stringify(o.references?.[0]?.key?.range ?? o.references?.[0], null, 0).slice(0,300));
const svg = await d2.render(r.diagram, r.renderOptions);
console.log(/<g [^>]*class="[^"]*"[^>]*>/.exec(svg)?.[0]);
await d2.dispose();

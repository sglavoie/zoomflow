import { D2 } from '@d2lang/d2';
const d2 = new D2();
const src = `
Browse -> Checkout -> Fulfil
Checkout.link: layers.checkout
layers: {
  checkout: {
    Validate -> Charge
    Charge.link: layers.charge
    layers: { charge: { Pending -> Authorized -> Captured } }
  }
}`;
const r = await d2.compile(src, { layout: 'elk' });
const show = (d, p='') => { console.log(p + (d.name||'root'), d.shapes.map(s=>`${s.id}${s.link?'->'+s.link:''}`).join(', ')); (d.layers||[]).forEach(l=>show(l,p+'  ')); };
show(r.diagram);
console.log('graph keys', Object.keys(r.graph||{}).slice(0,20));
const svg = await d2.render(r.diagram, r.renderOptions);
console.log('svg bytes', svg.length, 'has href', /href="[^"]*"/.exec(svg)?.[0]);
const t = await d2.render(r.diagram, {...r.renderOptions, target: 'layers.checkout'}).catch(e=>'ERR '+e.message);
console.log('target render', String(t).slice(0,80));
const all = await d2.render(r.diagram, {...r.renderOptions, target: '*'}).catch(e=>'ERR '+e.message);
console.log('all w/o animate:', String(all).slice(0,120));
await d2.dispose();

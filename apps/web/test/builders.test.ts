// @vitest-environment happy-dom
import { expect, it } from 'vitest';
import { setupFlowBuilder } from '../src/flow-builder';
import { setupMindMapBuilder } from '../src/mind-map-builder';

// happy-dom has no Option constructor or modal dialogs.
globalThis.Option ??= new Proxy(HTMLOptionElement, {
  construct: (_, [text = '', value = '', defaultSelected = false, selected = false]) =>
    Object.assign(document.createElement('option'), { textContent: text, value, defaultSelected, selected }),
});
HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.open = true; };

it('refuses a step named only with spaces after its row is rebuilt', () => {
  document.body.innerHTML = '<button id="new-flow"></button>';
  let created: string | undefined;
  setupFlowBuilder(source => { created = source; }, async () => true);
  document.querySelector<HTMLButtonElement>('#new-flow')!.click();
  const first = document.querySelector<HTMLInputElement>('#flow-steps input')!;
  first.value = '   ';
  first.dispatchEvent(new Event('input'));
  // Adding a step rebuilds every row.
  document.querySelector<HTMLButtonElement>('#flow-add-step')!.click();
  const steps = document.querySelectorAll<HTMLInputElement>('#flow-steps input');
  steps[steps.length - 1].value = 'New';
  steps[steps.length - 1].dispatchEvent(new Event('input'));
  expect(steps[0].checkValidity()).toBe(false);
  document.querySelector<HTMLFormElement>('#flow-builder form')!.requestSubmit();
  expect(created).toBeUndefined();
});

it('keeps a shape label that looks like outline markup as the mind map board\'s central topic', () => {
  document.body.innerHTML = '<button id="new-mind-map"></button><details><summary></summary><button id="new-mind-map-picker"></button></details>';
  const builder = setupMindMapBuilder(() => {}, async () => true);
  for (const name of ['- Todo', '## Q3']) {
    builder.open({ mode: 'board', name, apply: () => undefined }, document.body);
    expect(document.querySelector<HTMLTextAreaElement>('#mind-map-outline')!.value, name).toBe(`- ${name}\n  First idea\n  Second idea`);
  }
});

it('refuses a step named only with control characters, which the flow cannot write', () => {
  document.body.innerHTML = '<button id="new-flow"></button>';
  let created: string | undefined;
  setupFlowBuilder(source => { created = source; }, async () => true);
  document.querySelector<HTMLButtonElement>('#new-flow')!.click();
  const first = document.querySelector<HTMLInputElement>('#flow-steps input')!;
  first.value = '\u0007';
  first.dispatchEvent(new Event('input'));
  expect(first.checkValidity()).toBe(false);
  document.querySelector<HTMLFormElement>('#flow-builder form')!.requestSubmit();
  expect(created).toBeUndefined();
});

type Field = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

/** Save edits immediately, including empty values and edits that have not lost focus yet. */
export function restoreField(field: Field, key: string) {
  const checkbox = field instanceof HTMLInputElement && field.type === 'checkbox';
  try {
    const saved = localStorage.getItem(key);
    if (saved !== null) {
      if (checkbox) {
        if (saved === 'true' || saved === 'false') field.checked = saved === 'true';
      } else if (field instanceof HTMLSelectElement) {
        if ([...field.options].some(option => option.value === saved)) field.value = saved;
      } else if (field.maxLength < 0 || saved.length <= field.maxLength) field.value = saved;
    }
  } catch { /* Fields remain usable when browser storage is unavailable. */ }
  const save = () => {
    try { localStorage.setItem(key, checkbox ? String(field.checked) : field.value); }
    catch { /* Storage may be blocked or full. Keep the current edit in the field. */ }
  };
  field.addEventListener('input', save);
  field.addEventListener('change', save);
  return save;
}

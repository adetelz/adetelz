// Form builder: edits a JSON form definition client-side and saves it via the admin API.
(function () {
  const { form, id, types, maxUploadMb } = JSON.parse(document.getElementById('form-data').textContent);
  const root = document.getElementById('builder');
  const CHOICE = ['select', 'radio', 'checkbox'];
  let formId = id;
  let dirty = false;

  const h = (tag, attrs = {}, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'checked' || k === 'value') el[k] = v;
      else if (v !== false && v != null) el.setAttribute(k, v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid);
    return el;
  };
  const change = (fn) => (e) => { fn(e); dirty = true; };

  function newField(type) {
    const f = { id: 'q' + Math.random().toString(36).slice(2, 10), type, label: '', help: '', required: false };
    if (CHOICE.includes(type)) f.options = ['Option 1', 'Option 2'];
    if (type === 'file') Object.assign(f, { accept: '', maxSizeMb: 10, maxFiles: 1 });
    return f;
  }

  function fieldCard(f, i) {
    const move = (d) => () => {
      const j = i + d;
      if (j < 0 || j >= form.fields.length) return;
      [form.fields[i], form.fields[j]] = [form.fields[j], form.fields[i]];
      dirty = true;
      render();
    };
    const typeSelect = h('select', {
      onchange: change((e) => {
        const nf = newField(e.target.value);
        form.fields[i] = { ...nf, id: f.id, label: f.label, help: f.help, required: f.required, options: f.options || nf.options };
        render();
      }),
    }, Object.entries(types).map(([v, label]) => h('option', { value: v, selected: v === f.type ? '' : false }, label)));

    const extra = [];
    if (CHOICE.includes(f.type)) {
      extra.push(h('div', { class: 'options' },
        f.options.map((o, k) => h('div', { class: 'row' },
          h('input', { value: o, placeholder: `Option ${k + 1}`, oninput: change((e) => { f.options[k] = e.target.value; }) }),
          h('button', { class: 'link danger', type: 'button', title: 'Remove option', onclick: () => { f.options.splice(k, 1); dirty = true; render(); } }, '✕'))),
        h('button', { class: 'link', type: 'button', onclick: () => { f.options.push(`Option ${f.options.length + 1}`); dirty = true; render(); } }, '+ Add option')));
    }
    if (f.type === 'file') {
      extra.push(h('div', { class: 'grid3' },
        h('label', {}, 'Allowed types',
          h('input', { value: f.accept, placeholder: 'e.g. .pdf,.docx,.jpg (blank = any)', oninput: change((e) => { f.accept = e.target.value; }) })),
        h('label', {}, 'Max size (MB)',
          h('input', { type: 'number', min: 1, max: maxUploadMb, value: f.maxSizeMb, oninput: change((e) => { f.maxSizeMb = Number(e.target.value); }) })),
        h('label', {}, 'Max files',
          h('input', { type: 'number', min: 1, max: 20, value: f.maxFiles, oninput: change((e) => { f.maxFiles = Number(e.target.value); }) }))));
    }

    return h('div', { class: 'card field' },
      h('div', { class: 'row' },
        h('input', { class: 'grow', value: f.label, placeholder: 'Question', oninput: change((e) => { f.label = e.target.value; }) }),
        typeSelect),
      h('input', { class: 'help', value: f.help, placeholder: 'Description (optional)', oninput: change((e) => { f.help = e.target.value; }) }),
      extra,
      h('div', { class: 'row between toolbar' },
        h('label', { class: 'choice' }, h('input', { type: 'checkbox', checked: f.required, onchange: change((e) => { f.required = e.target.checked; }) }), ' Required'),
        h('div', { class: 'row' },
          h('button', { class: 'link', type: 'button', title: 'Move up', onclick: move(-1) }, '↑'),
          h('button', { class: 'link', type: 'button', title: 'Move down', onclick: move(1) }, '↓'),
          h('button', { class: 'link', type: 'button', onclick: () => { form.fields.splice(i + 1, 0, { ...structuredClone(f), id: newField(f.type).id }); dirty = true; render(); } }, 'Duplicate'),
          h('button', { class: 'link danger', type: 'button', onclick: () => { form.fields.splice(i, 1); dirty = true; render(); } }, 'Delete'))));
  }

  async function save() {
    let status = document.getElementById('status');
    status.className = '';
    status.textContent = 'Saving…';
    const res = await fetch(formId ? `/admin/api/forms/${formId}` : '/admin/api/forms', {
      method: formId ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { status.textContent = data.error || 'Save failed'; status.className = 'error'; return; }
    dirty = false;
    if (!formId) { formId = data.id; history.replaceState(null, '', `/admin/forms/${formId}/edit`); render(); status = document.getElementById('status'); }
    status.className = 'ok';
    status.textContent = 'Saved.';
  }

  async function remove() {
    if (!confirm('Delete this form, all its responses and uploaded files? This cannot be undone.')) return;
    await fetch(`/admin/api/forms/${formId}`, { method: 'DELETE' });
    dirty = false;
    location.href = '/admin';
  }

  function render() {
    const shareUrl = formId ? `${location.origin}/f/${formId}` : null;
    root.replaceChildren(
      h('div', { class: 'card header' },
        h('input', { class: 'title', value: form.title, placeholder: 'Form title', oninput: change((e) => { form.title = e.target.value; }) }),
        h('textarea', { rows: 2, placeholder: 'Form description (optional)', oninput: change((e) => { form.description = e.target.value; }) }, form.description),
        h('label', { class: 'choice' }, h('input', { type: 'checkbox', checked: form.open, onchange: change((e) => { form.open = e.target.checked; }) }), ' Accepting responses')),
      ...form.fields.map(fieldCard),
      h('div', { class: 'card add' },
        h('span', { class: 'muted' }, 'Add question: '),
        Object.entries(types).map(([t, label]) =>
          h('button', { type: 'button', class: t === 'file' ? 'chip accent' : 'chip', onclick: () => { form.fields.push(newField(t)); dirty = true; render(); } }, label))),
      h('div', { class: 'row between sticky' },
        h('div', { class: 'row' },
          h('button', { class: 'primary', type: 'button', onclick: save }, 'Save'),
          h('span', { id: 'status' })),
        h('div', { class: 'row' },
          shareUrl && h('a', { href: shareUrl, target: '_blank' }, 'Preview'),
          shareUrl && h('a', { href: `/admin/forms/${formId}/responses` }, 'Responses'),
          formId && h('button', { class: 'link danger', type: 'button', onclick: remove }, 'Delete form'))),
    );
  }

  window.addEventListener('beforeunload', (e) => { if (dirty) e.preventDefault(); });
  if (!form.fields.length) form.fields.push(newField('text'));
  render();
})();

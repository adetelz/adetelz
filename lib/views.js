// Server-rendered HTML. Every interpolated value goes through esc().
const { FIELD_TYPES, MAX_FILE_MB_CAP } = require('./fields');

function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function layout(title, body, { admin = false } = {}) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<link rel="stylesheet" href="/static/style.css">
</head>
<body>
${admin ? `<header class="topbar"><a href="/admin" class="brand">Adetelz Forms</a><form method="post" action="/admin/logout"><button class="link">Log out</button></form></header>` : ''}
<main class="${admin ? 'wide' : ''}">
${body}
</main>
</body>
</html>`;
}

function loginPage(error) {
  return layout('Sign in', `
<div class="card narrow">
  <h1>Admin sign in</h1>
  ${error ? `<p class="error">${esc(error)}</p>` : ''}
  <form method="post" action="/admin/login">
    <label>Password <input type="password" name="password" autofocus required></label>
    <button class="primary">Sign in</button>
  </form>
</div>`);
}

function dashboard(forms, counts, baseUrl) {
  const rows = forms.map((f) => `
  <tr>
    <td><strong>${esc(f.title)}</strong><div class="muted">${f.fields.length} question(s) · ${f.open ? '<span class="pill ok">Accepting responses</span>' : '<span class="pill">Closed</span>'}</div></td>
    <td class="num">${counts[f.id] || 0}</td>
    <td class="actions">
      <a href="/admin/forms/${f.id}/responses">Responses</a>
      <a href="/admin/forms/${f.id}/edit">Edit</a>
      <a href="/f/${f.id}" target="_blank">Open</a>
      <button class="link copy" data-copy="${esc(baseUrl)}/f/${f.id}">Copy link</button>
    </td>
  </tr>`).join('');
  return layout('Forms', `
<div class="row between">
  <h1>Your forms</h1>
  <a class="button primary" href="/admin/forms/new">+ New form</a>
</div>
${forms.length ? `<table class="list"><thead><tr><th>Form</th><th class="num">Responses</th><th></th></tr></thead><tbody>${rows}</tbody></table>`
  : `<div class="card empty"><p>No forms yet. Create one, add a <strong>File upload</strong> question, and share the link — anyone can respond and attach files, no account needed.</p></div>`}
<script src="/static/admin.js"></script>`, { admin: true });
}

function builderPage(form) {
  const data = form || { title: '', description: '', open: true, fields: [] };
  return layout(form ? `Edit · ${form.title}` : 'New form', `
<h1>${form ? 'Edit form' : 'New form'}</h1>
<div id="builder" class="builder"></div>
<script id="form-data" type="application/json">${JSON.stringify({ form: data, id: form?.id || null, types: FIELD_TYPES, maxUploadMb: MAX_FILE_MB_CAP }).replace(/</g, '\\u003c')}</script>
<script src="/static/builder.js"></script>`, { admin: true });
}

function fieldInput(field, value, error) {
  const name = esc(field.id);
  const req = field.required ? 'required' : '';
  switch (field.type) {
    case 'textarea':
      return `<textarea name="${name}" rows="4" ${req}>${esc(value)}</textarea>`;
    case 'select':
      return `<select name="${name}" ${req}><option value="">Choose…</option>${field.options.map((o) => `<option ${o === value ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
    case 'radio':
      return `<div class="choices">${field.options.map((o) => `<label class="choice"><input type="radio" name="${name}" value="${esc(o)}" ${o === value ? 'checked' : ''} ${req}> ${esc(o)}</label>`).join('')}</div>`;
    case 'checkbox': {
      const vals = Array.isArray(value) ? value : [];
      return `<div class="choices">${field.options.map((o) => `<label class="choice"><input type="checkbox" name="${name}" value="${esc(o)}" ${vals.includes(o) ? 'checked' : ''}> ${esc(o)}</label>`).join('')}</div>`;
    }
    case 'file':
      return `<div class="dropzone" data-max-mb="${field.maxSizeMb}" data-max-files="${field.maxFiles}">
        <input type="file" name="${name}" ${field.maxFiles > 1 ? 'multiple' : ''} ${field.accept ? `accept="${esc(field.accept)}"` : ''} ${req}>
        <p class="hint">${field.maxFiles > 1 ? `Up to ${field.maxFiles} files` : 'One file'}, max ${field.maxSizeMb} MB each${field.accept ? ` · ${esc(field.accept.replace(/,/g, ', '))}` : ''}</p>
        <ul class="filelist"></ul>
      </div>`;
    default: {
      const type = { email: 'email', number: 'number', date: 'date' }[field.type] || 'text';
      return `<input type="${type}" name="${name}" value="${esc(value)}" ${type === 'number' ? 'step="any"' : ''} ${req}>`;
    }
  }
}

function publicForm(form, { values = {}, errors = {}, formError = '' } = {}) {
  if (!form.open) {
    return layout(form.title, `<div class="card"><h1>${esc(form.title)}</h1><p>This form is no longer accepting responses.</p></div>`);
  }
  const fields = form.fields.map((f) => `
  <div class="card question ${errors[f.id] ? 'has-error' : ''}">
    <label class="qlabel" ${f.type !== 'radio' && f.type !== 'checkbox' ? `for="q_${esc(f.id)}"` : ''}>${esc(f.label)}${f.required ? ' <span class="req">*</span>' : ''}</label>
    ${f.help ? `<p class="muted">${esc(f.help)}</p>` : ''}
    ${fieldInput(f, values[f.id], errors[f.id]).replace(`name="${esc(f.id)}"`, `id="q_${esc(f.id)}" name="${esc(f.id)}"`)}
    ${errors[f.id] ? `<p class="error">${esc(errors[f.id])}</p>` : ''}
  </div>`).join('');
  return layout(form.title, `
<form method="post" action="/f/${form.id}" enctype="multipart/form-data" class="public-form">
  <div class="card header">
    <h1>${esc(form.title)}</h1>
    ${form.description ? `<p class="desc">${esc(form.description)}</p>` : ''}
    <p class="muted"><span class="req">*</span> Required</p>
  </div>
  ${formError ? `<p class="error card">${esc(formError)}</p>` : ''}
  ${fields}
  <div class="row between">
    <button class="primary" type="submit">Submit</button>
    <span class="muted progress" hidden>Uploading…</span>
  </div>
</form>
<script src="/static/form.js"></script>`);
}

function thanksPage(form) {
  return layout('Response recorded', `
<div class="card">
  <h1>${esc(form.title)}</h1>
  <p>Your response has been recorded. Thank you!</p>
  <p><a href="/f/${form.id}">Submit another response</a></p>
</div>`);
}

function formatAnswer(field, sub) {
  if (field.type === 'file') {
    const files = sub.files?.[field.id] || [];
    return files.map((f) => `<a href="/admin/files/${sub.id}/${f.id}">${esc(f.originalName)}</a> <span class="muted">(${humanSize(f.size)})</span>`).join('<br>') || '<span class="muted">—</span>';
  }
  const v = sub.answers[field.id];
  const text = Array.isArray(v) ? v.join(', ') : v;
  return text ? esc(text).replace(/\n/g, '<br>') : '<span class="muted">—</span>';
}

function humanSize(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function responsesPage(form, subs, baseUrl) {
  const head = form.fields.map((f) => `<th>${esc(f.label)}</th>`).join('');
  const rows = subs.map((s) => `
  <tr>
    <td class="nowrap">${esc(new Date(s.createdAt).toLocaleString('en-GB'))}</td>
    ${form.fields.map((f) => `<td>${formatAnswer(f, s)}</td>`).join('')}
    <td><form method="post" action="/admin/submissions/${s.id}/delete" onsubmit="return confirm('Delete this response and its files?')"><button class="link danger">Delete</button></form></td>
  </tr>`).join('');
  const hasFiles = form.fields.some((f) => f.type === 'file');
  return layout(`Responses · ${form.title}`, `
<div class="row between">
  <div><a href="/admin">← All forms</a><h1>${esc(form.title)}</h1><p class="muted">${subs.length} response(s) · Share link: <code>${esc(baseUrl)}/f/${form.id}</code> <button class="link copy" data-copy="${esc(baseUrl)}/f/${form.id}">Copy</button></p></div>
  <div class="row">
    <a class="button" href="/admin/forms/${form.id}/export.csv">Export CSV</a>
    ${hasFiles ? `<a class="button" href="/admin/forms/${form.id}/files.zip">Download all files</a>` : ''}
  </div>
</div>
${subs.length ? `<div class="scroll"><table class="responses"><thead><tr><th>Submitted</th>${head}<th></th></tr></thead><tbody>${rows}</tbody></table></div>`
  : '<div class="card empty"><p>No responses yet. Share the link above.</p></div>'}
<script src="/static/admin.js"></script>`, { admin: true });
}

function notFound() {
  return layout('Not found', '<div class="card"><h1>Not found</h1><p>This form does not exist or was deleted.</p></div>');
}

module.exports = { esc, loginPage, dashboard, builderPage, publicForm, thanksPage, responsesPage, notFound };

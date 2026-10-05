// Field definitions shared by validation, rendering and export.
const FIELD_TYPES = {
  text: 'Short answer',
  textarea: 'Paragraph',
  email: 'Email',
  number: 'Number',
  date: 'Date',
  select: 'Dropdown',
  radio: 'Multiple choice',
  checkbox: 'Checkboxes',
  file: 'File upload',
};

const CHOICE_TYPES = new Set(['select', 'radio', 'checkbox']);
const MAX_FILE_MB_CAP = 100;
const MAX_FILES_CAP = 20;

// Turn whatever the builder posted into a clean, trusted form definition.
function normalizeForm(input) {
  const title = String(input.title || '').trim().slice(0, 200);
  if (!title) throw new Error('Form title is required');
  const fields = (Array.isArray(input.fields) ? input.fields : []).map((f, i) => {
    const type = FIELD_TYPES[f.type] ? f.type : 'text';
    const field = {
      id: /^[a-z0-9]{1,32}$/i.test(f.id) ? f.id : `f${i}_${Date.now().toString(36)}`,
      type,
      label: String(f.label || '').trim().slice(0, 500) || 'Untitled question',
      help: String(f.help || '').trim().slice(0, 1000),
      required: Boolean(f.required),
    };
    if (CHOICE_TYPES.has(type)) {
      field.options = (Array.isArray(f.options) ? f.options : [])
        .map((o) => String(o).trim().slice(0, 200))
        .filter(Boolean);
      if (!field.options.length) field.options = ['Option 1'];
    }
    if (type === 'file') {
      field.accept = String(f.accept || '')
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter((s) => /^\.[a-z0-9]{1,10}$/.test(s))
        .join(',');
      field.maxSizeMb = clamp(Number(f.maxSizeMb) || 10, 1, MAX_FILE_MB_CAP);
      field.maxFiles = clamp(Number(f.maxFiles) || 1, 1, MAX_FILES_CAP);
    }
    return field;
  });
  return {
    title,
    description: String(input.description || '').trim().slice(0, 5000),
    open: input.open !== false,
    fields,
  };
}

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, Math.round(n)));
}

// Validate a submission. `body` is the parsed multipart body, `files` maps
// field id -> array of multer file objects. Returns { answers, errors }.
function validateSubmission(form, body, files) {
  const answers = {};
  const errors = {};
  for (const field of form.fields) {
    if (field.type === 'file') {
      const list = files[field.id] || [];
      if (field.required && !list.length) errors[field.id] = 'Please attach a file.';
      else if (list.length > field.maxFiles) errors[field.id] = `At most ${field.maxFiles} file(s).`;
      else {
        const allowed = field.accept ? field.accept.split(',') : null;
        for (const f of list) {
          const ext = (f.originalname.match(/\.[^.]+$/) || [''])[0].toLowerCase();
          if (allowed && !allowed.includes(ext)) {
            errors[field.id] = `"${f.originalname}" is not an allowed type (${field.accept}).`;
          } else if (f.size > field.maxSizeMb * 1024 * 1024) {
            errors[field.id] = `"${f.originalname}" is larger than ${field.maxSizeMb} MB.`;
          }
        }
      }
      continue;
    }

    let value = body[field.id];
    if (field.type === 'checkbox') {
      value = (Array.isArray(value) ? value : value ? [value] : []).filter((v) =>
        field.options.includes(v)
      );
      if (field.required && !value.length) errors[field.id] = 'Please choose at least one.';
    } else {
      value = Array.isArray(value) ? value[0] : value;
      value = String(value ?? '').trim().slice(0, 10000);
      if (field.required && !value) errors[field.id] = 'This question is required.';
      else if (value && field.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))
        errors[field.id] = 'Enter a valid email address.';
      else if (value && field.type === 'number' && !Number.isFinite(Number(value)))
        errors[field.id] = 'Enter a number.';
      else if (value && field.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(value))
        errors[field.id] = 'Enter a valid date.';
      else if (value && (field.type === 'select' || field.type === 'radio') && !field.options.includes(value))
        errors[field.id] = 'Choose one of the options.';
    }
    answers[field.id] = value;
  }
  return { answers, errors };
}

module.exports = { FIELD_TYPES, CHOICE_TYPES, normalizeForm, validateSubmission, MAX_FILE_MB_CAP, MAX_FILES_CAP };

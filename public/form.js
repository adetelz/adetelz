// Public form: show chosen files, check size/count before upload, and show upload progress.
(function () {
  const form = document.querySelector('.public-form');
  if (!form) return;

  const fmt = (n) => (n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

  for (const zone of form.querySelectorAll('.dropzone')) {
    const input = zone.querySelector('input[type=file]');
    const list = zone.querySelector('.filelist');
    const maxBytes = Number(zone.dataset.maxMb) * 1024 * 1024;
    const maxFiles = Number(zone.dataset.maxFiles);

    const check = () => {
      list.replaceChildren();
      let msg = '';
      if (input.files.length > maxFiles) msg = `You can attach at most ${maxFiles} file(s).`;
      for (const f of input.files) {
        const li = document.createElement('li');
        li.textContent = `${f.name} (${fmt(f.size)})`;
        if (f.size > maxBytes) { li.className = 'error'; msg = `"${f.name}" is larger than ${zone.dataset.maxMb} MB.`; }
        list.append(li);
      }
      input.setCustomValidity(msg);
    };
    input.addEventListener('change', check);

    for (const ev of ['dragenter', 'dragover']) zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add('over'); });
    for (const ev of ['dragleave', 'drop']) zone.addEventListener(ev, () => zone.classList.remove('over'));
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      input.files = e.dataTransfer.files;
      check();
    });
  }

  // Required checkbox groups: at least one must be ticked.
  for (const q of form.querySelectorAll('.question')) {
    const boxes = q.querySelectorAll('input[type=checkbox]');
    if (!boxes.length || !q.querySelector('.req')) continue;
    const sync = () => {
      const any = [...boxes].some((b) => b.checked);
      boxes[0].setCustomValidity(any ? '' : 'Please choose at least one.');
    };
    boxes.forEach((b) => b.addEventListener('change', sync));
    sync();
  }

  // Submit with XHR so large uploads show progress; fall back to normal submit otherwise.
  form.addEventListener('submit', (e) => {
    if (!form.querySelector('input[type=file]')) return;
    e.preventDefault();
    const btn = form.querySelector('button[type=submit]');
    const progress = form.querySelector('.progress');
    btn.disabled = true;
    progress.hidden = false;
    const xhr = new XMLHttpRequest();
    xhr.open('POST', form.action);
    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable) progress.textContent = `Uploading… ${Math.round((ev.loaded / ev.total) * 100)}%`;
    };
    xhr.onload = () => {
      if (xhr.responseURL && xhr.status < 400) { location.href = xhr.responseURL; return; }
      document.open(); document.write(xhr.responseText); document.close();
    };
    xhr.onerror = () => { btn.disabled = false; progress.textContent = 'Upload failed — check your connection and try again.'; };
    xhr.send(new FormData(form));
  });
})();

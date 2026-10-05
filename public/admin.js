for (const btn of document.querySelectorAll('.copy')) {
  btn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(btn.dataset.copy);
      const old = btn.textContent;
      btn.textContent = 'Copied!';
      setTimeout(() => (btn.textContent = old), 1500);
    } catch {
      prompt('Copy this link:', btn.dataset.copy);
    }
  });
}

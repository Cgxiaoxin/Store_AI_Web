document.addEventListener('click', async event => {
  const button = event.target.closest('button[data-copy]')
  if (!button) return
  try {
    await navigator.clipboard.writeText(button.dataset.copy)
    button.textContent = document.documentElement.lang === 'en' ? 'Copied' : '已复制'
  } catch {
    button.textContent = document.documentElement.lang === 'en' ? 'Copy manually' : '请手动复制'
  }
})

const search = document.querySelector('.header-search')
search?.addEventListener('toggle', () => {
  if (search.open) search.querySelector('input[type="search"]').focus()
})
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape' || !search?.open) return
  search.open = false
  search.querySelector('summary').focus()
})

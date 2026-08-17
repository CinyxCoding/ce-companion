// Minimal element builder. Text always goes through textContent, so values are
// never interpreted as HTML. This keeps API data render-safe by construction.
// The 'html' attribute exists only for trusted static markup and is never used
// with data from the network.

export function el(tag, attrs, ...kids) {
  const node = document.createElement(tag)

  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (value == null) continue
      if (key === 'class') node.className = value
      else if (key === 'text') node.textContent = value
      else if (key === 'html') node.innerHTML = value
      else if (key === 'dataset' && typeof value === 'object') Object.assign(node.dataset, value)
      else if (key.startsWith('on') && typeof value === 'function') {
        node.addEventListener(key.slice(2).toLowerCase(), value)
      } else {
        node.setAttribute(key, String(value))
      }
    }
  }

  for (const kid of kids) {
    if (kid == null || kid === false) continue
    node.append(kid.nodeType ? kid : document.createTextNode(String(kid)))
  }
  return node
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild)
}

export function mount(root, node) {
  clear(root)
  root.append(node)
}

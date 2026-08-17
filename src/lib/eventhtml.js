// Event bodies from the API contain HTML: <br> line breaks and <a href="/...">
// profile links. Rendering that with innerHTML would be an injection risk, so
// this parses the string and rebuilds only a safe whitelist (br, and anchors
// that point at the CE domain). Everything else becomes plain text.

const CE_BASE = 'https://cartelempire.online'

function safeHref(href) {
  if (!href) return null
  const h = String(href).trim()
  if (h.startsWith('/')) return CE_BASE + h
  if (/^https?:\/\//i.test(h)) {
    try {
      const u = new URL(h)
      // Only cartelempire links, and always without the www subdomain.
      if (/(^|\.)cartelempire\.online$/i.test(u.hostname)) return CE_BASE + u.pathname + u.search
    } catch (e) {
      return null
    }
  }
  return null
}

// Returns a DocumentFragment. onLink(url) is called when a link is tapped.
export function renderEventHtml(html, onLink) {
  const frag = document.createDocumentFragment()
  if (html == null || html === '') return frag

  let doc
  try {
    doc = new DOMParser().parseFromString(String(html), 'text/html')
  } catch (e) {
    frag.appendChild(document.createTextNode(String(html)))
    return frag
  }

  const walk = (src, dest) => {
    src.childNodes.forEach((node) => {
      if (node.nodeType === 3) {
        dest.appendChild(document.createTextNode(node.textContent))
        return
      }
      if (node.nodeType !== 1) return
      const tag = node.tagName.toLowerCase()
      if (tag === 'br') {
        dest.appendChild(document.createElement('br'))
      } else if (tag === 'a') {
        const url = safeHref(node.getAttribute('href'))
        if (url) {
          const a = document.createElement('a')
          a.className = 'ev-link'
          a.href = url
          a.textContent = node.textContent
          a.addEventListener('click', (e) => {
            e.preventDefault()
            if (typeof onLink === 'function') onLink(url)
          })
          dest.appendChild(a)
        } else {
          dest.appendChild(document.createTextNode(node.textContent))
        }
      } else {
        // Unknown tag: keep only its text content.
        walk(node, dest)
      }
    })
  }

  walk(doc.body, frag)
  return frag
}

// Flatten event HTML to a single line for use as a notification body.

